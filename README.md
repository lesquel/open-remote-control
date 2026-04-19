# opencode-pilot

> Remote control plugin for [OpenCode](https://opencode.ai) — monitor sessions, send prompts, approve permissions, and get Telegram notifications from anywhere.

<!-- Replace with an actual GIF/screenshot of the dashboard -->
<!-- ![Dashboard preview](docs/dashboard-preview.gif) -->

---

## Quick Start

1. Install the plugin (see [Installation](#installation) — npm coming soon; clone from GitHub today).
2. Run `opencode` — the plugin auto-starts and prints a banner with the URL, token, and a QR code.
3. Scan the QR code (or open the URL and paste the token) to reach the dashboard.

```
🎮 OpenCode Pilot — Remote Control
   URL:   http://127.0.0.1:4097
   Token: abc123...
   📱 Scan QR to open dashboard on mobile
```

---

## Installation

### Option 1 — npm (coming soon)

> **Not available yet.** The package is not published to npm at the moment. Once published, install will be as simple as adding the plugin name to your `opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-pilot"]
}
```

Until then, use Option 2 or Option 3 below.

### Option 2 — From GitHub (recommended today)

Clone the repo and install its dependencies:

```bash
git clone https://github.com/lesquel/open-remote-control.git ~/opencode-pilot
cd ~/opencode-pilot
bun install
```

Then register the plugin in your `opencode.jsonc` (or `.opencode/opencode.jsonc`) using an **absolute path**:

```jsonc
{
  "plugin": ["/absolute/path/to/opencode-pilot"]
}
```

### Option 3 — Local development (monorepo / workspace)

If the plugin lives inside your project (for example, a workspace package or a git submodule), you can reference it with a relative path:

```jsonc
{
  "plugin": ["./relative/path/to/opencode-pilot"]
}
```

> [!WARNING]
> **Path resolution gotcha:** if your config lives at `.opencode/opencode.jsonc`, a relative path like `"../opencode-pilot"` is resolved relative to `.opencode/`, NOT your project root. Use **absolute paths** to avoid silent failures — the plugin will not start and no error will be printed.

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

## Connect from phone

OpenCode Pilot includes a **"Connect from phone"** modal in the dashboard that makes mobile access easy. Press `c` in the dashboard (or use the phone icon in the header, or search "Connect from phone" in the command palette).

The modal has three tabs:

- **Local network** — QR code for LAN access (same Wi-Fi). Fastest option, no internet required.
- **Public tunnel** — QR code for the tunnel URL. Works anywhere, any network.
- **Localhost** — Direct `127.0.0.1` URL (same-device or Tauri-style setups).

### Option A — LAN (Local Network)

Best for everyday use when you are on the same Wi-Fi as your machine.

```bash
# Bind to all interfaces so your phone can reach it:
PILOT_HOST=0.0.0.0 opencode
```

> [!WARNING]
> **Only use `PILOT_HOST=0.0.0.0` on trusted networks (home, office Wi-Fi).** Binding to all interfaces exposes the dashboard to every device on the same network. The auth token is the only barrier — keep it secret.

Then open the dashboard, press `c`, and scan the QR code on the **Local network** tab.

### Option B — Public tunnel

Required when you are on mobile data or a different network from your machine.

```bash
# Cloudflare Tunnel — zero-config (recommended):
PILOT_TUNNEL=cloudflared opencode

# ngrok — requires a free account:
PILOT_TUNNEL=ngrok opencode
```

If `PILOT_HOST` is still `127.0.0.1` (the default), the tunnel forwards the public URL to localhost on your machine — this is safe and the recommended setup. The modal will show the tunnel tab with a working QR code.

### Security considerations

- The token embedded in QR URLs is your **only** auth barrier. Never screenshot it and post publicly.
- For public tunnels, rotate the token regularly: open the command palette and run **Rotate Token** (`POST /auth/rotate`).
- If you share a tunnel URL (e.g. with a teammate), be aware they can send prompts, abort sessions, and approve permissions — same as you.
- Tunnels are not rate-limited by the plugin. If you need rate limiting, put a reverse proxy in front.
- Prefer LAN over tunnel whenever possible — shorter path, no third party involved.

### `GET /connect-info` endpoint

The modal fetches `GET /connect-info` (auth required). Response shape:

```json
{
  "lan": {
    "available": true,
    "url": "http://192.168.1.42:4097/?token=abc…",
    "ip": "192.168.1.42",
    "exposed": true
  },
  "tunnel": {
    "available": true,
    "provider": "cloudflared",
    "url": "https://abc-xyz.trycloudflare.com/?token=abc…",
    "status": "connected"
  },
  "local": {
    "url": "http://127.0.0.1:4097/?token=abc…"
  },
  "token": "<full token>",
  "tokenPreview": "abcd...wxyz"
}
```

`lan.exposed` is `true` only when `PILOT_HOST=0.0.0.0`. When false, the LAN tab shows a warning and a greyed-out URL instead of a working QR code.

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

## Troubleshooting

### Plugin doesn't start (no banner, no QR)

Almost always a wrong path in your OpenCode config. Remember: relative paths inside `.opencode/opencode.jsonc` are resolved relative to `.opencode/`, not your project root. The plugin fails silently when the path is wrong — no error is printed.

- Double-check whether your config lives at `opencode.jsonc` (project root) or `.opencode/opencode.jsonc` — they resolve relative paths differently.
- When in doubt, use an **absolute path** in the `plugin` array.

### Port 4097 already in use

Another process — or a previous OpenCode session — is holding the port. Either pick a different port or kill the offender:

```bash
# Use a different port
PILOT_PORT=5000 opencode

# Or find and kill whatever is using 4097
lsof -i :4097
```

### Tunnel doesn't start

The `cloudflared` or `ngrok` binary is not installed (or not on `PATH`). The plugin keeps working on LAN, but nothing is exposed publicly. Install the binary you need — see [Remote Access via Tunnel](#remote-access-via-tunnel) — and restart OpenCode.

### Telegram notifications don't arrive

The plugin silently disables Telegram if `PILOT_TELEGRAM_TOKEN` or `PILOT_TELEGRAM_CHAT_ID` is missing or invalid. Verify both env vars are set, then confirm the bot token is valid:

```bash
curl https://api.telegram.org/bot<TOKEN>/getMe
```

A valid token returns `{"ok":true, ...}`. If you get `401 Unauthorized`, the token is wrong.

### SSE connection drops every 10 seconds

This was a historical bug caused by `Bun.serve`'s default `idleTimeout: 10`. It is fixed in current versions (`idleTimeout: 255` + a keepalive ping every 25s). If you still see it, make sure you are on **Bun >= 1.1** — older versions may not honor the `idleTimeout` option.

---

## License

[MIT](./LICENSE) — © 2025 lesquel
