# OpenCode Pilot — CLAUDE.md

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
- `PILOT_PORT` (default: 4097)
- `PILOT_HOST` (default: 127.0.0.1)
- `PILOT_PERMISSION_TIMEOUT` (default: 300000ms)
- `PILOT_TUNNEL` (default: off) — `cloudflared` or `ngrok` to expose via public tunnel
- `PILOT_TELEGRAM_TOKEN` + `PILOT_TELEGRAM_CHAT_ID` — optional Telegram bot
- `PILOT_DEV` (default: false) — when true, dashboard HTML is re-read on each request

## Event Types (PilotEvent discriminated union)
- `pilot.connected` — SSE client connected
- `pilot.permission.pending` — permission request waiting
- `pilot.permission.resolved` — permission resolved
- `pilot.tool.started` — tool execution started
- `pilot.tool.completed` — tool execution finished
- `pilot.client.connected` / `pilot.client.disconnected` — client lifecycle

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
