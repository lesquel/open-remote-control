# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.4.0] — 2025-04-15

### Changed
- Refactored architecture: dashboard split into focused modules (`messages.js`, `multi-view.js`, `sessions.js`, etc.)
- Extracted `constants.ts` as single source of truth for magic numbers and version string
- Added `util/logger.ts` wrapper around `ctx.client.app.log` for cleaner service code
- Fixed tool parts rendering: correctly reads `part.state.input`, `part.state.output`, `part.state.error`, and `part.state.title` from OpenCode SDK `ToolState` shape instead of the legacy `part.args`/`part.result` fields
- Tool blocks now auto-expand for running/error states and auto-collapse for completed/pending
- Tool block header now shows a status icon (⏳🔄✓❌) and title when available

### Added
- Tests for `util/auth`, `config`, `services/permission-queue`, and `http/auth`
- `LICENSE` file (MIT)
- `CHANGELOG.md` (this file)
- `package.json`: `files` array, `repository`/`bugs`/`homepage` fields, `test` script

## [0.3.0] — 2025-03-10

### Added
- Cloudflare Tunnel and ngrok tunnel support (`PILOT_TUNNEL`)
- Telegram bot integration with inline approve/deny buttons (`PILOT_TELEGRAM_TOKEN` + `PILOT_TELEGRAM_CHAT_ID`)
- Rich dashboard UI with syntax-highlighted messages, diff view, and permission panel
- Multi-session split view in the dashboard
- QR code in banner file for easy mobile pairing
- Unified notification service (`services/notifications.ts`)
- Audit log (`services/audit.ts`)

## [0.2.0] — 2025-02-05

### Added
- Web dashboard served at `GET /` (single-page app, no build step)
- QR code pairing: banner printed to `.opencode/pilot-banner.txt` at startup
- SSE event stream at `GET /events` with keepalive
- Session diff endpoint (`GET /sessions/:id/diff`)
- Session abort endpoint (`POST /sessions/:id/abort`)

## [0.1.0] — 2025-01-15

### Added
- Initial release: HTTP + SSE server as an OpenCode plugin
- Endpoints: `/status`, `/sessions`, `/sessions/:id/messages`, `/sessions/:id/prompt`
- Permission queue: remote approve/deny via `/permissions/:id`
- Auth token generated at startup (32-byte hex, Bearer scheme)
- Binds to `127.0.0.1` by default (localhost-only for security)
- `PILOT_PORT`, `PILOT_HOST`, `PILOT_PERMISSION_TIMEOUT` env vars
