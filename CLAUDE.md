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

## Structure

```
src/server/
├── index.ts                 # Entry point — wires everything up, graceful shutdown
├── config.ts                # Parse + validate env vars (loadConfig / loadConfigSafe)
├── types.ts                 # Shared types: PilotEvent, BusEvent, PilotError
├── hooks/
│   ├── index.ts            # Barrel
│   ├── event.ts            # SDK event hook handler
│   ├── permission.ask.ts   # permission.ask hook
│   └── tool.ts             # tool.execute.before/after hooks
├── http/
│   ├── server.ts           # Bun.serve setup + route dispatch
│   ├── routes.ts           # Route table (matchRoute)
│   ├── handlers.ts         # One function per route
│   ├── auth.ts             # validateToken, getIP
│   ├── cors.ts             # CORS headers + preflight helper
│   └── json.ts             # json(), jsonError() helpers
├── services/
│   ├── event-bus.ts        # SSE bus (createEventBus)
│   ├── permission-queue.ts # Permission queue (createPermissionQueue)
│   ├── audit.ts            # Audit log (createAuditLog)
│   ├── state.ts            # State file read/write/clear
│   ├── tunnel.ts           # Tunnel provider (cloudflared/ngrok)
│   ├── telegram.ts         # Telegram bot (createTelegramBot)
│   ├── qr.ts               # QR code generation
│   ├── banner.ts           # Banner file generation (writeBanner)
│   ├── settings-store.ts   # Persistent JSON config (~/.opencode-pilot/config.json) — v1.12
│   └── notifications.ts    # Unified notification pipeline (createNotificationService)
└── util/
    ├── auth.ts             # Token generation (generateToken)
    └── network.ts          # Local IP detection (getLocalIP)

src/server/dashboard/        # Split dashboard (served from GET / and GET /dashboard/*)
src/tui/
└── index.ts                 # TUI plugin — slash commands, event listeners
```

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

Editable from the dashboard Settings UI (writes to `~/.opencode-pilot/config.json`): everything except `PILOT_DEV`. See `services/settings-store.ts`.

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
