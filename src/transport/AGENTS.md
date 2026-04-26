# transport

**Purpose:** Exposes core domain capabilities to the outside world — today exclusively over HTTP + Server-Sent Events.

## Imports (dependency rule)
- May import from: `core/`, `infra/`
- **Note:** `routes.ts`, `server.ts`, `handlers/settings.ts`, `handlers/system.ts`, and `validators/settings.ts` also import from `server/constants` and `server/config` for `Config`, `PILOT_VERSION`, `LOCALHOST_ADDRESSES`, `MAX_REQUEST_BODY_BYTES`, and `VAPID_DEFAULT_SUBJECT`. This is a documented deviation from the strict rule — those constants travel down via dependency injection in practice, but are currently imported directly.
- May NOT import from: `integrations/`, `notifications/`

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
- Add business logic to handlers — handlers orchestrate `core/` services, they don't own rules.

## See also
- `docs/ARCHITECTURE.md` — overall architecture and dependency rule
- `src/core/AGENTS.md` — the domain layer handlers delegate to
- `src/integrations/AGENTS.md` — codex self-registers routes via `registerRoute`
