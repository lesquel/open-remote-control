# integrations

**Purpose:** Adapters for external CLI agents — each integration is a closed module that connects an agent CLI to the core domain without touching transport internals.

## Imports (dependency rule)
- May import from: `core/`, `infra/`
- May NOT import from: `transport/` (transport types come via `infra/http/types`), `notifications/`, `server/`
- `MAX_REQUEST_BODY_BYTES` comes from `infra/http/constants` — NOT from `server/constants`

## Public API (what other modules consume from here)
- `opencodeIntegration` — native SDK hook wiring plus the shared `AgentDescriptor` metadata contract
- `codexIntegration: AgentIntegration` — HTTP bridge via `POST /codex/hooks/:event`
- `interface AgentIntegration` and `createAgentIntegration()` — (`ports.ts`) the extension point for HTTP/hook-bridged agents
- `AgentDescriptor` / `AgentCapabilities` — shared metadata contract used by both imperative and native-SDK integrations
- `type IntegrationDeps` — (`ports.ts`) what the composition root injects into every integration
- `type IntegrationHandle` — (`ports.ts`) what `setup()` returns (always includes `shutdown`)
- `type RouteSpec` — (`ports.ts`) used by integrations that self-register HTTP routes

## Key files
- `ports.ts` — `AgentIntegration`, `IntegrationDeps`, `IntegrationHandle`, `RouteSpec`
- `opencode/index.ts` — `opencodeIntegration`; wires SDK hooks via `registerHook`
- `opencode/hooks/event.ts` — maps OpenCode events to `PilotEvent` bus
- `opencode/hooks/permission.ask.ts` — binds OpenCode permissions to the plugin directory before bridging them to `PermissionQueue`
- `opencode/attention.ts` — adapts OpenCode v2 native permission and question APIs to `AgentAttentionService`
- `opencode/client.ts` — creates the separate OpenCode v2 attention client, including configured server Basic auth
- `opencode/hooks/tool.ts` — tool started/completed events + notification trigger
- `codex/index.ts` — `codexIntegration`; self-registers `POST /codex/hooks/:event`
- `codex/handlers.ts` — dispatch table for hook event types; retains the SessionStart cwd only for active-session permission context
- `codex/validators.ts` — Codex hook body validation

## Conventions specific to this folder
- Adding a new agent CLI = one new sub-folder + one line in `server/index.ts`. Zero changes elsewhere.
- `setup(deps)` receives everything it needs via `IntegrationDeps`. No direct imports from `transport/`.
- Codex uses `infra/http/` utilities directly (auth, json, cors) — not the transport re-exports.

## DO NOT
- Import from `transport/http/` — use `infra/http/types` for `RouteContext` and `Route`.
- Register routes by mutating `transport/http/routes.ts` — call `deps.registerRoute()` instead.

## See also
- `docs/ARCHITECTURE.md` — AgentIntegration port and composition root recipe
- `src/core/AGENTS.md` — the domain services integrations consume
- `src/infra/AGENTS.md` — HTTP utilities used by codex handlers
