# Architecture Refactor — 2026-04

**Status:** Approved (pending implementation)
**Date:** 2026-04-25
**Branch:** `feat/codex-hooks-bridge`
**Target version:** `v1.18.0` (minor — no breaking changes)
**Scope:** Internal restructure only. Public API surface (npm exports, HTTP routes, env vars, plugin contract, on-disk paths) is unchanged.

---

## TL;DR

Reorganize `src/` from technology-layered (`server/{http,services,util,hooks,dashboard}`) to **domain-screaming** (`{core, transport, integrations, notifications, infra, dashboard, tui, cli, server}`). Apply **Hexagonal-lite** (explicit ports only where there are multiple implementations) and **Screaming Architecture** (the folder tree announces the system's purpose, not its tech stack). Migrate in **6 incremental commits** on the same branch — each leaves tests green and is independently revertible.

---

## Context — why now

After 17 minor releases of `opencode-pilot`, the structure under `src/server/` has accumulated three pain points that compound as the project grows:

1. **Codex integration is mixed with core HTTP.** `src/server/http/codex-handlers.ts` and `codex-validators.ts` live next to the core handlers and validators. Codex is an external-CLI integration — semantically as separate from OpenCode core as Telegram or Push — but structurally pasted into the HTTP transport layer.

2. **`src/server/services/` is a grab-bag.** 11 files mix infrastructure (`tunnel`, `qr`), domain (`permission-queue`, `audit`, `state`, `event-bus`), integrations (`telegram`, `push`, `notifications`), and persistence (`settings-store`). No internal hierarchy — every service is a peer at the same level.

3. **`src/server/dashboard/` has 50+ flat `.js` files** living inside `server/`. Frontend is mixed with backend, in a different language than the rest of the codebase, and with no internal organization.

The growth direction makes these compound: the current branch (`feat/codex-hooks-bridge`) adds Codex bridge Phase 1, and likely future work adds more agent CLIs (Cursor, Aider) and notification channels (Slack, Discord). Without a refactor, each new integration is another file dropped into already-overloaded folders.

---

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Apply Screaming + Hexagonal-lite + per-integration modules** (not full DDD) | DDD ceremony (aggregates, repositories, ubiquitous language) is overkill for a 5KLOC plugin without complex business invariants. Hexagonal-lite gives the boundaries that matter without architectural-astronaut tax. |
| D2 | **Move `dashboard/` out of `server/` and structure internally**; keep as `.js` | Reorg gives navigation and boundary benefit without paying the cost of typing 50 files. TS migration is deferred to a dedicated future round. |
| D3 | **Incremental commits on the same branch** (`feat/codex-hooks-bridge`) | Bisectable, reviewable per commit, no mid-refactor releases. Suits a solo maintainer. The Codex Phase 1 commit already on the branch is the proof case for `integrations/codex/` and gets reused, not discarded. |
| D4 | **Pragmatic ports**: explicit interfaces only for `NotificationChannel` and `AgentIntegration` | These are the two areas with multiple implementations and likely future growth. Other capabilities (`EventBus`, `AuditLog`, `SettingsStore`, etc.) have one implementation each, and their factory function `create*(): T` already serves as the contract. |

**Tests location:** Co-located unit tests are NOT changed. `AGENTS.md` §3 mandates co-location with the rationale "co-location makes refactors atomic." Integration tests continue to live in `__tests__/` folders per the existing pattern in `dashboard/` and `tui/`. The user's initial request to move tests to a dedicated `tests/` folder was reviewed and rejected against this evidence.

---

## Final architecture

### The tree

```
src/
├── core/                     # DOMAIN — agnostic of HTTP, Telegram, Codex
│   ├── index.ts              # barrel re-exporting create* factories
│   ├── sessions/
│   ├── permissions/          # createPermissionQueue
│   ├── events/               # getSharedEventBus + PilotEvent / BusEvent types
│   ├── audit/                # createAuditLog + rotation
│   ├── settings/             # createSettingsStore
│   ├── state/                # state.ts (read/write/clear pilot-state.json)
│   ├── strings.ts            # MSG dictionary (user-facing strings)
│   └── errors.ts             # PilotError + ConfigError
│
├── transport/                # HOW the core is exposed to the outside world
│   └── http/
│       ├── server.ts         # Bun.serve setup + dispatch
│       ├── routes.ts         # core route table (codex routes live in integrations/codex/)
│       ├── validation.ts     # body validator middleware
│       ├── handlers/         # one file per domain (split from current handlers.ts)
│       │   ├── sessions.ts
│       │   ├── permissions.ts
│       │   ├── events.ts     # /events SSE endpoint
│       │   ├── settings.ts   # /settings* including /settings/vapid/generate
│       │   ├── system.ts     # /, /dashboard/*, /status, /health, /connect-info
│       │   └── projects.ts
│       ├── validators/       # split from current validators.ts
│       ├── middlewares/      # auth, cors, json
│       └── __tests__/        # cross-handler integration tests (server, dispatch)
│
├── integrations/             # ADAPTERS for external CLI agents
│   ├── ports.ts              # interface AgentIntegration
│   ├── opencode/             # OpenCode SDK hook integration (native plugin path)
│   │   ├── index.ts          # exports `opencodeIntegration: AgentIntegration`
│   │   └── hooks/            # event.ts, permission.ask.ts, tool.ts, index.ts (barrel)
│   └── codex/                # Codex CLI bridge over HTTP /codex/hooks/:event
│       ├── index.ts          # exports `codexIntegration: AgentIntegration`
│       ├── handlers.ts
│       └── validators.ts
│
├── notifications/            # FAN-OUT for outbound notifications
│   ├── ports.ts              # interface NotificationChannel
│   ├── pipeline.ts           # createNotificationService (orchestrator)
│   └── channels/
│       ├── telegram/
│       │   └── index.ts      # createTelegramChannel: NotificationChannel
│       └── push/             # Web Push has subsystem internals — see Web Push section
│           ├── index.ts      # createPushChannel: NotificationChannel
│           ├── service.ts    # createPushService — VAPID + subscription mgmt
│           ├── vapid.ts      # VAPID key generation + persistence
│           ├── subscriptions.ts  # subscription store
│           └── types.ts
│
├── infra/                    # REUSABLE technical tooling (not domain)
│   ├── tunnel/               # cloudflared / ngrok
│   ├── qr/
│   │   ├── index.ts
│   │   └── qrcode-terminal.d.ts  # ambient declaration for qrcode-terminal lib
│   ├── banner/
│   ├── logger/
│   ├── network/              # getLocalIP
│   ├── auth/                 # generateToken
│   ├── circuit-breaker/
│   ├── paths/
│   └── dotenv/
│
├── dashboard/                # FRONTEND (moved out of server/, organized internally)
│   ├── index.html
│   ├── manifest.json
│   ├── styles.css
│   ├── sw.js
│   ├── main.js
│   ├── constants.js
│   ├── icons/
│   ├── api/                  # backend fetch layer
│   ├── state/                # global dashboard state
│   ├── sse/                  # SSE client
│   ├── auth/                 # auth + connect
│   ├── components/           # panels, sessions, messages, tabs, etc.
│   ├── modals/               # connect, debug, help, modal-helper
│   ├── ui/                   # global widgets (toast, shortcuts, sound, diff)
│   ├── routing/              # hash-dir-router
│   └── __tests__/            # asset-sanity.test.ts (with updated paths)
│
├── tui/                      # OpenCode TUI plugin (no structural changes)
├── cli/                      # `opencode-pilot init` (no structural changes)
│
└── server/                   # FAÇADE — preserves the `./server` npm export
    ├── index.ts              # composition root: wires everything, returns plugin handle
    ├── config.ts             # loadConfig / loadConfigSafe / mergeStoredSettings / resolveSources
    └── constants.ts          # PILOT_VERSION (path is hard-referenced by the release script)
```

### Top-level module responsibilities

| Folder | Purpose | May import from (project-internal) |
|---|---|---|
| `infra/` | Reusable technical plumbing (tunnel, QR, logger, paths, etc.) | NOTHING (absolute bottom) |
| `core/` | Pure domain rules: sessions, permissions, events, audit, settings, state | `infra/` only |
| `transport/` | How the outside world talks to the core (today: only HTTP) | `core/`, `infra/` |
| `integrations/` | Each external CLI agent (opencode, codex) is a closed module with its own wiring API | `core/`, `infra/`, `transport/` (to register routes) |
| `notifications/` | Fan-out to outbound channels (telegram, push, future) | `core/`, `infra/` |
| `dashboard/` | Browser SPA served by `transport/http/` | NOTHING (browser runtime, no backend imports) |
| `tui/` | TUI plugin that registers slash-commands in OpenCode | `core/`, `infra/` |
| `cli/` | `opencode-pilot` binary (`init` command) | `infra/` |
| `server/` | **Façade** — only re-exports to keep `import "@lesquel/opencode-pilot/server"` working | EVERYTHING (this is the composition root) |

### Dependency rule (precise)

- **`infra/` is the absolute bottom.** No project imports.
- **`core/` may import only from `infra/`.** This lets `core/state/store.ts` use `infra/paths/` etc. without dragging the rest of the project into the domain layer.
- **`notifications/`, `integrations/`, `transport/` may import from `core/` and `infra/`.** Cross-imports between siblings (e.g., `transport → integrations`) happen ONLY through the explicit ports (`AgentIntegration.setup({ registerRoute })`), never via direct file imports.
- **`server/index.ts` is the only file that imports across all layers** — composition root, by definition. This is standard hexagonal/clean architecture.

This rule is **enforced by convention** (documented in `AGENTS.md` §3, code review, this spec) — not by ESLint cross-layer rules. If the rule is broken repeatedly in the future, mechanical enforcement via `eslint-plugin-import/no-restricted-paths` becomes the next refactor.

### Why this "screams"

When someone opens `src/`, the tree announces: *"this is a system with a domain (`core`), a transport (`transport`), integrations with CLI agents (`integrations/opencode`, `integrations/codex`), notifications (`notifications/telegram`, `notifications/push`), a dashboard, a TUI, and a CLI."* It does NOT announce *"this is an HTTP server with services and util folders."* That is the difference between **Screaming Architecture** (folder names announce purpose) and traditional layered architecture (folder names announce technology).

---

## Ports

### `NotificationChannel`

Located at `src/notifications/ports.ts`. The contract honored by Telegram, Push, and any future channel (Slack, Discord, email, webhook).

```ts
export interface NotificationChannel {
  readonly name: string;                          // 'telegram' | 'push' | ...
  readonly enabled: () => boolean;                // checked at runtime, not at construction
  readonly send: (event: NotificationEvent) => Promise<NotificationResult>;
}

export type NotificationEvent = {
  kind:
    | 'permission.pending'
    | 'permission.resolved'
    | 'tool.completed'
    | 'session.error';
  payload: Record<string, unknown>;
};

export type NotificationResult =
  | { ok: true }
  | { ok: false; error: string; retriable: boolean };
```

**Design rationale:**
- `enabled()` as a function (not a property) so that runtime config changes via the dashboard `settings-store` activate/deactivate channels without restart.
- `NotificationResult` is a discriminated union so that `pipeline.ts` decides retry/log/discard policy without each channel knowing about it.
- `name` as a string literal so that the audit log records which channel attempted what.

**Adding a new channel** (e.g., Slack):
1. Create `src/notifications/channels/slack/index.ts` with `export function createSlackChannel(config): NotificationChannel`.
2. Add ONE line in the composition root.

Zero changes to `pipeline.ts`. Zero changes to `core/`. That is the architectural payoff.

### `AgentIntegration`

Located at `src/integrations/ports.ts`. The contract honored by the OpenCode native hook integration and the Codex HTTP bridge.

```ts
export interface AgentIntegration {
  readonly name: string;                          // 'opencode' | 'codex'
  readonly setup: (deps: IntegrationDeps) => IntegrationHandle;
}

export type IntegrationDeps = {
  // Core capabilities (every integration needs these)
  permissions: PermissionQueue;
  events: EventBus;
  audit: AuditLog;

  // OPTIONAL capabilities (each integration uses what it needs)
  registerRoute?: (route: RouteSpec) => void;     // Codex uses this
  registerHook?: (event: string, handler: HookFn) => void;  // OpenCode uses this
};

export type IntegrationHandle = {
  readonly shutdown: () => Promise<void>;
};
```

**Design rationale:**
- The composition root passes `registerRoute`/`registerHook` only to integrations that need them. OpenCode never receives `registerRoute` because it does not expose its own HTTP; Codex never receives `registerHook` because it is not a native plugin. Each integration declares its own injection shape.

**Adding a new agent CLI** (e.g., Cursor):
```ts
// src/integrations/cursor/index.ts
export const cursorIntegration: AgentIntegration = {
  name: 'cursor',
  setup: ({ permissions, events, audit, registerRoute }) => {
    registerRoute!({ method: 'POST', path: '/cursor/event', handler: ... });
    return { shutdown: async () => { /* cleanup */ } };
  },
};
```

Plus ONE line in the composition root. Done.

### Why no other ports

Capabilities with a single implementation (`EventBus`, `AuditLog`, `SettingsStore`, `PermissionQueue`, etc.) do NOT get explicit interface ports. Their factory function `createX(): X` already serves as the contract — TypeScript infers and enforces the return shape. Defining `interface AuditPort { append(entry): void }` to wrap a single implementation is ceremony without payoff (this is the "architecture astronaut" anti-pattern explicitly rejected during decision D4).

---

## Web Push subsystem (special case under `notifications/`)

Telegram fits the `NotificationChannel` port cleanly: configure → enabled → send. **Web Push does not** — it has three concerns that go beyond a fire-and-forget channel:

1. **VAPID key generation and persistence** — the `/settings/vapid/generate` HTTP endpoint creates a new key pair and saves it to the settings store.
2. **Subscription registration** — browsers POST their subscription objects; the server stores them so it knows where to push.
3. **Sending push notifications** — the actual channel behavior, fan-out to all subscriptions.

The current `services/push.ts` (`createPushService`) bundles all three. The refactor preserves the bundling **inside one folder** but separates concerns into files, and exposes ONLY the channel surface to the notifications pipeline:

```
src/notifications/channels/push/
├── index.ts          # exports createPushChannel(deps): NotificationChannel  ← used by pipeline
├── service.ts        # exports createPushService(deps) — full subsystem with VAPID + subs API,
│                     #   used by transport/http/handlers/settings.ts
├── vapid.ts          # VAPID key generation + persistence (private, used by service.ts)
├── subscriptions.ts  # subscription store (private, used by both index.ts and service.ts)
└── types.ts          # Push-specific types (PushSubscription, VapidKeys)
```

**Wiring (dependency-rule compliant):**
- The composition root creates the push subsystem once: `const push = createPushService(config.push)`.
- The composition root extracts the channel (`push.channel`) and passes it to `createNotificationService({ channels: [...] })`.
- The composition root **injects `push` into the HTTP server via `createHttpServer({ ..., push })`** so the settings handler can call `push.generateVapid()` and `push.registerSubscription()` through dependency injection — NOT through a direct cross-layer import.
- `transport/http/handlers/settings.ts` therefore reads `push` from its handler-construction parameters; it does NOT contain `import { ... } from '../../../notifications/channels/push/...'`. This preserves the dependency rule (`transport/` imports only from `core/` and `infra/`; the only file allowed to wire `transport ↔ notifications` is `server/index.ts`, the composition root).

This keeps `NotificationChannel` simple and honest (Slack and Discord won't have VAPID), Push's complexity stays co-located in one directory, AND the dependency rule is honored without exception.

---

## Composition root

`src/server/index.ts` becomes the composition root: the only file that imports across all 8 top-level folders.

> **Note:** the pseudocode below is **abridged for readability**. The actual implementation must preserve every wiring step listed in the "Full wiring inventory" subsection that follows. A missed step in Commit 6 is the single biggest risk in the refactor.

```ts
import {
  createPermissionQueue,
  createAuditLog,
  createSettingsStore,
  getSharedEventBus,
} from '../core';
import { loadDotEnv } from '../infra/dotenv';
import { generateToken } from '../infra/auth/token';
import { writeBanner } from '../infra/banner/writer';
import { startTunnel } from '../infra/tunnel';
import { createNotificationService } from '../notifications/pipeline';
import { createTelegramChannel } from '../notifications/channels/telegram';
import { createPushService } from '../notifications/channels/push/service';
import { opencodeIntegration } from '../integrations/opencode';
import { codexIntegration } from '../integrations/codex';
import { createHttpServer } from '../transport/http/server';
import { loadConfigSafe } from './config';

export default function pilotPlugin(ctx: PluginContext) {
  // 0. ENV + CONFIG
  loadDotEnv();
  const { config, errors: configErrors } = loadConfigSafe();
  // (config errors → ctx.client.app.log per AGENTS.md "no silent failures")

  // 1. CORE
  const events      = getSharedEventBus();      // singleton — preserves v1.16.9 process-singleton fix
  const permissions = createPermissionQueue({ timeout: config.permissionTimeout });
  const audit       = createAuditLog({ path: config.auditPath });
  const settings    = createSettingsStore({ path: config.settingsPath });

  // 2. NOTIFICATIONS (Push subsystem first — channel is one slice of it)
  const push     = createPushService(config.push);
  const channels = [
    createTelegramChannel(config.telegram),
    push.channel,
  ].filter((c) => c.enabled());
  const notifications = createNotificationService({ channels, events });

  // 3. STATE + BANNER + TUNNEL + TOKEN
  const token  = generateToken();
  const tunnel = startTunnel(config.tunnel);
  writeBanner({ token, tunnel, ... });
  // writeState / clearState / globalStatePath as today

  // 4. TRANSPORT (HTTP listens to the core; settings handler also calls into push.service)
  const http = createHttpServer({
    permissions, events, audit, settings, push, config, token,
  });

  // 5. INTEGRATIONS (each receives only what it needs)
  const opencode = opencodeIntegration.setup({
    permissions, events, audit,
    registerHook: ctx.registerHook,
  });
  const codex = codexIntegration.setup({
    permissions, events, audit,
    registerRoute: http.registerRoute,
  });

  // 6. START
  http.listen();

  // 7. PLUGIN HANDLE for OpenCode
  return {
    onShutdown: async () => {
      await Promise.all([
        opencode.shutdown(),
        codex.shutdown(),
        http.close(),
        tunnel?.close(),
        notifications.flush(),
      ]);
      // clearState as today
    },
  };
}
```

### Full wiring inventory (must be preserved by Commit 6)

The current `src/server/index.ts` does the following — Commit 6 must preserve every item, no exceptions:

- `loadDotEnv()` — read `.env` from plugin root
- `loadConfigSafe()` — config + structured error list (NOT `loadConfig` which throws)
- `mergeStoredSettings()` — merge persistent JSON config from `~/.opencode-pilot/config.json`
- `resolveSources()` — track which config field came from which source (env / config.json / .env / defaults)
- `getSharedEventBus()` — **singleton getter** (the v1.16.9 fix — DO NOT replace with `createEventBus()` factory at composition root)
- `generateToken()` — auth token + token rotation logic
- `writeState` / `clearState` / `globalStatePath` — pilot-state.json lifecycle
- `writeBanner()` — banner file generation
- `startTunnel()` — cloudflared/ngrok startup
- `createPushService()` — full Web Push subsystem (VAPID + subscriptions + channel)
- `createTelegramBot()` (current name) → renamed to `createTelegramChannel()` in Commit 3
- `createPermissionQueue()`, `createAuditLog()`, `createSettingsStore()` — core
- All hook registrations (`event.ts`, `permission.ask.ts`, `tool.ts`) — through `opencodeIntegration.setup()`
- All `/codex/hooks/*` route registrations — through `codexIntegration.setup()`
- `onShutdown` order: integrations → http → tunnel → notifications.flush → clearState
- Toast / promotion timing logic from `constants.ts` (if any) — preserved as-is in `server/constants.ts`

If you (the implementer) cannot match every item above to a wired call in the new composition root, STOP and reconcile before pushing Commit 6.

---

## Migration plan — 6 commits

Each commit is **independently revertible** and leaves `bun test` and `tsc --noEmit` green. Execute in order on the `feat/codex-hooks-bridge` branch.

### Commit 1 — `feat(arch): extract agent integrations from server/`

**Moves:**
- `src/server/http/codex-handlers.ts` → `src/integrations/codex/handlers.ts`
- `src/server/http/codex-validators.ts` → `src/integrations/codex/validators.ts`
- `src/server/http/codex-handlers.test.ts` → `src/integrations/codex/handlers.test.ts`
- `src/server/http/codex-validators.test.ts` → `src/integrations/codex/validators.test.ts`
- `src/server/hooks/event.ts` → `src/integrations/opencode/hooks/event.ts`
- `src/server/hooks/permission.ask.ts` → `src/integrations/opencode/hooks/permission.ask.ts`
- `src/server/hooks/tool.ts` → `src/integrations/opencode/hooks/tool.ts`
- `src/server/hooks/index.ts` (barrel) → `src/integrations/opencode/hooks/index.ts`

**Updates:**
- `src/server/index.ts` import path for hooks (from `'./hooks'` to `'../integrations/opencode/hooks'`)
- `src/server/http/routes.ts` to point codex routes at the new handler paths

**Notes:** No `AgentIntegration` port definition yet (that lands in Commit 3). Pure file moves + import updates. **Codex routes remain in the central `routes.ts` table as a transient state** — they get removed from the central table in Commit 3 when `codexIntegration.setup({ registerRoute })` takes over. This two-step is intentional: Commit 1 keeps the wiring valid while files relocate; Commit 3 swaps the wiring to the port.

**Pre-flight (recommended):** before staging this commit, run `fd '\.test\.ts' src/server/http src/server/hooks` and confirm every result appears in this commit's move list. Also run `fd '\.test\.ts' src/server/services src/server/util src/server` (top-level services, util, and `src/server/*.test.ts`) and confirm every result appears in Commit 2's move list. Catches the "forgotten file" failure mode that bit revision 1 of this spec.

**Acceptance gate:** `bun test` green + `tsc --noEmit` green.
**Risk:** Low (mechanical).

---

### Commit 2 — `refactor(arch): split services/ and util/ into core/, infra/, notifications/`

**Moves** (largest commit by file count):

```
services/event-bus.ts          → core/events/bus.ts
services/permission-queue.ts   → core/permissions/queue.ts
services/audit.ts              → core/audit/log.ts
services/audit-rotation.ts     → core/audit/rotation.ts
services/state.ts              → core/state/store.ts
services/settings-store.ts     → core/settings/store.ts
services/notifications.ts      → notifications/pipeline.ts
services/telegram.ts           → notifications/channels/telegram/index.ts
services/push.ts               → notifications/channels/push/service.ts (renamed file)
services/tunnel.ts             → infra/tunnel/index.ts
services/qr.ts                 → infra/qr/index.ts
services/banner.ts             → infra/banner/writer.ts
util/auth.ts                   → infra/auth/token.ts
util/network.ts                → infra/network/ip.ts
util/circuit-breaker.ts        → infra/circuit-breaker/index.ts
util/logger.ts                 → infra/logger/index.ts
util/paths.ts                  → infra/paths/index.ts
util/dotenv.ts                 → infra/dotenv/index.ts
server/strings.ts              → core/strings.ts
server/qrcode-terminal.d.ts    → infra/qr/qrcode-terminal.d.ts
server/types.ts (split):
  PilotError + ConfigError     → core/errors.ts
  PilotEvent + BusEvent + ...  → core/events/types.ts
server/types.test.ts (split accordingly):
  error tests                  → core/errors.test.ts
  event-type tests             → core/events/types.test.ts
```

Co-located `*.test.ts` files travel with each source file.

**Adds:**
- `src/core/index.ts` — barrel re-exporting `getSharedEventBus`, `createPermissionQueue`, `createAuditLog`, `createSettingsStore`, plus error types and event types. (Used by composition root in Commit 6.)

**Critical comment fixes (each prevents silent rot):**
- `infra/dotenv/index.ts` (formerly `src/server/util/dotenv.ts`) contains the comment `// src/server/util/dotenv.ts → plugin root is 3 levels up`. The new path is also 3 levels up (`src/infra/dotenv/index.ts` → `../../..`), so behavior is preserved by coincidence. UPDATE the comment to `// src/infra/dotenv/index.ts → plugin root is 3 levels up` so a future move doesn't silently break dotenv loading.
- `src/server/services/state.test.ts` line 1 contains `// Tests for src/server/services/state.ts`. After this commit the source path is `src/core/state/store.ts` and the test moves with it. UPDATE the comment to `// Tests for src/core/state/store.ts`.
- Audit any other test file headers that reference `src/server/services/...` or `src/server/util/...` paths via `rg -n "src/server/(services|util)/" src/server --type ts` and update accordingly.

**Acceptance gate:** `bun test` + `tsc --noEmit`.
**Risk:** Medium. Many import paths change. Recommended workflow: use `sd` for bulk path rewrites, then rely on `tsc --noEmit` to surface anything missed.

---

### Commit 3 — `feat(arch): define NotificationChannel and AgentIntegration ports`

**Adds:**
- `src/notifications/ports.ts` with `interface NotificationChannel`
- `src/integrations/ports.ts` with `interface AgentIntegration`
- `src/integrations/opencode/index.ts` exporting `opencodeIntegration: AgentIntegration` (uses the hooks barrel from Commit 1)
- `src/integrations/codex/index.ts` exporting `codexIntegration: AgentIntegration` (uses handlers + validators from Commit 1)
- `src/notifications/channels/push/index.ts` exporting `createPushChannel(deps): NotificationChannel`
- `src/notifications/channels/push/vapid.ts` (extracted from `service.ts` if currently bundled)
- `src/notifications/channels/push/subscriptions.ts` (extracted from `service.ts` if currently bundled)
- `src/notifications/channels/push/types.ts`

**Refactors / renames:**
- `notifications/channels/telegram/index.ts` — current `createTelegramBot` is renamed to `createTelegramChannel` and refactored to return an object matching `NotificationChannel`. Bot-specific internals (polling, command handling) become private helpers within the same file.
- `notifications/channels/push/service.ts` — keeps the name `createPushService` but re-exposed as the subsystem entry (returns `{ channel, generateVapid, registerSubscription, ... }`). The HTTP `/settings/vapid/generate` handler imports from this surface.
- `notifications/pipeline.ts` — refactored to iterate `NotificationChannel[]` instead of hard-coding telegram and push.
- Existing `src/server/index.ts` (still the entry, not yet pure composition root) updated to wire via the new ports while preserving every step in the "Full wiring inventory."
- **Codex routes leave the central `routes.ts` table.** Codex now self-registers via `codexIntegration.setup({ registerRoute: http.registerRoute })`. Remove all `/codex/*` entries from `transport/http/routes.ts`. After this commit, the central routes table contains ONLY core pilot routes; integrations attach their own routes through the port.
- **`opencodeIntegration` injection-shape spike (30 min).** The pseudocode passes `registerHook: ctx.registerHook` from the OpenCode `PluginContext`. Verify this matches the actual OpenCode plugin SDK contract (it may instead expect plugins to return hook handlers from the default export). If the contract differs, restructure `opencodeIntegration.setup()` to RETURN the hook handlers, and let the composition root attach them to the OpenCode plugin's return object. This must be resolved within Commit 3, not deferred.

**Acceptance gate:** `bun test` + `tsc --noEmit` + manual smoke test (plugin starts, `POST /codex/hooks/event` returns 200, `GET /sessions` returns expected shape, `POST /settings/vapid/generate` returns a key pair, `GET /events` SSE streams).
**Risk:** Medium. Function signatures change. Critical to preserve Telegram/Push `enabled()` semantics, the Push VAPID/subscription endpoints, AND the OpenCode plugin contract for hook registration.

**Push test reshape (don't forget):** `src/notifications/channels/push/service.test.ts` (formerly `src/server/services/push.test.ts`) currently asserts against the old single-object `createPushService` shape. After the reshape returns `{ channel, generateVapid, registerSubscription, ... }`, every assertion that called `svc.send(...)` becomes `svc.channel.send(...)`. Audit and rewrite assertions as part of this commit.

---

### Commit 4 — `refactor(arch): move http/ to transport/http/ and split handlers/validators by domain`

**Moves:**
- `src/server/http/server.ts` → `src/transport/http/server.ts`
- `src/server/http/server.test.ts` → `src/transport/http/__tests__/server.test.ts` (it exercises full dispatch — integration)
- `src/server/http/routes.ts` → `src/transport/http/routes.ts`
- `src/server/http/auth.ts` → `src/transport/http/middlewares/auth.ts`
- `src/server/http/auth.test.ts` → `src/transport/http/middlewares/auth.test.ts`
- `src/server/http/cors.ts` → `src/transport/http/middlewares/cors.ts`
- `src/server/http/json.ts` → `src/transport/http/middlewares/json.ts`
- `src/server/http/validation.ts` → `src/transport/http/validation.ts`
- `src/server/http/validation.test.ts` → `src/transport/http/validation.test.ts`

**Splits (unconditional — even if current files are under threshold, the split clarifies boundaries):**
- `src/server/http/handlers.ts` → `src/transport/http/handlers/{sessions,permissions,events,settings,system,projects}.ts`
- `src/server/http/handlers.test.ts` → split into per-domain `*.test.ts` files co-located with the new handlers
- `src/server/http/settings.test.ts` → `src/transport/http/handlers/settings.test.ts`
- `src/server/http/validators.ts` → `src/transport/http/validators/{common,sessions,...}.ts`
- `src/server/http/validators.test.ts` → split co-located with the new validators

After the split, each `*.test.ts` lives next to the `.ts` it tests (co-located unit). Only `server.test.ts` (which exercises full dispatch across handlers/middlewares) goes to `__tests__/`.

**Acceptance gate:** `bun test` + `tsc --noEmit`.
**Risk:** Low–medium. Mechanical splits, but tests must cover the route dispatch.

---

### Commit 5 — `refactor(arch): move dashboard out of server/ and structure internally` ⚠️

**Moves and groups the ~50 `.js` files:**

```
api/         → api.js, api-fetch.js
state/       → state.js
sse/         → sse.js
auth/        → auth.js, connect.js
components/  → agent-panel, command-history, command-palette, cost-panel,
               file-browser, files-changed, files-changed-bridge, label-strip,
               markdown, messages, multi-view, permissions, pinned-todos,
               project-tabs, references, right-panel, sessions, settings,
               subagents, todo-dock, usage-indicator, welcome
modals/      → connect-modal, debug-modal, help-modal, modal-helper
ui/          → notif-sound, push-notifications, shortcuts, toast, diff
routing/     → hash-dir-router.js, hash-dir-router.d.ts
```

Stay at root: `index.html`, `manifest.json`, `styles.css`, `sw.js`, `main.js`, `constants.js`, `icons/`, `HANDOFF.md`, `__tests__/`.

**Updates required (each is a runtime-only failure if missed — `tsc` will NOT catch them):**

1. **`<script src="...">` paths in `index.html`** — every script tag needs the new sub-folder path.
2. **Dynamic `import()` calls inside the `.js` files** — many components dynamically import siblings; these strings need rewriting too. Run `rg "import\(" src/dashboard --type js` AND `rg 'from "' src/dashboard --type js` and audit every result. Static `import "..."` and dynamic `import("...")` both need new sub-folder paths.
3. **`sw.js` cache version bump** — bump the cache name (e.g., `pilot-cache-v1.18.0`) so existing browsers do not serve stale asset paths from the old cache. Update the precache list to the new paths.
4. **`src/server/dashboard/__tests__/asset-sanity.test.ts`** moves to `src/dashboard/__tests__/asset-sanity.test.ts` AND its hardcoded path strings are updated:
   - `join(ROOT, "src/server/dashboard/index.html")` → `join(ROOT, "src/dashboard/index.html")`
   - `join(ROOT, "src/server/dashboard/sw.js")` → `join(ROOT, "src/dashboard/sw.js")`
   - `const DASHBOARD_DIR = join(ROOT, "src/server/dashboard")` → `const DASHBOARD_DIR = join(ROOT, "src/dashboard")` (the loop that scans the dashboard directory for hardcoded `PILOT_VERSION` strings — if `DASHBOARD_DIR` points at a non-existent path, the loop reads zero `.js` files and the regression test silently no-ops)
   - `join(ROOT, "src/server/constants.ts")` → **stays** (constants.ts does NOT move)
   - Audit any other `join(ROOT, "src/server/...")` strings in the test body via `rg "src/server" src/server/dashboard/__tests__/` (run BEFORE the move)

   These are `fs` reads, not `import` paths, so `tsc --noEmit` will not detect a wrong path. The test fails at `bun test` runtime — and worse, may silently no-op if a path resolves to nothing. This test is the asset-sanity guard called out by `AGENTS.md` §4 — if it silently no-ops because of a wrong path, the release pre-flight is disarmed.

5. **`src/server/http/handlers.ts` (now at `src/transport/http/handlers/system.ts` after Commit 4) computes `DASHBOARD_DIR = join(__dirname, "...")` to serve `/dashboard/*`.** The `__dirname` arithmetic must change:
   - **Before** Commit 5: `src/server/http/handlers.ts` → `dashboard/` is `join(__dirname, "../dashboard")` (1 level up).
   - **After** Commit 4 alone (Commit 5 not yet applied): `src/transport/http/handlers/system.ts` → `dashboard/` is `join(__dirname, "../../../server/dashboard")` (3 levels up). This is a transient state — Commit 5 immediately follows.
   - **After** Commit 5: `src/transport/http/handlers/system.ts` → `dashboard/` is `join(__dirname, "../../../dashboard")` (3 levels up to `src/`, then into `dashboard/`).
   
   Get this wrong by one segment and the dashboard is silently 404 with `tsc` green and unit tests passing. Verify by hitting `GET /` and `GET /dashboard/main.js` after the commit.

6. **`src/server/dashboard/__tests__/integration.test.ts`** (if present) moves with the dashboard. This test currently imports from `../../services/...` and references `createTelegramBot` / `createPushService` by their old names. After Commit 2 those import paths broke; after Commit 3 the names changed. Audit and update both the import paths AND the symbol names as part of THIS commit (Commit 5), since the file moves now.

**Acceptance gate:** `bun test` + `tsc --noEmit` + **MANDATORY MANUAL SMOKE TEST**:
1. Start the plugin (`PILOT_DEV=false` first).
2. Open the dashboard in a browser, **hard-refresh once** to clear old SW cache.
3. Navigate the main flows (sessions, permissions, settings, modals, live SSE).
4. Confirm the service worker is serving from the new cache version (check DevTools → Application → Service Workers).
5. Confirm `GET /dashboard/main.js`, `GET /dashboard/styles.css`, `GET /dashboard/manifest.json` all return 200 (not 404).
6. Restart with `PILOT_DEV=true` and confirm dev re-read still hits the right files (the dev re-read path uses `Bun.file(DASHBOARD_INDEX_PATH).text()` which depends on the new `__dirname` arithmetic).

**Risk: HIGH.** ⚠️ The dashboard is plain `.js` with no types — `tsc --noEmit` will not catch a wrong `<script>` path, a broken dynamic `import`, a wrong `__dirname` calculation, or a hardcoded test path. These manifest only at runtime in the browser or at `bun test`. The manual smoke test is non-negotiable before push.

---

### Commit 6 — `feat(arch): rewrite server/index.ts as composition root + update docs`

**The crown commit:**
- Rewrite `src/server/index.ts` per the composition root pseudocode AND the "Full wiring inventory" subsection above. Every item in the inventory must be present.
- Verify `package.json` `exports./server` and `exports./tui` still resolve (same paths, new content).
- `src/server/constants.ts` stays in place — `PILOT_VERSION` path is hard-referenced by the release script.
- Update stale comments in `src/tui/paths.ts` and `src/tui/types.ts` that reference moved paths (`src/server/services/state.ts` → `src/core/state/store.ts`; `src/server/util/paths.ts` → `src/infra/paths/index.ts`).
- Update `AGENTS.md` §3 (Hard conventions — Structure section).
- Update `AGENTS.md` §4 (Release process) — change the `# bump THREE places` example to point to the new path (`src/server/dashboard/index.html` was the old path, but in the new tree the GEN bump is at `src/dashboard/index.html`).
- Update `CLAUDE.md` (Structure section, full rewrite).
- Create `docs/ARCHITECTURE.md` documenting the 8 modules, the 2 ports, the composition root, the dependency rule, and the "how to add a new integration / channel" recipes.
- Add `CHANGELOG.md` entry under `## [1.18.0]` with `### Changed` describing the refactor and an explicit "no breaking changes" note. Do NOT bump `package.json`/`PILOT_VERSION`/dashboard `GEN` here — that is the separate release process per `AGENTS.md` §4.

**Acceptance gate:** Full CI pipeline locally — `bun scripts/prepublish-guard.ts && tsc --noEmit && bun test` — plus end-to-end smoke (plugin loads in OpenCode, dashboard navigable, codex hook responds, telegram/push send if configured, VAPID generate endpoint works).
**Risk:** Medium–high. The composition root is THE wiring; any item from the "Full wiring inventory" missed silently breaks runtime even with tests green.

---

### Sequence summary

| # | Commit | Risk | Acceptance gate |
|---|---|---|---|
| 1 | extract agent integrations | low | `bun test` |
| 2 | split services/ + util/ → core/infra/notifications | medium | `bun test` |
| 3 | define ports + refactor implementations + Push subsystem split | medium | `bun test` + smoke |
| 4 | move http/ → transport/http/ + split handlers + validators | low–medium | `bun test` |
| 5 | move dashboard out + structure | **HIGH** ⚠️ | `bun test` + **manual smoke** |
| 6 | composition root + docs | medium–high | full CI + E2E smoke |

**Estimated effort:** 2–4 focused sessions. Commits 1–2 in one session (~2h). Commits 3–4 in another. Commit 5 alone (it is the dangerous one). Commit 6 with full CI verification.

---

## Backward compatibility

| Public surface | Changes? | Notes |
|---|---|---|
| `import "@lesquel/opencode-pilot/server"` | NO | Same path, same default export. Internally is now the composition root. |
| `import "@lesquel/opencode-pilot/tui"` | NO | Same path, same module. |
| `npx opencode-pilot init` (CLI) | NO | Same binary, same UX. `cli/init.test.ts` may have imports from `util/` — those import paths update in Commit 2. |
| HTTP routes (the 30+ in `CLAUDE.md` route table) | NO | Same paths, same auth, same behavior. |
| SSE events (`PilotEvent` discriminated union) | NO | Same `kind` values, same payloads. |
| `PILOT_*` environment variables | NO | Same names, same priority. |
| On-disk paths (`~/.opencode-pilot/`, `.opencode/`) | NO | Same paths, same formats. |
| OpenCode plugin contract (`ctx`, `onShutdown`) | NO | Same handle shape. |

This refactor is `v1.18.0` — minor bump. The bump is "minor" by architectural significance, not by user-facing behavior change.

---

## Tests strategy

| Test type | Location | Example |
|---|---|---|
| Unit (co-located) | next to the source file | `core/permissions/queue.ts` ↔ `core/permissions/queue.test.ts` |
| Integration (cross-file dispatch) | `__tests__/` per module | `transport/http/__tests__/server.test.ts` |
| Asset / sanity guards | `__tests__/` of the relevant module | `dashboard/__tests__/asset-sanity.test.ts` |

**No top-level `tests/` folder.** `AGENTS.md` §3 mandates co-location for atomic refactors; this convention is preserved.

**Reclassification in Commit 4:** `server.test.ts` (which exercises full HTTP dispatch across handlers + middlewares) moves to `transport/http/__tests__/server.test.ts`. All other current http/ tests (`auth.test.ts`, `validation.test.ts`, `settings.test.ts`, etc.) stay co-located with their respective source file.

**Coverage:** post-refactor coverage is the same as pre-refactor. This is a behavior-preserving refactor; no new tests are added beyond what is needed to follow split files. Test count may shift by ±1 per split file, nothing meaningful.

---

## Documentation updates (Commit 6)

| File | Update |
|---|---|
| `AGENTS.md` §3 (Hard conventions — Structure) | Rewrite to list the 8 top-level folders, the dependency rule, the 2 ports |
| `AGENTS.md` §4 (Release process) | Update the example to `src/dashboard/index.html` instead of `src/server/dashboard/index.html` |
| `CLAUDE.md` (Structure) | Rewrite the entire section with the new tree |
| `docs/ARCHITECTURE.md` | **Create** (does not exist today). Documents 8 modules, 2 ports, composition root, dependency rule, and recipes for adding a new integration or channel |
| `src/tui/paths.ts` and `src/tui/types.ts` | Update header comments that reference moved paths |
| `CHANGELOG.md` | Entry `## [1.18.0]` with `### Changed` describing the refactor and an explicit "no breaking changes" note |

---

## Out of scope (explicitly NOT in this refactor)

- ❌ **Migrate dashboard to TypeScript.** Separate dedicated round.
- ❌ **Codex Phase 2 / new agent integrations.** Only existing files are moved. Cursor / Aider remain future work — the new structure enables them but does not implement them.
- ❌ **New notification channels.** Slack / Discord are not added. The port is ready for plugin once needed.
- ❌ **ESLint cross-layer enforcement** (`eslint-plugin-import/no-restricted-paths`). Convention via `AGENTS.md` is sufficient for now. Mechanical enforcement is a follow-up if violations recur.
- ❌ **TUI internal restructure.** `src/tui/` is structurally sound and is not touched (only stale comment updates).
- ❌ **Version bump and npm release.** The refactor ends with the push of Commit 6. The release process (tag → push tag → CI publishes) is a separate subsequent step per `AGENTS.md` §4.
- ❌ **CQRS, aggregates, repositories, domain events separated from the SSE bus.** Architecture-astronaut territory. Rejected during decision D1.

---

## Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Dashboard service worker caches old asset paths in users' browsers | High | Medium (broken dashboard until hard refresh) | Bump `sw.js` cache version in Commit 5; explicit CHANGELOG note: "If the dashboard looks broken after upgrade, hard-refresh once" |
| `tsc --noEmit` does not catch errors in `.js` dashboard (runtime only) | High | High | Mandatory manual smoke test in Commit 5 before push |
| `__dirname` arithmetic in the dashboard-serving handler is off by one segment | Medium | High (silent 404) | Explicit before/after path math documented in Commit 5; verify with `GET /dashboard/main.js` after the commit |
| `asset-sanity.test.ts` hardcoded path strings drift from filesystem | Medium | High (release pre-flight silently disarmed) | Explicit string-by-string update list in Commit 5; verify at `bun test` time |
| Composition root mis-wired → an item from "Full wiring inventory" is silently dropped | Medium | High | Implementer must check off every item in the inventory; E2E smoke test in Commit 6 |
| Push subsystem split breaks VAPID generation or subscription registration | Medium | Medium | Smoke test in Commit 3 includes `POST /settings/vapid/generate` and `POST /push/subscribe` |
| Release script paths point to moved files | Medium | Low (CI catches it) | Audit `scripts/prepublish-guard.ts` in Commit 6 |
| New circular import appears in composition root | Low | Medium | `tsc --noEmit` catches it before push |
| `dotenv.ts` levels-up arithmetic silently breaks if path changes | Low | High (config not loaded) | Comment update in Commit 2 documents the assumption |
| Partial rollback needed | Low | Low | Each commit is atomic and bisectable; `git revert <sha>` is always available |

---

## Definition of Done

The refactor is complete when ALL of the following are true:

1. ✅ The 6 commits land on `feat/codex-hooks-bridge`, each with tests green.
2. ✅ Full CI pipeline locally green: `bun scripts/prepublish-guard.ts && tsc --noEmit && bun test`.
3. ✅ Manual E2E smoke test passes: plugin loads in OpenCode, dashboard is navigable end-to-end after a hard-refresh, `POST /codex/hooks/event` responds correctly, Telegram and Push send if configured, `POST /settings/vapid/generate` returns a key pair, `GET /events` SSE streams.
4. ✅ `AGENTS.md`, `CLAUDE.md`, and `docs/ARCHITECTURE.md` describe exactly the on-disk structure.
5. ✅ `CHANGELOG.md` has a clear and honest `## [1.18.0]` entry with explicit "no breaking changes" notice.
6. ✅ Every item in the "Full wiring inventory" subsection is matched by a wired call in the new composition root.
7. ✅ **Architectural litmus test:** if the maintainer wanted to add an integration with a new agent (e.g., "Cursor") in one free hour, it should require ONE new folder under `integrations/cursor/` plus ONE line in the composition root. If it requires more, the refactor failed.

---

## References

- `AGENTS.md` §3 — Hard conventions (factory functions, no silent failures, tests co-located, ~300 LoC per file)
- `AGENTS.md` §4 — Release process (the three-version-bump rule, tag/push order, hardcoded file paths)
- `AGENTS.md` §5 — Debugging playbook for silent failures (relevant to dashboard runtime risks in Commit 5)
- `CLAUDE.md` — Current structure and route table baseline
- `scripts/prepublish-guard.ts` — Release pre-flight script (must be audited in Commit 6 if any path moved)
- This spec was produced via `/brainstorming` skill on 2026-04-25 (revision 2 after spec-document-reviewer feedback)
