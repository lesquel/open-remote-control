# Architecture

opencode-pilot is an OpenCode plugin that adds a remote-control layer on top of the OpenCode SDK. It exposes sessions, prompts, permissions, and live events over HTTP + Server-Sent Events so you can monitor and drive OpenCode from a phone, another machine, or a public URL — without changing how OpenCode itself works.

**Current version:** v1.18.0. The internal structure was fully reorganized in this version — see `docs/REFACTOR-2026-04-architecture.md` for the full migration history and rationale.

---

## Top-level modules

The `src/` tree is organized as **Screaming Architecture** — folder names announce what the system does, not what technology it uses.

| Module | Purpose | May import from |
|---|---|---|
| `infra/` | Reusable technical plumbing (tunnel, QR, logger, paths, auth token, circuit-breaker, dotenv) | NOTHING (absolute bottom) |
| `core/` | Pure domain rules: sessions, permissions, events, audit, settings, state | `infra/` only |
| `transport/` | How the outside world talks to the core (today: HTTP only) | `core/`, `infra/` |
| `integrations/` | Each external CLI agent (opencode, codex) is a closed module with its own wiring API | `core/`, `infra/`, `transport/` (via `AgentIntegration` port) |
| `notifications/` | Fan-out to outbound channels (telegram, push, future: slack, discord) | `core/`, `infra/` |
| `dashboard/` | Browser SPA served by `transport/http/` | NOTHING (browser runtime, no backend imports) |
| `tui/` | TUI plugin that registers slash-commands in OpenCode | `core/`, `infra/` |
| `cli/` | `opencode-pilot init` binary | `infra/` |
| `server/` | **Façade** — the composition root; the only file allowed to import across all layers | EVERYTHING |

---

## Dependency rule (precise)

```
infra/ ← core/ ← (transport/, integrations/, notifications/) ← server/index.ts
```

- **`infra/` is the absolute bottom.** No project-internal imports.
- **`core/` imports only from `infra/`.** This lets domain logic (permissions, audit, state) use filesystem helpers without dragging in HTTP, Telegram, or Codex.
- **`transport/`, `integrations/`, and `notifications/` import from `core/` and `infra/`.** Cross-imports between siblings (e.g., `transport/ → notifications/`) are FORBIDDEN except through the two explicit ports below.
- **`server/index.ts` is the only file that imports across all layers.** It is the composition root by definition — standard hexagonal/clean architecture.

This rule is documented here and in `AGENTS.md` §3, and mechanically enforced by `scripts/architecture.test.ts`. The test resolves production relative imports and fails when a top-level module crosses its allowlist; it deliberately excludes tests and declarations, where realistic fixtures may need broader imports.

---

## Two explicit ports

Ports are interfaces defined where there are multiple implementations and likely future growth. All other capabilities have a single implementation each — their factory function `create*(): T` already serves as the contract without a separate interface.

### `NotificationChannel` — `src/notifications/ports.ts`

```ts
export interface NotificationChannel {
  readonly name: string          // 'telegram' | 'push' | 'slack' | ...
  readonly enabled: () => boolean
  readonly send: (event: NotificationEvent) => Promise<NotificationResult>
}

export type NotificationEvent = {
  kind:
    | 'permission.pending'
    | 'permission.resolved'
    | 'tool.completed'
    | 'session.idle'
    | 'session.error'
  payload: Record<string, unknown>
}
```

`enabled()` is a function (not a property) so runtime config changes via the dashboard settings store activate/deactivate channels without restart.

Implementations: `notifications/channels/telegram/index.ts`, `notifications/channels/push/index.ts`.

### `AgentIntegration` — `src/integrations/ports.ts`

```ts
export interface AgentDescriptor {
  readonly id: string
  readonly displayName: string
  readonly capabilities: AgentCapabilities
}

export interface AgentIntegration extends AgentDescriptor {
  readonly setup: (deps: IntegrationDeps) => IntegrationHandle
}

export type IntegrationDeps = {
  permissions: PermissionQueue
  events: EventBus
  audit: AuditLog
  registerRoute?: (route: RouteSpec) => void   // Codex uses this
  registerHook?: (event: string, handler: HookFn) => void  // future use
}
```

`AgentCapabilities` declares support for sessions, streaming, permissions, tools, cost, todos, files, models, and named agents. Consumers must use this metadata instead of inferring support from the provider name.

`createAgentDescriptor()` validates the stable protocol ID and freezes metadata for every adapter. `createAgentIntegration()` adds the standard imperative setup contract. The composition root passes `registerRoute` only to integrations that need HTTP. OpenCode is an intentional native-SDK outlier: its setup returns the hook object OpenCode requires, but it uses the same validated descriptor.

Implementations: `integrations/opencode/index.ts`, `integrations/codex/index.ts`.

---

## Composition root — `src/server/index.ts`

The composition root is the only file that crosses all layers. It is organized in 7 named sections:

```
0. ENV + CONFIG      loadDotEnv, loadConfigSafe, mergeStoredSettings, resolveSources
1. CORE              getSharedEventBus (singleton), createPermissionQueue, createAuditLog, createSettingsStore
2. NOTIFICATIONS     createPushService → push subsystem, createTelegramChannel, createNotificationService
3. STATE + BANNER    generateToken, startTunnel, writeBanner, writeState lifecycle
4. TRANSPORT         createRemoteServer({ permissions, events, audit, settings, push, config, token })
5. INTEGRATIONS      opencodeIntegration.setup, codexIntegration.setup (self-registers /codex routes)
6. START             server.start() — primary/passive port-binding with promotion watcher
7. PLUGIN HANDLE     return { event, permission.ask, tool.execute.before, tool.execute.after }
```

**Shutdown order** (per spec): `opencode.shutdown()` + `codexHandle.shutdown()` → `server.stop()` → `tunnel.stop()` → `notifications.flush()` → `clearState()`.

---

## Recipes

### How to add a new agent CLI integration (e.g., Cursor)

1. Create `src/integrations/cursor/index.ts`:

```ts
import { createAgentIntegration } from '../ports'

export const cursorIntegration = createAgentIntegration({
  id: 'cursor',
  displayName: 'Cursor',
  capabilities: {
    sessions: false,
    streaming: false,
    permissions: false,
    tools: true,
    cost: false,
    todos: false,
    files: false,
    models: false,
    agents: false,
  },
}, ({ permissions, events, audit, registerRoute }) => {
    registerRoute!({
      method: 'POST',
      pattern: /^\/cursor\/hooks\/(?<event>[^/]+)$/,
      auth: 'none',
      handler: async (ctx) => { /* ... */ },
    })
    return { shutdown: async () => {} }
})
```

2. Add ONE line in `src/server/index.ts`:

```ts
const cursor = cursorIntegration.setup({ permissions, events, audit, registerRoute: server.registerRoute })
// and in shutdown: await cursor.shutdown()
```

Zero changes to `transport/`, `core/`, `notifications/`, or any other file.

### How to add a new notification channel (e.g., Slack)

1. Create `src/notifications/channels/slack/index.ts`:

```ts
import type { NotificationChannel } from '../../ports'

export function createSlackChannel(config: SlackConfig | null): NotificationChannel {
  if (!config) {
    return { name: 'slack', enabled: () => false, send: async () => ({ ok: true }) }
  }
  // ... implementation
  return { name: 'slack', enabled: () => true, send: async (event) => { /* ... */ } }
}
```

2. Add ONE line in the composition root:

```ts
channels: [createTelegramChannel(...), push.channel, createSlackChannel(config.slack)]
```

Zero changes to `pipeline.ts`. Zero changes to `core/`. The port does the work.

---

## Local device identity

`core/devices/store.ts` owns versioned device state and capability roles. Raw device credentials are returned once, only their SHA-256 hashes are persisted through the owner-private atomic writer, and short-lived pairing secrets stay in memory. `transport/http/authentication.ts` maps either the backwards-compatible legacy bearer or a device credential to a request principal; the HTTP server enforces each route's declared capabilities before invoking its handler.

The legacy bearer intentionally remains an admin migration path for existing installations. It is not a device credential and cannot be individually revoked. A future E2EE relay must build on reviewed endpoint key identities rather than treating these bearer credentials as an encryption protocol.

## Web Push subsystem (special case)

Web Push has three concerns beyond a fire-and-forget channel:

1. **VAPID key management** — `POST /settings/vapid/generate` creates a key pair
2. **Subscription registration** — browsers POST subscription objects for storage
3. **Fan-out sending** — the actual channel behavior

These are bundled in `notifications/channels/push/service.ts` (`createPushService`), which returns a rich object. The composition root extracts `push.channel` for the notification pipeline and passes the full `push` service into the HTTP server so the settings handler can call `push.generateVapid()` and `push.addSubscription()` via dependency injection — no direct `transport/ → notifications/` import.

---

## System diagram

```mermaid
flowchart LR
    subgraph Host["Developer machine"]
        OC["OpenCode TUI<br/>(process)"]
        subgraph Plugin["opencode-pilot plugin"]
            Root["server/index.ts<br/>(composition root)"]
            Core["core/"]
            Transport["transport/http/"]
            Integrations["integrations/"]
            Notifications["notifications/"]
            Infra["infra/"]
        end
        TUI["tui/ plugin"]
        OC -- loads --> Plugin
        OC -- loads --> TUI
        Root --> Core
        Root --> Transport
        Root --> Integrations
        Root --> Notifications
        Core --> Infra
        Transport --> Core
        Notifications --> Core
        Integrations --> Core
    end
    Phone["Dashboard PWA<br/>(browser)"]
    TG["Telegram Bot API"]
    Tunnel["cloudflared / ngrok<br/>(optional)"]
    Transport <-- "HTTP + SSE" --> Phone
    Notifications <-- "HTTPS" --> TG
    Transport -. "forwarded" .- Tunnel
    Tunnel <-- "HTTPS" --> Phone
```

---

## SSE event delivery

- Each process generation has a random identifier and monotonically increasing event sequence.
- SSE frames carry IDs in the form `<generation>:<sequence>` while their JSON payload remains backward-compatible.
- The event protocol version is currently `1` and is advertised by the `pilot.connected` event independently of the npm package version.
- The server retains the latest 256 events and replays at most 24 per reconnect. The dashboard sends its last accepted ID, deduplicates replays, and falls back to canonical HTTP snapshots when the cursor is too old or the host generation changed.
- Replay is an availability feature, not durable history: the local agent remains the source of truth.

---

## Security model

- **Auth token** — `crypto.randomBytes(32).toString("hex")` — 64 hex chars generated at startup. Rotatable via `POST /auth/rotate`. Persisted in `pilot-state.json` only for the TUI to display.
- **Bearer scheme** — every `auth: "required"` route checks `Authorization: Bearer <token>`. `/events` also accepts `?token=` because `EventSource` cannot set custom headers.
- **Localhost by default** — `PILOT_HOST=127.0.0.1`. Exposed to LAN/internet only when `PILOT_TUNNEL` is set.
- **Audit log** — every authed request, every permission decision, every SSE connection appended as JSON Lines to `.opencode/pilot-audit.log`.
- **Request correlation** — every HTTP response carries a fresh `X-Request-ID`; server-generated error bodies and local structured logs use the same ID for diagnosis without exposing secrets.
- **Rate limiting** — authentication failures use per-client plus global buckets, while mutations use per-route/client plus global buckets. Reads and SSE streaming are not charged; bounded global buckets prevent spoofed forwarding headers from bypassing protection.
- **Path traversal guard** — static dashboard handler rejects paths containing `..`.
- **Primary/passive promotion** — if port 4097 is taken (multiple OpenCode windows), the second instance runs passive (no HTTP, no tunnel) and auto-promotes when the primary exits.

---

## References

- `docs/REFACTOR-2026-04-architecture.md` — full spec for the v1.18.0 architecture migration (6 atomic commits + JD remediation), with design decisions, risk analysis, and per-commit acceptance gates.
- `src/server/index.ts` — the composition root; live wiring of all 8 modules.
- `AGENTS.md` §3 — hard conventions (dependency rule, factory pattern, test co-location).
- `AGENTS.md` §4 — release process (the three-version-bump rule, tag/push order).
