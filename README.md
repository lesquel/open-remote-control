# opencode-pilot

> Remote control plugin for [OpenCode](https://opencode.ai) — monitor sessions, send prompts, approve permissions, and get Telegram notifications from anywhere.

<!-- Replace with an actual GIF/screenshot of the dashboard -->
<!-- ![Dashboard preview](docs/dashboard-preview.gif) -->

---

## Quick Start

**1. Install the plugin**

```json
{
  "plugin": ["opencode-pilot"]
}
```

**2. Start OpenCode** — the plugin starts automatically and prints a QR code

```
🎮 OpenCode Pilot — Remote Control
   URL:   http://127.0.0.1:4097
   Token: abc123...
   📱 Scan QR to open dashboard on mobile
```

**3. Open the dashboard** — scan the QR code, or paste the URL + token in your browser

---

## Features

- 🖥️ **Web dashboard** — real-time session view with messages, diffs, and tool call inspection
- 📡 **SSE event stream** — live push events to any HTTP client
- 🔐 **Permission approval** — approve or deny tool-use permissions remotely (or via Telegram)
- 📱 **QR code pairing** — scan to connect from your phone in seconds
- 🌐 **Tunnel support** — expose the dashboard publicly via Cloudflare Tunnel or ngrok
- 💬 **Telegram integration** — push notifications with inline approve/deny buttons
- 📋 **Multi-session view** — monitor multiple OpenCode sessions side-by-side
- 🔍 **Diff view** — inspect file changes made by each session
- 🛡️ **Localhost by default** — binds to `127.0.0.1`; no accidental exposure

---

## Configuration

Copy `.env.example` to `.env` (or export vars before starting OpenCode):

| Variable | Default | Description |
|---|---|---|
| `PILOT_PORT` | `4097` | HTTP server port |
| `PILOT_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN/tunnel) |
| `PILOT_PERMISSION_TIMEOUT` | `300000` | Permission approval timeout (ms) |
| `PILOT_TUNNEL` | `off` | Tunnel provider: `off`, `cloudflared`, `ngrok` |
| `PILOT_TELEGRAM_TOKEN` | _(unset)_ | Bot token from [@BotFather](https://t.me/BotFather) |
| `PILOT_TELEGRAM_CHAT_ID` | _(unset)_ | Your Telegram user/chat ID |
| `PILOT_DEV` | `false` | Re-read dashboard HTML on each request (dev only) |

---

## API Reference

All endpoints (except the dashboard) require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | none | Web dashboard |
| `GET` | `/dashboard/*` | none | Dashboard static assets |
| `GET` | `/status` | required | Plugin status + session counts |
| `GET` | `/sessions` | required | List all sessions |
| `POST` | `/sessions` | required | Create new session |
| `GET` | `/sessions/:id` | required | Session details |
| `GET` | `/sessions/:id/messages` | required | Session messages |
| `GET` | `/sessions/:id/diff` | required | File diffs |
| `POST` | `/sessions/:id/prompt` | required | Send a prompt |
| `POST` | `/sessions/:id/abort` | required | Abort session |
| `GET` | `/permissions` | required | List pending permissions |
| `POST` | `/permissions/:id` | required | Approve/deny permission |
| `GET` | `/events` | optional | SSE event stream |
| `GET` | `/tools` | required | Available tools |
| `GET` | `/project` | required | Project info |

### SSE Events

Connect to `/events` (Bearer token in header or `?token=` query param):

- `pilot.connected` — initial connection
- `pilot.permission.pending` — permission awaiting approval
- `pilot.permission.resolved` — permission approved or denied
- `pilot.tool.started` — tool call started
- `pilot.tool.completed` — tool call completed
- All OpenCode bus events are forwarded as-is

### Example: send a prompt

```bash
TOKEN="abc123..."
SESSION="sess_xyz"

curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Run the tests and fix any failures"}' \
  http://localhost:4097/sessions/$SESSION/prompt
```

### Example: approve a permission

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "allow"}' \
  http://localhost:4097/permissions/PERMISSION_ID
```

---

## Remote Access via Tunnel

By default the server is local-only. Enable a tunnel to reach it from your phone on mobile data or share it with a teammate.

### Cloudflare Tunnel (recommended — no account needed)

```bash
# macOS
brew install cloudflared

# Debian/Ubuntu
curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb && sudo dpkg -i cloudflared.deb

PILOT_TUNNEL=cloudflared opencode
```

### ngrok (requires free account)

```bash
brew install ngrok
ngrok config add-authtoken YOUR_AUTH_TOKEN

PILOT_TUNNEL=ngrok opencode
```

The banner is regenerated with the public URL and the QR code is updated automatically.

If the requested tunnel binary is not found or fails to start, the plugin logs a warning and continues without a tunnel — it does **not** crash.

---

## Telegram Integration

Get push notifications for permission requests, errors, and session completions directly in Telegram — with inline **Allow** / **Deny** buttons.

**Setup:**

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Get your chat ID via [@userinfobot](https://t.me/userinfobot)
3. Export env vars and start OpenCode:

```bash
export PILOT_TELEGRAM_TOKEN="123456:ABC-DEF..."
export PILOT_TELEGRAM_CHAT_ID="123456789"
opencode
```

If either variable is missing, Telegram is silently disabled — no behavior change.

---

## Security

> **Warning:** When a tunnel is active, your dashboard is reachable from the public internet. The auth token is the **only** barrier. Keep it secret. For sensitive work, prefer LAN-only access (`PILOT_TUNNEL=off`, the default).

- Auth token generated at startup — 32 random bytes as a 64-char hex string
- Server binds to `127.0.0.1` by default (localhost-only)
- All remote operations are written to `.opencode/pilot-audit.log`
- Permission requests time out after `PILOT_PERMISSION_TIMEOUT` ms (default 5 min)

---

## Local Development

```bash
git clone https://github.com/lesquel/open-remote-control
cd open-remote-control

bun install

# Type-check
bun run typecheck

# Run tests
bun test

# Use a local copy in OpenCode (add to opencode.json):
# { "plugin": ["./path/to/opencode-pilot"] }

# Hot-reload dashboard HTML (no restart needed):
PILOT_DEV=true opencode
```

---

## License

[MIT](./LICENSE) — © 2025 lesquel
