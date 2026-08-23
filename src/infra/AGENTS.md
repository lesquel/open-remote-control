# infra

**Purpose:** Reusable technical plumbing — filesystem helpers, networking, auth tokens, HTTP primitives, circuit breaker, QR codes, banner, logger, and dotenv — with zero domain logic.

## Imports (dependency rule)
- May import from: Node.js built-ins, third-party npm packages only
- May NOT import from: any other `src/` module

## Public API (what other modules consume from here)
- `generateToken(): string` — (`auth/token.ts`) 64-hex auth token
- `writeBanner()` — (`banner/writer.ts`) writes the connection-info banner file
- `DEFAULT_PWA_URL` — (`banner/constants.ts`) canonical hosted-PWA default
- `createCircuitBreaker()` — (`circuit-breaker/index.ts`) half-open/open/closed state machine
- `loadDotEnv()` — (`dotenv/index.ts`) loads `.env` from the project root
- `validateToken / validateHookToken / getBearerToken / getIP / safeEqual` — (`http/auth.ts`) strict request auth helpers
- `CORS_HEADERS / corsPreflightResponse` — (`http/cors.ts`)
- `validateBrowserBoundary / applyBrowserResponseHeaders` — (`http/browser-security.ts`) DNS-rebinding, Origin, CORS, and browser-header boundary
- `json / jsonError` — (`http/json.ts`) typed JSON response helpers with optional diagnostic request IDs
- `readBoundedText()` — (`http/text.ts`) bounded body reader
- `readBoundedBytes()` — (`http/text.ts`) streaming byte cap for request middleware
- `writePrivateFile()` — (`fs/private-file.ts`) atomic owner-private credential file replacement
- `resolveContainedFile()` — (`fs/contained-file.ts`) canonical project-boundary proof for local files
- `RouteContext<TDeps> / Route<TDeps> / AuthRequirement / RouteParams` — (`http/types.ts`) generic HTTP types, including the server-assigned request ID
- `createLogger(): Logger` — (`logger/index.ts`) wraps `ctx.client.app.log`, recursively redacts values, and retains 20 sanitized recent errors for local diagnostics
- `logging/redact.ts` — bounded, cycle-safe secret and URL redaction shared by logs and audit persistence
- `http/rate-limit.ts` — bounded in-memory fixed-window limiter used for auth failures and mutation routes
- `getLocalIP(): string` — (`network/ip.ts`)
- `validateEndpoint() / isPublicIpAddress()` — (`network/ssrf.ts`) outbound HTTPS URL and IP policy
- `createSafeHttpsFetcher()` — (`network/safe-https-fetch.ts`) DNS-pinned bounded HTTPS client
- `getPluginConfigDir / getPluginStateDir / configFile / stateFile / shouldWriteProjectState` — (`paths/index.ts`)
- `generateQR()` — (`qr/index.ts`)
- `startTunnel()` — (`tunnel/index.ts`)
- `TunnelProvider` — (`tunnel/types.ts`) type re-exported from `server/config`
- `TUNNEL_START_TIMEOUT_MS / TUNNEL_KILL_GRACE_MS / TUNNEL_URL_PATTERNS` — (`tunnel/constants.ts`)
- `MAX_REQUEST_BODY_BYTES / HTTP_STATUS / LOCALHOST_ADDRESSES / VAPID_DEFAULT_SUBJECT / DEFAULT_HOST / DEFAULT_PORT` — (`http/constants.ts`)

## Key files
- `http/types.ts` — `RouteContext<TDeps>`, `Route<TDeps>` — the generic HTTP contract shared by `transport/` and `integrations/`
- `http/auth.ts` — token validation + IP extraction
- `http/browser-security.ts` — Host/Origin validation and browser response hardening
- `fs/private-file.ts` — same-directory atomic writes with private POSIX file/directory modes
- `fs/contained-file.ts` — realpath-based containment and symlink escape rejection
- `paths/index.ts` — XDG-aware path resolution for config and state files
- `network/ssrf.ts` — canonical non-public address policy for outbound requests
- `network/safe-https-fetch.ts` — per-hop DNS validation, IP pinning, redirect and body limits
- `tunnel/index.ts` — cloudflared / ngrok process management
- `tunnel/types.ts` — `TunnelProvider` type (canonical location, re-exported by `server/config`)
- `tunnel/constants.ts` — tunnel timing constants (`TUNNEL_START_TIMEOUT_MS`, `TUNNEL_KILL_GRACE_MS`, `TUNNEL_URL_PATTERNS`)
- `http/constants.ts` — HTTP plumbing constants (`MAX_REQUEST_BODY_BYTES`, `HTTP_STATUS`, `LOCALHOST_ADDRESSES`, `VAPID_DEFAULT_SUBJECT`, `DEFAULT_HOST`, `DEFAULT_PORT`)
- `circuit-breaker/index.ts` — generic circuit breaker for external HTTP calls

## DO NOT
- Add domain logic (permissions, audit rules, event types) here.
- Import from `core/`, `transport/`, `integrations/`, `notifications/`, or `server/`.

## See also
- `docs/ARCHITECTURE.md` — dependency rule (infra is the absolute bottom)
- `src/core/AGENTS.md` — `core/` is the only direct consumer that builds domain logic on top of infra
