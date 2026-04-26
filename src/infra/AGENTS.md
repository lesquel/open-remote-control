# infra

**Purpose:** Reusable technical plumbing — filesystem helpers, networking, auth tokens, HTTP primitives, circuit breaker, QR codes, banner, logger, and dotenv — with zero domain logic.

## Imports (dependency rule)
- May import from: Node.js built-ins, third-party npm packages only
- **VIOLATION:** `infra/tunnel/index.ts` currently imports `TunnelProvider` from `server/config` and `TUNNEL_URL_PATTERNS / TUNNEL_START_TIMEOUT_MS / TUNNEL_KILL_GRACE_MS` from `server/constants`. This breaks the "absolute bottom" invariant. These constants/types should be moved to `infra/` or passed as arguments.
- May NOT import from: any other `src/` module

## Public API (what other modules consume from here)
- `generateToken(): string` — (`auth/token.ts`) 64-hex auth token
- `writeBanner()` — (`banner/writer.ts`) writes the connection-info banner file
- `createCircuitBreaker()` — (`circuit-breaker/index.ts`) half-open/open/closed state machine
- `loadDotEnv()` — (`dotenv/index.ts`) loads `.env` from the project root
- `validateToken / validateHookToken / getIP / safeEqual` — (`http/auth.ts`) request auth helpers
- `CORS_HEADERS / corsPreflightResponse` — (`http/cors.ts`)
- `json / jsonError` — (`http/json.ts`) typed JSON response helpers
- `readBoundedText()` — (`http/text.ts`) bounded body reader
- `RouteContext<TDeps> / Route<TDeps> / AuthRequirement / RouteParams` — (`http/types.ts`) generic HTTP types
- `createLogger(): Logger` — (`logger/index.ts`) wraps `ctx.client.app.log`
- `getLocalIP(): string` — (`network/ip.ts`)
- `getPluginConfigDir / getPluginStateDir / configFile / stateFile / shouldWriteProjectState` — (`paths/index.ts`)
- `generateQR()` — (`qr/index.ts`)
- `startTunnel()` — (`tunnel/index.ts`)

## Key files
- `http/types.ts` — `RouteContext<TDeps>`, `Route<TDeps>` — the generic HTTP contract shared by `transport/` and `integrations/`
- `http/auth.ts` — token validation + IP extraction
- `paths/index.ts` — XDG-aware path resolution for config and state files
- `tunnel/index.ts` — cloudflared / ngrok process management (**has server/ import violation**)
- `circuit-breaker/index.ts` — generic circuit breaker for external HTTP calls

## DO NOT
- Add domain logic (permissions, audit rules, event types) here.
- Import from `core/`, `transport/`, `integrations/`, `notifications/`, or `server/`. The tunnel violation must not spread to other files.

## See also
- `docs/ARCHITECTURE.md` — dependency rule (infra is the absolute bottom)
- `src/core/AGENTS.md` — `core/` is the only direct consumer that builds domain logic on top of infra
