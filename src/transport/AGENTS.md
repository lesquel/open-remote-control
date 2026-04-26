# transport

**Purpose:** Exposes core domain capabilities to the outside world — today exclusively over HTTP + Server-Sent Events.

## Imports (dependency rule)
- May import from: `core/`, `infra/`
- May NOT import from: `integrations/`, `notifications/`, `server/`
- `Config` type comes from `core/types/config` — NOT from `server/config`
- HTTP constants (`MAX_REQUEST_BODY_BYTES`, `LOCALHOST_ADDRESSES`, `VAPID_DEFAULT_SUBJECT`) come from `infra/http/constants`
- `PILOT_VERSION` is injected via `RouteDeps.pilotVersion` from the composition root — handlers never import it directly
- Config-loading utilities (`loadConfigSafe`, `mergeStoredSettings`, etc.) are injected via `RouteDeps.settingsLoader` — `handlers/settings.ts` never imports from `server/config` directly
- **Test files** (`*.test.ts`) that verify the settings integration boundary may import from `server/config` to construct realistic `settingsLoader` implementations — this is accepted for tests only

## Public API (what other modules consume from here)
- `createRemoteServer(deps: RouteDeps): RemoteServer` — creates the Bun HTTP server, registers routes, exposes `server.registerRoute()` for integrations
- `interface RouteDeps` — the full dependency bag injected by the composition root
- `interface RemoteServer` — `{ start, stop, registerRoute }`
- `checkBodySize()` — 413 guard, re-exported for integrations
- `readBoundedText()` — streaming body reader with size cap

## Key files
- `http/server.ts` — `createRemoteServer`; Bun.serve setup + route dispatch
- `http/routes.ts` — core route table, `RouteDeps` type, `matchRoute()`
- `http/validation.ts` — generic body validation middleware
- `http/handlers/sessions.ts` — `/sessions*` endpoints
- `http/handlers/permissions.ts` — `/permissions*` endpoints
- `http/handlers/events.ts` — `/events` SSE endpoint
- `http/handlers/settings.ts` — `/settings*` + `/settings/vapid/generate` + push endpoints
- `http/handlers/system.ts` — `/`, `/dashboard/*`, `/status`, `/health`, `/connect-info`, `/auth/rotate`
- `http/handlers/projects.ts` — `/projects`, `/project/current`
- `http/middlewares/auth.ts` — re-exports `validateToken`, `getIP`, `safeEqual` from `infra/http/auth`
- `http/middlewares/cors.ts` — re-exports CORS helpers from `infra/http/cors`
- `http/middlewares/json.ts` — re-exports `json`, `jsonError` from `infra/http/json`
- `http/__tests__/` — cross-handler integration tests

## Conventions specific to this folder
- Codex routes are NOT in `routes.ts`. The codex integration self-registers via `server.registerRoute()` in `codexIntegration.setup()`.
- Each handler file owns one domain (sessions, permissions, events, settings, system, projects).

## DO NOT
- Import from `integrations/` or `notifications/` directly — use dependency injection via `RouteDeps`.
- Import from `server/constants` or `server/config` — constants live in `infra/http/constants`, types in `core/types/config`.
- Import `PILOT_VERSION` directly — use `deps.pilotVersion` (injected by composition root).
- Import `loadConfigSafe` / `mergeStoredSettings` / `resolveSources` directly — use `deps.settingsLoader` (injected by composition root).
- Add business logic to handlers — handlers orchestrate `core/` services, they don't own rules.

## See also
- `docs/ARCHITECTURE.md` — overall architecture and dependency rule
- `src/core/AGENTS.md` — the domain layer handlers delegate to
- `src/integrations/AGENTS.md` — codex self-registers routes via `registerRoute`
