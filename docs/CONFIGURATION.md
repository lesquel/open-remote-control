# Configuration — opencode-pilot

Since v1.12 there are **two ways** to configure the plugin:

1. **From the dashboard Settings UI** (easy path) — open the dashboard, click the
   gear icon, go to *Plugin configuration*, edit fields, click Save. Values
   are persisted to `~/.opencode-pilot/config.json`.
2. **Via environment variables / `.env` file** (power-user path) — documented
   below. Works the same as it has since v1.0.

Both can coexist. The UI writes to `config.json`; the `.env` file is still
read on startup. Shell environment variables always win over both.

## Priority (highest wins)

```
1. Shell env vars               e.g. PILOT_PORT=5000 opencode
2. ~/.opencode-pilot/config.json (written by the Settings UI)
3. .env files                    (process.cwd()/.env or plugin install dir)
4. Hardcoded defaults            (constants.ts)
```

Two consequences worth internalizing:

- **Shell vars cannot be overridden from the UI.** The Settings UI disables
  those inputs with a "shell" badge. If you want to edit a field from the UI,
  unset the shell variable first.
- **The UI doesn't touch your `.env`.** It writes to `config.json`. If you
  want to share config with a teammate, share the `.env` (or hand them a
  sanitized `config.json`).

## How the plugin loads `.env`

OpenCode does NOT auto-load plugin `.env` files. The plugin loads its own.
Search order:

1. `process.cwd()/.env` (where you launch OpenCode from)
2. The plugin's own install directory (`node_modules/opencode-pilot/.env` or
   the dev repo's root)

**Variables already set in your shell environment WIN** over `.env` values.
This means you can override any setting per-launch:

```bash
PILOT_PORT=5000 opencode    # uses port 5000 just for this run
```

## Using the Settings UI (v1.12+)

From the dashboard:

1. Click the gear icon in the header to open Settings
2. Scroll to **Plugin configuration**
3. Each field shows a badge indicating its source:
   - `saved` — written by the UI, stored in `~/.opencode-pilot/config.json`
   - `.env` — came from a `.env` file
   - `shell` — set via shell environment (input is disabled)
   - `default` — unset, using the built-in default
4. Edit fields and click **Save**. A toast confirms success.
5. Some fields (port, host, tunnel, VAPID keys, enableGlobOpener) require an
   OpenCode restart to take effect — the UI shows an inline warning.
6. **Reset to defaults** deletes `~/.opencode-pilot/config.json`. Doesn't
   affect the current running plugin; takes effect on restart.
7. **Generate VAPID keys** runs `web-push.generateVAPIDKeys()` on the server
   and fills the two key fields. You still have to click Save to persist.

## Quick start `.env`

Minimum to get up and running on localhost:

```bash
# .env (in the directory where you launch OpenCode)
PILOT_PORT=4097
PILOT_HOST=127.0.0.1
```

Reload OpenCode. Banner prints with URL + QR. Open URL — done.

## All variables, organized

### Server binding

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_PORT` | `4097` | TCP port the dashboard server listens on. Pick anything not in use. |
| `PILOT_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to allow LAN access (other devices on your WiFi can reach you). **Do NOT use `0.0.0.0` on untrusted networks** — anyone on the same network gets to your dashboard if they have the token. |

### Tunnel (optional, for public access)

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_TUNNEL` | (off) | `cloudflared` or `ngrok` — starts a public tunnel automatically. See [TUNNEL_TESTING.md](./TUNNEL_TESTING.md). |

### Permissions

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_PERMISSION_TIMEOUT` | `300000` | Milliseconds before a pending tool-permission request expires. Default 5 min. Bump if you frequently leave the dashboard for longer than that. |

### Telegram bot (optional)

If set, the plugin sends notifications + permission prompts to Telegram.

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_TELEGRAM_TOKEN` | (off) | Bot token from @BotFather |
| `PILOT_TELEGRAM_CHAT_ID` | (off) | Your chat ID. Find it via @userinfobot |

If you want the bot, both must be set. See the README for setup instructions.

### Web Push (optional)

For real push notifications on phone (works even when browser is closed).

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_VAPID_PUBLIC_KEY` | (off) | VAPID public key. Generate via `npx web-push generate-vapid-keys`. |
| `PILOT_VAPID_PRIVATE_KEY` | (off) | VAPID private key. Same generator. |
| `PILOT_VAPID_SUBJECT` | `mailto:admin@opencode-pilot.local` | Identifier sent with push. Conventionally a `mailto:` URI. |

If either VAPID key is missing, push notifications are disabled but every
other feature still works.

To generate keys (you only do this ONCE per deployment):

```bash
bunx web-push generate-vapid-keys
```

Output:

```
Public Key:
BNxKL...

Private Key:
abc123...
```

Paste them into `.env`:

```bash
PILOT_VAPID_PUBLIC_KEY=BNxKL...
PILOT_VAPID_PRIVATE_KEY=abc123...
```

### File browser (optional)

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_ENABLE_GLOB_OPENER` | `false` | When `true`, enables `/fs/glob` and `/fs/read` server endpoints — needed for the dashboard's glob search to work. Sandboxed: only paths under your project directory or `$HOME` are accessible. **Off by default for security**; enable only if you understand the risk. |

### Development

| Variable | Default | What it does |
|----------|---------|--------------|
| `PILOT_DEV` | `false` | When `true`, the dashboard HTML is re-read from disk on every request. Use during development to see CSS/JS changes without restarting OpenCode. |
| `PILOT_FETCH_TIMEOUT_MS` | `10000` | Timeout for outbound HTTP calls (Telegram API, push send). 10s default. |

## Sample `.env` for common scenarios

### Scenario 1: solo dev, localhost only

```bash
PILOT_PORT=4097
PILOT_HOST=127.0.0.1
```

### Scenario 2: solo dev, want phone access in same WiFi

```bash
PILOT_PORT=4097
PILOT_HOST=0.0.0.0      # allow LAN
```

Open dashboard, click phone icon, scan QR from "Local network" tab.

### Scenario 3: dev + phone access from anywhere (cellular too)

```bash
PILOT_PORT=4097
PILOT_HOST=127.0.0.1    # tunnel handles public; bind locally
PILOT_TUNNEL=cloudflared
```

Make sure cloudflared is installed (`brew install cloudflared` or equivalent).

### Scenario 4: dev + Telegram notifications

```bash
PILOT_PORT=4097
PILOT_HOST=127.0.0.1
PILOT_TELEGRAM_TOKEN=1234567890:AAEhBP...
PILOT_TELEGRAM_CHAT_ID=987654321
```

### Scenario 5: full setup (LAN + tunnel + Telegram + push)

```bash
PILOT_PORT=4097
PILOT_HOST=0.0.0.0
PILOT_TUNNEL=cloudflared
PILOT_PERMISSION_TIMEOUT=600000
PILOT_TELEGRAM_TOKEN=1234567890:AAE...
PILOT_TELEGRAM_CHAT_ID=987654321
PILOT_VAPID_PUBLIC_KEY=BNxK...
PILOT_VAPID_PRIVATE_KEY=abc1...
PILOT_VAPID_SUBJECT=mailto:you@example.com
PILOT_ENABLE_GLOB_OPENER=true
```

## Security notes

1. **Never commit your `.env` to git.** It's gitignored by default. Always
   verify before pushing.
2. **Tokens in URLs are sensitive.** When you share a screenshot of the
   dashboard, the URL bar may include `?token=…`. Crop it out.
3. **Rotate tokens periodically** if you've used a tunnel:
   ```bash
   curl -X POST -H "Authorization: Bearer OLD_TOKEN" http://127.0.0.1:4097/auth/rotate
   ```
   The plugin generates a new token and disconnects all SSE clients. They'll
   need to re-scan the QR.
4. **Telegram bot tokens are powerful.** Treat them like passwords. Anyone
   with your bot token can send messages as your bot. Revoke via @BotFather
   if leaked.
5. **VAPID keys can be reused** across deployments but each browser
   subscription is tied to the public key. If you change the public key,
   existing subscriptions become invalid.

## How users replicate YOUR setup

If you're sharing your setup with someone (e.g. a teammate):

1. **Don't share your `.env`.** They need their own.
2. Share `.env.example` instead — a template with placeholder values that
   shows what variables exist.

The repo already has `.env.example`. Update it whenever you add new
variables. Users copy it to `.env` and fill in their own values.

## Troubleshooting `.env` issues

**"Setting `PILOT_HOST=0.0.0.0` doesn't work, dashboard still binds to localhost"**

→ The plugin probably isn't loading your `.env`. Check the OpenCode log on
startup — you should see a line like `Loaded .env from /path/to/.env (3 vars)`.
If you don't see it, the file isn't being found. Move it to `process.cwd()`
(where you run `opencode` from) or the plugin's install directory.

**"Push notifications enabled but `/push/public-key` returns 503"**

→ VAPID keys not set. Run the generator and paste both keys into `.env`,
restart OpenCode.

**"Telegram bot doesn't respond to /start"**

→ Bot was never started by the plugin. Check the OpenCode log for
`telegram bot started` or errors. Common cause: invalid bot token. Test the
token: `curl https://api.telegram.org/bot<TOKEN>/getMe`.

**"My settings reset on reboot"**

→ `.env` not in the directory you launch from. Use `pwd` to check, then
`mv .env <correct-dir>/`. Or set the vars in your shell rc (`~/.bashrc`,
`~/.zshrc`) for permanence across all directories.
