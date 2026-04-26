# OpenCode Pilot — CLAUDE.md

Codebase overview for AI agents. For the **strict workflow** (what to never do, release process, debugging playbook, Engram protocol), read [`AGENTS.md`](./AGENTS.md) first — that file is the contract.

Companion docs:

- [`AGENTS.md`](./AGENTS.md) — strict AI-agent workflow and conventions
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — design decisions with rationale
- [`docs/RELEASE.md`](./docs/RELEASE.md) — release execution checklist
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — user-facing runtime debugging
- [`docs/INSTALL.md`](./docs/INSTALL.md) — install-time debugging + the two-loader plugin architecture

## Project
Remote control plugin for OpenCode. Lets you monitor sessions, send prompts, and approve permissions remotely via HTTP/SSE.

## Quick Start
```bash
bun install
# Add to .opencode/plugins/ or opencode.json plugin array
```

## Structure (as of v1.18.0 — Screaming Architecture)

```
src/
├── core/                     # DOMAIN — pure business rules, no HTTP/Telegram/Codex
│   ├── index.ts              # Barrel: createPermissionQueue, createAuditLog, getSharedEventBus, ...
│   ├── permissions/          # createPermissionQueue
│   ├── events/               # getSharedEventBus + PilotEvent / BusEvent types
│   ├── audit/                # createAuditLog + rotation
│   ├── settings/             # createSettingsStore
│   ├── state/                # writeState / clearState / globalStatePath
│   ├── strings.ts            # MSG dictionary (user-facing strings)
│   ├── errors.ts             # PilotError + ConfigError
│   └── types/                # Shared cross-layer type contracts
│       ├── notification-service.ts  # NotificationService interface
│       └── notification-channels.ts # TelegramChannel, PushService, PushSubscriptionJson
│
├── transport/                # HOW the core is exposed to the outside world
│   └── http/
│       ├── server.ts         # Bun.serve setup + route dispatch (createRemoteServer)
│       ├── routes.ts         # Core route table + RouteDeps + RouteContext
│       ├── validation.ts     # Body validation middleware
│       ├── handlers/         # One file per domain
│       │   ├── sessions.ts
│       │   ├── permissions.ts
│       │   ├── events.ts     # /events SSE endpoint
│       │   ├── settings.ts   # /settings* + /settings/vapid/generate + push endpoints
│       │   ├── system.ts     # /, /dashboard/*, /status, /health, /connect-info, /auth/rotate
│       │   └── projects.ts
│       ├── validators/       # Validation schemas per domain
│       ├── middlewares/      # auth.ts, cors.ts, json.ts
│       └── __tests__/        # Cross-handler integration tests (server.test.ts, integration.test.ts)
│
├── integrations/             # ADAPTERS for external CLI agents
│   ├── ports.ts              # interface AgentIntegration + IntegrationDeps + RouteSpec
│   ├── opencode/             # Native SDK hook integration
│   │   ├── index.ts          # opencodeIntegration: AgentIntegration
│   │   └── hooks/            # event.ts, permission.ask.ts, tool.ts, index.ts
│   └── codex/                # Codex CLI bridge (POST /codex/hooks/:event)
│       ├── index.ts          # codexIntegration: AgentIntegration
│       ├── handlers.ts       # Dispatch table for each hook event
│       └── validators.ts
│
├── notifications/            # FAN-OUT for outbound notifications
│   ├── ports.ts              # interface NotificationChannel + NotificationEvent
│   ├── pipeline.ts           # createNotificationService (fan-out orchestrator)
│   └── channels/
│       ├── telegram/
│       │   └── index.ts      # createTelegramChannel: TelegramChannel (extends NotificationChannel)
│       └── push/             # Web Push subsystem
│           ├── index.ts      # createPushChannel: NotificationChannel
│           ├── service.ts    # createPushService — VAPID + subscription mgmt + channel
│           ├── vapid.ts      # VAPID key generation + persistence
│           ├── subscriptions.ts
│           └── types.ts
│
├── infra/                    # Reusable technical plumbing (no domain, no HTTP specifics)
│   ├── tunnel/               # cloudflared / ngrok (startTunnel)
│   ├── qr/                   # QR code generation
│   ├── banner/               # writeBanner
│   ├── logger/               # createLogger
│   ├── network/              # getLocalIP
│   ├── auth/                 # generateToken
│   ├── circuit-breaker/
│   ├── paths/                # getPluginConfigDir, configFile, stateFile
│   ├── http/                 # Generic HTTP types: RouteContext<TDeps>, Route<TDeps>, auth/cors/json
│   └── dotenv/               # loadDotEnv
│
├── dashboard/                # Browser SPA (served by transport/http/ as static files)
│   ├── index.html            # Entry point — var GEN = "x.y.z" (bumped on release)
│   ├── main.js, styles.css, sw.js, manifest.json, constants.js
│   ├── api/, state/, sse/, auth/, components/, modals/, ui/, routing/
│   └── __tests__/            # asset-sanity.test.ts (guards release pre-flight)
│
├── tui/                      # OpenCode TUI plugin (slash commands, event listeners)
├── cli/                      # `opencode-pilot init` binary
│
└── server/                   # FAÇADE — preserves `./server` npm export
    ├── index.ts              # Composition root: wires all 8 modules, returns plugin handle
    ├── config.ts             # loadConfigSafe / mergeStoredSettings / resolveSources
    └── constants.ts          # PILOT_VERSION (hard-referenced by release script — do NOT move)
```

**Dependency rule:** `infra/` ← `core/` ← (`transport/`, `integrations/`, `notifications/`) ← `server/index.ts` (composition root, only file that imports across all layers). Cross-sibling imports between `transport/`, `integrations/`, and `notifications/` are forbidden except through the two explicit ports in `integrations/ports.ts` and `notifications/ports.ts`.

## Rules
- Factory functions with `create` prefix, no classes
- All endpoints require auth (Bearer token) — except GET / and GET /dashboard/*
- Bind to localhost by default — security first
- Audit log every remote operation
- Never use console.log in server plugin (use console.error or ctx.client.app.log)
- No `any` types — use proper types or `Record<string, unknown>`
- Typed errors: `PilotError` base class, `jsonError()` for HTTP errors

## Config
Priority (highest wins): shell env > `~/.opencode-pilot/config.json` > `.env` > defaults.
- `PILOT_PORT` (default: 4097)
- `PILOT_HOST` (default: 127.0.0.1)
- `PILOT_PERMISSION_TIMEOUT` (default: 300000ms)
- `PILOT_TUNNEL` (default: off) — `cloudflared` or `ngrok` to expose via public tunnel
- `PILOT_TELEGRAM_TOKEN` + `PILOT_TELEGRAM_CHAT_ID` — optional Telegram bot
- `PILOT_VAPID_PUBLIC_KEY` + `PILOT_VAPID_PRIVATE_KEY` + `PILOT_VAPID_SUBJECT` — Web Push
- `PILOT_ENABLE_GLOB_OPENER` (default: false) — enable `/fs/glob` + `/fs/read`
- `PILOT_DEV` (default: false) — when true, dashboard HTML is re-read on each request
- `PILOT_FETCH_TIMEOUT_MS` (default: 10000) — timeout for external HTTP calls (Telegram API)
- `PILOT_PROJECT_STATE` (default: auto) — controls per-project file writes: `auto` = write only when `.opencode/` exists, `always` = legacy always-create, `off` = skip per-project writes entirely
- `PILOT_HOOK_TOKEN` (default: unset) — optional dedicated bearer token accepted on `POST /codex/hooks/*`; when set, both this token AND the main token are accepted on that path
- `PILOT_CODEX_PERMISSION_TIMEOUT_MS` (default: 250000, max: 250000) — how long to wait for a permission decision on Codex hook PermissionRequest before auto-denying. Values > 250000ms throw ConfigError at startup (Bun's idleTimeout cap is 255s; longer values cause a connection drop instead of a structured deny)

Editable from the dashboard Settings UI (writes to `~/.opencode-pilot/config.json`): everything except `PILOT_DEV`. See `src/core/settings/store.ts`.

## Event Types (PilotEvent discriminated union)
- `pilot.connected` — SSE client connected
- `pilot.permission.pending` — permission request waiting
- `pilot.permission.resolved` — permission resolved
- `pilot.tool.started` — tool execution started
- `pilot.tool.completed` — tool execution finished
- `pilot.subagent.spawned` — Task tool spawned a child session
- `pilot.client.connected` / `pilot.client.disconnected` — client lifecycle
- `pilot.token.rotated` — auth token rotated (payload includes new connect URL)
- `pilot.error` — global uncaughtException / unhandledRejection (non-fatal)

## Route Table
| Method | Path | Auth |
|--------|------|------|
| GET | / | none |
| GET | /dashboard/* | none |
| GET | /status | required |
| GET | /sessions | required |
| POST | /sessions | required |
| GET | /sessions/:id | required |
| GET | /sessions/:id/messages | required |
| GET | /sessions/:id/diff | required |
| POST | /sessions/:id/prompt | required |
| POST | /sessions/:id/abort | required |
| GET | /permissions | required |
| POST | /permissions/:id | required |
| GET | /events | optional (Bearer or ?token=) |
| GET | /tools | required |
| GET | /project | required |
| GET | /sessions/:id/children | required |
| GET | /connect-info | required |
| GET | /health | none |
| POST | /auth/rotate | required |
| GET | /agents | required |
| GET | /providers | required |
| GET | /mcp/status | required |
| GET | /projects | required |
| GET | /project/current | required |
| GET | /lsp/status | required |
| GET | /settings | required |
| PATCH | /settings | required |
| POST | /settings/reset | required |
| POST | /settings/vapid/generate | required |
| POST | /codex/hooks/:event | none (handler validates hookToken OR main token) |

**Multi-project routing**: per-project endpoints (`/sessions*`, `/agents`, `/providers`, `/mcp/status`, `/project/current`, `/lsp/status`, `/tools`) accept an optional `?directory=<path>` query param that OpenCode uses to auto-boot an instance context for that worktree. Path traversal (`..`) and overlong paths (>512 chars) return 400.

**Plugin settings (v1.12)**: `/settings*` endpoints read and write `~/.opencode-pilot/config.json`. Priority is shell env > config.json > `.env` > defaults. Shell-env-pinned fields return 409 on PATCH (cannot be overridden from the UI). See `docs/CONFIGURATION.md`.
