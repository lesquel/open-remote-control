# @lesquel/opencode-pilot

> Remote control plugin for [OpenCode](https://opencode.ai) — monitor sessions, send prompts, approve permissions, switch agents, and get notifications from your phone or any browser.

[![npm version](https://img.shields.io/npm/v/@lesquel/opencode-pilot.svg)](https://www.npmjs.com/package/@lesquel/opencode-pilot)
[![npm downloads](https://img.shields.io/npm/dm/@lesquel/opencode-pilot.svg)](https://www.npmjs.com/package/@lesquel/opencode-pilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/lesquel/open-remote-control.svg?style=social)](https://github.com/lesquel/open-remote-control)

---

## What it does

Spin up OpenCode locally, get a web dashboard you can open on your laptop or phone. From the dashboard you can:

- See all your sessions across all your projects (multi-project tabs)
- Send prompts and watch responses stream live
- Approve / deny tool permissions remotely
- Switch agents (build / plan / general / explore) per session
- Track cost per session, per day, per week
- Get sound, browser, push, and Telegram notifications when an agent finishes
- Pin TODOs that survive across sessions
- Diff view of all files changed
- File browser with live filter
- Connect from your phone via QR code (LAN or public tunnel)

All from one keyboard shortcut (`?` opens the command palette).

---

## Quick Start (3 steps)

### 1. Install

```bash
npm install @lesquel/opencode-pilot
# or
bun add @lesquel/opencode-pilot
# or
pnpm add @lesquel/opencode-pilot
```

### 2. Add to your `opencode.json`

```jsonc
{
  "plugins": ["opencode-pilot"]
}
```

> Note: the plugin id is `opencode-pilot` (without the scope), the npm package name is `@lesquel/opencode-pilot`. The scope is only for npm namespacing.

### 3. (Optional) Create a `.env`

Minimum config — only needed if you want to override defaults:

```bash
PILOT_PORT=4097           # default port
PILOT_HOST=127.0.0.1      # localhost only; use 0.0.0.0 for LAN access
```

Run `opencode` from your project directory. Banner prints with URL + token + QR.

---

## Connect from your phone

### Same WiFi (LAN access)

1. Set `PILOT_HOST=0.0.0.0` in `.env`
2. Restart OpenCode
3. Click the phone icon in the dashboard header (`c` shortcut)
4. Scan the QR from the "Local network" tab with your phone camera
5. Done — same dashboard, on your phone

### Anywhere (public tunnel)

1. Install [cloudflared](https://github.com/cloudflare/cloudflared) (`brew install cloudflared` on Mac)
2. Add `PILOT_TUNNEL=cloudflared` to your `.env`
3. Restart OpenCode — it spawns the tunnel automatically
4. Phone modal "Public tunnel" tab now has a QR with a public HTTPS URL
5. Works from cellular, hotel WiFi, anywhere

> 🔐 **Security note**: the tunnel URL contains your token. Treat it like a password. See [`docs/TUNNEL_TESTING.md`](docs/TUNNEL_TESTING.md) for security checklist.

---

## Features

### Dashboard

- **Sessions sidebar** with folder grouping and agent filter
- **Multi-view** to watch multiple sessions side-by-side (desktop only)
- **Project tabs** at the top — open multiple projects in parallel
- **Right info panel** with Context, MCP servers, LSP clients, project path, instance version
- **Pinned TODOs** survive across sessions and project switches
- **Cost panel** with per-session, daily, and weekly totals + budget alerts
- **Diff tab** showing all files changed in current session

### Notifications

| Type | Trigger | Setup |
|------|---------|-------|
| Sound | Page hidden + assistant turn complete | Toggle in Settings |
| Browser notification | Page hidden + permission granted | Toggle, allow when prompted |
| Push (Web Push) | Anywhere, even browser closed | VAPID keys in `.env` ([guide](docs/CONFIGURATION.md#web-push-optional)) |
| Telegram | Permission requests + completions | Bot token in `.env` |

### Mobile-friendly

- Drawer sidebar with backdrop
- Full-screen modals
- Multi-view auto-hidden (use desktop for split view)
- Right panel as bottom toggle
- Live filter on file browser
- 44×44 touch targets everywhere

### Keyboard shortcuts

Single-key (when no input focused):

| Key | Action |
|-----|--------|
| `?` | Open command palette + show shortcuts |
| `n` | New session |
| `s` | Toggle sidebar |
| `m` | Toggle multi-view (desktop only) |
| `t` | Toggle theme |
| `c` | Connect from phone modal |
| `/` | Focus prompt input |
| `Esc` | Close modal/picker/palette |

Modifier:

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+Enter` | Send prompt |
| `Alt+I` | Toggle right info panel |

---

## Configuration — two ways

Since **v1.12** you can configure the plugin two ways (or both):

### Easy: the Settings UI

1. Open the dashboard
2. Click the gear icon (⚙) in the header
3. Go to **Plugin configuration**
4. Edit port, host, tunnel, Telegram token, VAPID keys, permission timeout,
   and the glob opener toggle
5. Click **Save** — values are written to `~/.opencode-pilot/config.json`
   and survive restarts

Some fields (port, host, tunnel, VAPID keys) require an OpenCode restart to take effect — the UI shows an inline warning for those. A **Generate VAPID keys** button calls the server to create a key pair in one click.

Each field shows a small badge telling you where its current value comes from: `saved` (UI), `.env`, `shell`, or `default`. Fields set via shell env vars are locked from the UI — you must unset the shell var to override.

### Power user: `.env` file

Full env-var reference with example `.env` files for common scenarios lives in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md). Quick overview:

| Variable | Default | What |
|----------|---------|------|
| `PILOT_PORT` | `4097` | HTTP server port |
| `PILOT_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN) |
| `PILOT_TUNNEL` | (off) | `cloudflared` or `ngrok` for public access |
| `PILOT_PERMISSION_TIMEOUT` | `300000` | Permission-request timeout in ms |
| `PILOT_TELEGRAM_TOKEN` | (off) | Telegram bot token from @BotFather |
| `PILOT_TELEGRAM_CHAT_ID` | (off) | Your Telegram chat ID |
| `PILOT_VAPID_PUBLIC_KEY` | (off) | Web Push public key (`bunx web-push generate-vapid-keys`) |
| `PILOT_VAPID_PRIVATE_KEY` | (off) | Web Push private key |
| `PILOT_ENABLE_GLOB_OPENER` | `false` | Enable `/fs/glob` for the dashboard's glob search |
| `PILOT_FETCH_TIMEOUT_MS` | `10000` | Timeout for outbound HTTP calls (Telegram, push) |

### Priority (highest wins)

```
1. Shell env vars                         e.g. PILOT_PORT=5000 opencode
2. ~/.opencode-pilot/config.json          written by the Settings UI
3. .env file (process.cwd or plugin dir)  power-user file-based config
4. Hardcoded defaults                     fallback
```

The `.env` file is searched in: (1) `process.cwd()/.env` then (2) the plugin's install dir. Shell env vars always win over both `.env` and the Settings UI.

---

## Documentation

- [Configuration reference](docs/CONFIGURATION.md) — every env var, with example `.env` files for common scenarios
- [Connect from phone](docs/CONFIGURATION.md#scenario-2-solo-dev-want-phone-access-in-same-wifi) — LAN + tunnel setup
- [Tunnel testing](docs/TUNNEL_TESTING.md) — end-to-end verification guide
- [Publishing to npm](docs/PUBLISHING_TO_NPM.md) — for contributors who want to publish forks
- [Cloud relay v2.0 design](docs/CLOUD_RELAY_v2_DESIGN.md) — architecture doc for a future centralized service
- [Production readiness](docs/PRODUCTION_READINESS.md) — deployment-mode verdicts

---

## Architecture (one line)

The plugin runs ONE HTTP+SSE server inside your OpenCode process. The dashboard is a vanilla ES-modules SPA served from the same origin. All API calls go through the SDK with `?directory=` for multi-project routing.

If you want the deep version, see the [`docs/`](docs/) folder.

---

## Tech stack

- **Server**: Bun + TypeScript (strict)
- **Dashboard**: vanilla ES modules, plain CSS, ~9000 LOC. No React, no build step.
- **Optional deps**: `cloudflared` / `ngrok` (tunnel), `@modelcontextprotocol/sdk` (MCP), `web-push` (push notifications)
- **Tests**: 181 (Bun test runner), all green

---

## Contributing

Issues and PRs welcome at [github.com/lesquel/open-remote-control](https://github.com/lesquel/open-remote-control).

Local dev:

```bash
git clone https://github.com/lesquel/open-remote-control
cd open-remote-control/opencode-pilot
bun install
bun test
bun run typecheck
```

To test changes against your local OpenCode without publishing:

```bash
# In opencode-pilot/
bun pm pack        # creates lesquel-opencode-pilot-X.X.X.tgz

# In a test project with opencode.json:
bun add /path/to/lesquel-opencode-pilot-X.X.X.tgz
```

---

## License

MIT © [lesquel](https://github.com/lesquel)
