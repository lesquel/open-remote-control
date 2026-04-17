# Testing opencode-pilot in a Real OpenCode Project

This guide walks you through a full smoke test of opencode-pilot inside a real
OpenCode project. By the end you should have verified: plugin load, banner
output, dashboard access from a phone, SSE event streaming, permission
approval, the audit log, and (optionally) the Telegram bot and tunnel.

The goal is to catch real-world issues that unit tests cannot — path
resolution, port conflicts, auth failures, SSE idle timeouts, tunnel
binaries, and mobile connectivity.

## Prerequisites

- `bun` >= 1.1 (older Bun versions do not honor `idleTimeout` for SSE)
- `opencode` installed and working (`opencode --version` should print a version)
- Any existing project directory you can open with OpenCode (it does not need
  to be special — a README-only repo is fine)
- Optional: `cloudflared` or `ngrok` for the tunnel test
- Optional: a Telegram bot token and chat ID for the Telegram test

Check your Bun and OpenCode versions:

```bash
bun --version
opencode --version
```

## Step 1 — Install opencode-pilot locally

You have three install paths. Pick one.

### Path A — From GitHub (recommended today)

```bash
git clone https://github.com/lesquel/open-remote-control.git ~/opencode-pilot
cd ~/opencode-pilot
bun install
```

Note the absolute path (`~/opencode-pilot` expands to `$HOME/opencode-pilot`).
You will reference it in Step 2.

### Path B — Inside your project (monorepo / workspace)

```bash
cd /path/to/your/project
git clone https://github.com/lesquel/open-remote-control.git ./vendor/opencode-pilot
cd ./vendor/opencode-pilot
bun install
cd ../..
```

### Path C — Via npm

Not available yet. Skip this path until the package is published.

## Step 2 — Configure your OpenCode project

OpenCode reads a plugin list from either `opencode.jsonc` (project root) or
`.opencode/opencode.jsonc`. The file is JSON with comments.

Open the config that already exists, or create one at the project root:

```jsonc
// opencode.jsonc
{
  "plugin": ["/absolute/path/to/opencode-pilot"]
}
```

### Path resolution warning

If your config lives at `.opencode/opencode.jsonc`, a relative path like
`"../opencode-pilot"` is resolved relative to `.opencode/`, NOT your project
root. The plugin fails silently when the path is wrong — no banner, no error.

Use an **absolute path** unless you are certain of the resolution root.

### Optional environment variables

Export before launching OpenCode, or put them in a `.env` that your shell
loads:

```bash
export PILOT_PORT=4097
export PILOT_HOST=127.0.0.1
export PILOT_PERMISSION_TIMEOUT=300000
export PILOT_TUNNEL=off
# export PILOT_TELEGRAM_TOKEN="123456:ABC..."
# export PILOT_TELEGRAM_CHAT_ID="123456789"
# export PILOT_DEV=true    # reload dashboard HTML on every request
```

## Step 3 — Start OpenCode and verify the banner

From the project directory:

```bash
opencode
```

Within a second or two the plugin writes a banner to
`.opencode/pilot-banner.txt` and OpenCode shows a toast titled
`OpenCode Pilot`.

Verify the banner file exists and contains the expected lines:

```bash
bat .opencode/pilot-banner.txt
```

Expected content (abbreviated):

```
OpenCode Pilot — Remote Control
================================

   Local:  http://127.0.0.1:4097
   Token:  <64-char hex token>

   curl -H "Authorization: Bearer <token>" http://127.0.0.1:4097/status

   Scan QR to open dashboard on mobile:

   <ASCII QR block>
   Direct link: http://127.0.0.1:4097/?token=<token>
```

Also verify the state file:

```bash
bat .opencode/pilot-state.json
```

Expected fields: `token`, `port`, `host`, `startedAt`, `pid`.

In the OpenCode TUI, type `/remote-control` (aliases: `/pilot`, `/rc`) — the
full banner is shown as a toast. `/pilot-token` shows the full token and a
ready-to-paste `curl` command.

## Step 4 — Open the dashboard from your phone

### 4a. Same LAN

Set `PILOT_HOST=0.0.0.0` so the server binds to every interface, then restart
OpenCode:

```bash
PILOT_HOST=0.0.0.0 opencode
```

The banner now shows a QR code pointing to the LAN URL. Scan it with your
phone (any QR scanner). The dashboard opens in the mobile browser.

> If you scan the QR while `PILOT_HOST=127.0.0.1`, the phone resolves
> `127.0.0.1` to itself and the dashboard never loads. The banner prints a
> warning when the host is localhost.

### 4b. Without a phone

Open the dashboard from the same machine:

```bash
xdg-open "http://127.0.0.1:4097/?token=$(jq -r .token .opencode/pilot-state.json)"
```

(or paste the `Direct link` line from the banner into any browser)

### 4c. Send a prompt from the dashboard

1. The dashboard shows the session list (one active session from your TUI).
2. Click a session to open the messages view.
3. Type a short prompt (e.g. `List the files in this repo`) and send it.
4. The TUI should receive the prompt as if you typed it there, and the
   dashboard should stream the model's response back in real time.

If messages appear but streaming stalls, see the SSE troubleshooting
section in the main README.

## Step 5 — Test permission approval flow

The permission flow is the killer feature — it lets you approve tool-use
requests from your phone without going back to the terminal.

1. In the dashboard (or the TUI) send a prompt that forces a
   permission-gated action:

   ```
   Edit the file README.md and add a blank line at the top.
   ```

2. The model decides to run `edit` — OpenCode pauses and fires
   `permission.ask`.
3. In the dashboard you see a banner: **Permission requested** with
   `Allow` / `Deny` buttons.
4. Click `Allow`. The TUI resumes, the edit is applied, and an audit entry
   is appended to `.opencode/pilot-audit.log`.

Verify via curl:

```bash
TOKEN=$(jq -r .token .opencode/pilot-state.json)

# See currently pending permissions (empty if nothing is waiting)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4097/permissions | jq
```

If a permission is pending, you can approve it directly with curl:

```bash
PERM_ID="<id-from-previous-response>"
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "allow"}' \
  http://127.0.0.1:4097/permissions/$PERM_ID | jq
```

## Step 6 — Test Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Get your chat ID with [@userinfobot](https://t.me/userinfobot).
3. Start OpenCode with the env vars:

   ```bash
   export PILOT_TELEGRAM_TOKEN="123456:ABC-DEF..."
   export PILOT_TELEGRAM_CHAT_ID="123456789"
   opencode
   ```

4. You should immediately receive a message: `OpenCode Pilot Started` with
   a link to the dashboard.
5. Trigger a permission request in the TUI — you should receive a new
   message with inline `Allow` / `Deny` buttons. Tapping either button
   resolves the permission and edits the message to reflect the outcome.

Verify the bot token is valid first:

```bash
curl -s "https://api.telegram.org/bot$PILOT_TELEGRAM_TOKEN/getMe" | jq
```

A valid token returns `{"ok": true, ...}`. A `401` means the token is wrong.

If either env var is missing or the Telegram API rejects the token, the
plugin silently disables Telegram — no crash.

## Step 7 — Test tunnel (optional)

The tunnel makes your dashboard reachable from mobile data or from anyone
on the internet with the token.

### Cloudflare Tunnel (no account required)

Install:

```bash
# macOS
brew install cloudflared

# Debian/Ubuntu
curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb \
  -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
```

Start OpenCode with the tunnel enabled:

```bash
PILOT_TUNNEL=cloudflared opencode
```

The banner now shows a `Public:` line with a `https://<random>.trycloudflare.com`
URL. The QR code targets the hosted PWA with the public URL baked in.

Test from mobile data (turn Wi-Fi off on your phone) or from a different
network:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://<random>.trycloudflare.com/status"
```

### ngrok (free account required)

```bash
brew install ngrok
ngrok config add-authtoken YOUR_AUTH_TOKEN
PILOT_TUNNEL=ngrok opencode
```

If `cloudflared` or `ngrok` is not on `PATH`, the plugin logs a warning and
keeps running LAN-only. It does not crash.

## Step 8 — Test SSE events

SSE lets any HTTP client subscribe to the live event stream. This is how
the dashboard stays in sync.

Open a second terminal and run:

```bash
TOKEN=$(jq -r .token .opencode/pilot-state.json)
curl -N "http://127.0.0.1:4097/events?token=$TOKEN"
```

Expected output:

```
data: {"type":"pilot.connected","properties":{"timestamp":...}}

: ping

```

Keep the curl running. In OpenCode, send a prompt. You should see a flood
of events — `session.status`, `message.part.updated`, `pilot.tool.started`,
`pilot.tool.completed`, and any OpenCode bus events passed through as-is.

Every 25 seconds a `: ping` line is emitted as a keepalive. Bun's
`idleTimeout` is set to 255 seconds so the connection will not drop every
10 seconds as it did in older versions.

Leave the stream open for a full minute to confirm it does not drop.

## Verification checklist

- [ ] `.opencode/pilot-banner.txt` exists and contains URL + token + QR
- [ ] `.opencode/pilot-state.json` contains `port`, `token`, `host`, `pid`
- [ ] `/remote-control` slash command in the TUI shows the banner
- [ ] `GET /status` returns `200` with a valid Bearer token
- [ ] `GET /status` returns `401` without a token
- [ ] Dashboard loads at `/` and lists the active sessions
- [ ] `GET /events?token=<t>` streams events when prompts are sent
- [ ] Sending a prompt from the dashboard reaches the TUI
- [ ] Permission request from the TUI shows up in the dashboard
- [ ] Approving from the dashboard unblocks the TUI
- [ ] `.opencode/pilot-audit.log` has entries for `request`,
      `prompt.sent`, `permission.requested`, `permission.responded`
- [ ] (Telegram) startup message arrives in the configured chat
- [ ] (Telegram) permission request arrives with inline buttons
- [ ] (Tunnel) banner shows `Public:` line with a public URL
- [ ] (Tunnel) public URL serves the dashboard when queried from
      another network
- [ ] SSE connection stays open longer than 60 seconds with `: ping` lines

## Clean up

Stop OpenCode with `Ctrl+C`. The plugin's shutdown hook runs in order:

1. Stop the HTTP server (`Bun.serve.stop()`)
2. Stop the tunnel process (if any)
3. Stop the Telegram polling loop
4. Delete `.opencode/pilot-state.json`

`.opencode/pilot-banner.txt` is NOT deleted — it is kept as a reference of
the last run. `.opencode/pilot-audit.log` is append-only and grows over
time; rotate or delete it manually when you no longer need the history:

```bash
rm .opencode/pilot-banner.txt
rm .opencode/pilot-audit.log
```

If OpenCode exits unexpectedly and leaves a stale state file, it is safe
to delete manually — the next run regenerates it.

If port 4097 is still held by a dead process:

```bash
lsof -i :4097
# note the PID, then
kill <pid>
```

Or switch to a different port with `PILOT_PORT=5000 opencode`.

## Troubleshooting

If anything in the checklist fails, start with the main `README.md`
**Troubleshooting** section. The two most common problems are:

1. Wrong plugin path in `opencode.jsonc` → use an absolute path.
2. Port already in use → kill the process or pick a new port.

For tunnel and Telegram failures the plugin never crashes — it just logs a
warning and continues without that feature. Check the OpenCode log output
or run OpenCode with the log level at `debug` to see the warnings.
