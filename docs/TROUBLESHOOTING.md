# Troubleshooting — runtime problems with `@lesquel/opencode-pilot`

Install-time problems are covered in [`INSTALL.md`](./INSTALL.md). This document is about the plugin **after** it's installed: you ran `bunx init`, restarted OpenCode, and something isn't working right.

If your exact symptom isn't here, open an issue at <https://github.com/lesquel/open-remote-control/issues> — include the version (`bunx @lesquel/opencode-pilot --version`), the OpenCode log lines prefixed with `opencode-pilot`, and what you expected vs. what you saw.

---

## Diagnostic quick-start (run these first, always)

Before following any of the specific scenarios below, run these three commands. 90% of reports can be narrowed down from their output alone.

### 1. Is the plugin actually running?

```bash
# Linux / macOS:
ss -tulpn | grep :4097
# Windows (PowerShell):
Get-NetTCPConnection -LocalPort 4097 -ErrorAction SilentlyContinue
```

- **No output** → nothing is listening. The plugin didn't bind the port. Jump to [§ Plugin did not load](#plugin-did-not-load).
- **Something is listening** → jump to step 2 to check if it's us.

### 2. Is the listener our plugin?

```bash
curl -s http://127.0.0.1:4097/health | head -c 400
```

- **JSON with `"version": "..."` and `"services": {...}`** → it's our plugin, it's alive. Jump to [§ Plugin is running but `/remote` says "not running"](#plugin-is-running-but-remote-says-not-running).
- **404, different JSON shape, or empty body** → something else grabbed port 4097 before OpenCode booted. Jump to [§ Another process owns port 4097](#another-process-owns-port-4097).
- **Connection refused** → the `ss` line lied or the process died between steps 1 and 2. Re-run step 1.

### 3. What does the state file look like?

```bash
ls -la ~/.opencode-pilot/pilot-state.json
cat  ~/.opencode-pilot/pilot-state.json 2>/dev/null | jq .
```

- **File exists, valid JSON with `token`, `port`, `host`, `pid`** → state is fine. The slash commands should be working; if they aren't, restart OpenCode once more.
- **File missing** → this is the issue #1 symptom family. Root cause depends on steps 1 and 2 above.

### 4. What do OpenCode's logs say?

The plugin logs through `ctx.client.app.log`. Lines from us are prefixed with `opencode-pilot`.

```bash
opencode logs 2>&1 | grep opencode-pilot | tail -40
```

As of 1.13.13, you should see at least:

```
opencode-pilot  Plugin loading — version 1.13.13, pid <N>, directory <your cwd>
opencode-pilot  Remote control active on 127.0.0.1:4097
```

- **Neither line appears** → the plugin didn't load. OpenCode either didn't parse your `opencode.json` or couldn't resolve the package. See [§ Plugin did not load](#plugin-did-not-load).
- **"Plugin loading" appears but "Remote control active" does not** → activation crashed between the two logs. The log lines between them tell you where. In almost every case we'll also see one of the new 1.13.13 error lines (`CRITICAL: could not write pilot-state.json ...`) — read it literally; it names the exact path and error.

---

## Plugin is running but `/remote` says "not running"

You confirmed in the diagnostic quick-start that `/health` responds with pilot JSON, but the TUI still toasts "Remote control server not running or token not yet available".

As of 1.13.13, the TUI actually distinguishes three scenarios. The toast you see tells you which:

### Toast says "Pilot server is responding on 127.0.0.1:4097 ... but the state file ... is missing"

This is the issue #1 symptom. The server booted and is listening, but `writeState` did not leave a file on disk at `~/.opencode-pilot/pilot-state.json`.

**Most likely causes, in order:**

1. **`~/.opencode-pilot/` is unwritable.** Check permissions:

   ```bash
   ls -ld ~/.opencode-pilot
   # If the directory is missing, that's fine — writeState creates it on boot.
   # If it exists but is owned by root or lacks write permission for you:
   sudo chown -R "$USER:$USER" ~/.opencode-pilot
   chmod u+rwx ~/.opencode-pilot
   ```

2. **Filesystem is exotic** (overlay mount, tmpfs with a quota, NFS with synchronous-write issues, read-only mount). The 1.13.13 `activatePrimary` logs this exactly — look for `CRITICAL: writeState() returned ok but <path> is missing on disk`.

3. **An older plugin version is cached** at `~/.cache/opencode/packages/@lesquel/opencode-pilot@latest/` and never wrote to the global path. Fix:

   ```bash
   pkill -f opencode                                           # fully quit
   rm -rf ~/.cache/opencode/packages/@lesquel/opencode-pilot*  # clear cache
   bunx @lesquel/opencode-pilot@latest init                    # reinstall
   opencode                                                    # reopen
   ```

   If `bunx init` prints the red "CONFIG WRITTEN — BUT PLUGIN CACHE NOT REFRESHED" banner, you still have OpenCode running somewhere. Find it (`pgrep -af opencode`) and kill it before re-running.

### Toast says "Something is listening on 127.0.0.1:4097, but it is not the pilot server"

Another process grabbed the port before OpenCode's plugin could bind. Common culprits:

- An old `opencode` process from a previous terminal window that you thought you closed (`pgrep -af opencode`).
- A random dev server that defaults to 4097 (rare, but check with `ss -tulpn | grep :4097`).
- A reverse proxy or Docker port-forward on your machine.

Fix options:

1. Kill the other process. `sudo ss -tulpn | grep :4097` shows the PID.
2. Change the pilot port. Set `PILOT_PORT=4098` in your shell or in `~/.opencode-pilot/config.json` and restart OpenCode.

### Toast says "Nothing is listening on 127.0.0.1:4097 and no state file was found"

The plugin never started — or started, crashed, and nothing is holding the port now. See [§ Plugin did not load](#plugin-did-not-load).

---

## Plugin did not load

OpenCode started but our plugin's logs never appeared in `opencode logs | grep opencode-pilot`.

### Check 1 — is the plugin listed in the config files?

```bash
cat ~/.config/opencode/opencode.json | jq .plugin
cat ~/.config/opencode/tui.json      | jq .plugin
```

Both should contain `"@lesquel/opencode-pilot@latest"`. If either is missing, re-run `bunx @lesquel/opencode-pilot@latest init`.

**Common mistake:** having the plugin only in `opencode.json` (you get the HTTP server but no slash commands), or only in `tui.json` (you get slash commands but no HTTP server to actually connect to). Since 1.12.8, the installer always writes both.

### Check 2 — is the package actually resolvable?

```bash
ls ~/.config/opencode/node_modules/@lesquel/opencode-pilot/package.json
```

If that path doesn't exist, the installer didn't complete. Re-run `bunx init` and read its output carefully — any `bun add` or `npm install` error line is the real problem.

### Check 3 — is OpenCode loading a stale cached copy?

OpenCode caches resolved npm plugins at `~/.cache/opencode/packages/@lesquel/opencode-pilot@latest/`. If that cache predates the version listed in `node_modules/`, OpenCode may prefer the cache. 1.13.13's `init` refuses to silently continue in this case — if you saw the red "CONFIG WRITTEN — BUT PLUGIN CACHE NOT REFRESHED" banner, you must quit every OpenCode process before re-running init.

### Check 4 — does OpenCode itself start cleanly?

Unrelated plugins can fail load and knock ours out in collateral. Look for early errors in `opencode logs` before the first `opencode-pilot` line would appear. If you see unrelated plugin errors, temporarily empty your `plugin` arrays in both configs and start `opencode` — if it boots clean, re-add plugins one at a time to find the offender.

---

## Another process owns port 4097

`/health` returns something that isn't our JSON, or `ss` shows a non-opencode process.

### Find the owner

```bash
ss -tulpn | grep :4097
# or:
lsof -i :4097
```

### Kill it or move ours

**Kill it:** `kill <PID>` (or `kill -9 <PID>` if graceful shutdown doesn't work). Then restart OpenCode.

**Move ours to a different port** — recommended if the other process is intentional:

1. Pick a free port (e.g. 4098, 4099).
2. Set it in one of these (shell env wins):

   ```bash
   # Shell (highest priority — overrides everything):
   export PILOT_PORT=4098

   # Plugin config.json (next):
   # edit ~/.opencode-pilot/config.json → "PILOT_PORT": "4098"

   # Or .env in your OpenCode config dir:
   # ~/.config/opencode/.env → PILOT_PORT=4098
   ```

3. Restart OpenCode.

Changing `PILOT_PORT` affects the dashboard URL and the pre-encoded QR. The `/remote` slash command, banner, and Telegram startup message all read from the live config, so nothing else needs to change.

---

## Dashboard shows "Authorization required" or 401 on every request

The token in the dashboard URL no longer matches the server's current token. Two cases:

1. **You opened an old bookmark.** Token rotated on the last restart. Re-open the dashboard through the `/remote` slash command (it builds a fresh URL).
2. **You rotated the token manually** (via dashboard Settings → Rotate Token). Old tabs hold the old token. Refresh.

Tokens are regenerated on every plugin boot. This is by design — restarting OpenCode is a reasonable "session boundary".

---

## SSE stream disconnects every ~10 seconds

You see the dashboard "reconnecting" indicator every ten seconds. This is OpenCode's built-in SSE idle timeout on certain versions.

**Fix already in the plugin**: `Bun.serve` is started with `idleTimeout: 255` (max Bun allows) plus 25-second keepalive pings on the SSE bus. If you still see disconnects, you're running something older than 1.7.x — upgrade.

---

## Phone / remote access doesn't work

### LAN — phone on same Wi-Fi

1. Banner prints the LAN URL on startup — use that one, not `127.0.0.1:...`.
2. If it times out, your OS firewall is blocking 4097. Allow it:

   ```bash
   # macOS:  System Settings → Network → Firewall → opencode → Allow
   # Linux:  sudo ufw allow 4097/tcp
   # Windows: New-NetFirewallRule -DisplayName "opencode-pilot" -LocalPort 4097 -Protocol TCP -Action Allow
   ```

3. `PILOT_HOST` defaults to `127.0.0.1` for security. If your banner shows `127.0.0.1` instead of a LAN IP, set `PILOT_HOST=0.0.0.0` in the plugin config and restart.

### Public tunnel (cloudflared / ngrok)

1. Set `PILOT_TUNNEL=cloudflared` (or `ngrok`) in the plugin config.
2. The binary must be on `PATH`. Check with `which cloudflared`.
3. The banner shows the public URL only when the tunnel successfully starts. If it's missing, look for a warn line in the OpenCode log: `Tunnel provider X requested but unavailable`. The most common cause is the binary not being installed.

Detailed tunnel testing: [`TUNNEL_TESTING.md`](./TUNNEL_TESTING.md).

---

## Telegram notifications don't arrive

1. `PILOT_TELEGRAM_TOKEN` and `PILOT_TELEGRAM_CHAT_ID` must both be set. One without the other does nothing.
2. Send a test message: in the dashboard → Settings → Telegram → "Send test".
3. If the test fails, look for a line in the OpenCode log: `telegram.send_failed { error: ... }`. That error is the real problem (usually an invalid chat ID or revoked token).

---

## Web push notifications don't arrive

1. Web Push needs VAPID keys. Generate from the dashboard → Settings → Web Push → "Generate VAPID keys". They get written to `~/.opencode-pilot/config.json`.
2. Subscribe in the dashboard → Settings → Web Push → "Subscribe". Your browser will prompt for permission.
3. If push never arrives after subscribing, check your browser's push permissions for the dashboard URL. Some browsers revoke permissions after 30 days of no focus.

---

## `/remote` opens the wrong project tab

As of 1.13.12, `/remote` encodes your current working directory as a `#dir=` hash fragment in the URL and the dashboard auto-switches tabs on boot. If you end up on a different tab:

1. Run `pwd` in the terminal where you typed `/remote` — is that really the project you expected?
2. If the tab exists but didn't activate, check the browser's localStorage under `pilot:tabs` — a stale entry might be shadowing the auto-switch. Clear localStorage for the dashboard domain.
3. If the hash was stripped by a browser extension or proxy, the fallback is manual: click the tab in the dashboard strip. The state is remembered in localStorage for next time.

---

## Still stuck

Before opening an issue, collect:

```bash
# 1. Exact installed version:
bunx @lesquel/opencode-pilot --version

# 2. Config snapshot (redact tokens before sharing):
cat ~/.config/opencode/opencode.json
cat ~/.config/opencode/tui.json
cat ~/.opencode-pilot/config.json

# 3. Last 100 lines of OpenCode logs matching our plugin:
opencode logs 2>&1 | grep -i opencode-pilot | tail -100

# 4. Port + state file state:
ss -tulpn | grep :4097
ls -la ~/.opencode-pilot/
curl -s http://127.0.0.1:4097/health

# 5. OS + OpenCode versions:
uname -a
opencode --version
```

Post that (with tokens redacted) in your issue report. We'll usually triage within 24h.
