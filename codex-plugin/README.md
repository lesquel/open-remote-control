# opencode-pilot Codex Plugin

Remote control dashboard for your Codex CLI sessions — monitor activity, approve permissions, send prompts, and get push/Telegram notifications. All from a browser or your phone.

This is the **Codex Plugin** for [opencode-pilot](https://github.com/lesquel/open-remote-control). It bundles a `/remote` skill and a 3-tool MCP server that proxy to the already-running opencode-pilot HTTP server.

---

## Prerequisites

- **opencode-pilot** installed globally:
  ```sh
  npm i -g @lesquel/opencode-pilot
  ```
- **Node.js >= 16** available in the same shell where you run codex.

  > **nvm users**: If you use nvm to manage Node, make sure `node` is in PATH when codex starts. The MCP server is invoked as `node scripts/mcp-server.mjs` — if the shell that launched codex doesn't have nvm initialized, `node` may not be found. Add `nvm use --silent` or pin a default Node version with `nvm alias default <version>`.

- **curl** available on your PATH (used in the generated hook commands).

---

## Install

### Step 1 — Add the marketplace entry

Paste this JSON into `~/.agents/plugins/marketplace.json` (create the file if it doesn't exist):

```json
{
  "name": "lesquel-personal",
  "interface": { "displayName": "lesquel plugins" },
  "plugins": [
    {
      "name": "opencode-pilot",
      "source": {
        "source": "git",
        "url": "https://github.com/lesquel/open-remote-control.git",
        "path": "codex-plugin",
        "ref": "main"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

### Step 2 — Restart codex

```sh
# quit the current codex session and restart
codex
```

### Step 3 — Install the plugin

```
codex /plugins
```

Select **OpenCode Pilot** and choose **Install**. Codex will clone the repo and copy the `codex-plugin/` subfolder to its plugin cache.

### Step 4 — Start opencode-pilot

In a **separate terminal**:

```sh
opencode
```

The pilot HTTP server starts automatically when opencode loads it as a plugin, listening on `localhost:4097` by default. It writes its token and port to `~/.opencode-pilot/pilot-state.json` — the MCP server reads this file automatically.

### Step 5 — Configure your Codex hooks

In a codex chat session:

```
configure codex hooks for pilot
```

Codex will call `pilot.configure_hooks`, show you a preview of the TOML that will be written, and ask you to confirm. Reply "yes" or "confirm" to write the config.

### Step 6 — Restart codex

Hooks are loaded on startup, so restart codex one more time:

```sh
codex
```

After this, every Codex session emits lifecycle events to the pilot dashboard.

---

## Usage

Once installed, type `/remote` in any codex session:

```
/remote
```

This runs `pilot.status` then `pilot.open_dashboard` and prints the dashboard URL. Open it in your browser.

### Available MCP tools

| Tool | What it does |
|------|-------------|
| `pilot.status` | Health check + token validation. Run this first if something seems wrong. |
| `pilot.open_dashboard` | Returns dashboard URL (tunnel > LAN > localhost) + ASCII QR code. |
| `pilot.configure_hooks` | Writes the `[hooks]` block to your codex `config.toml`. Dry-run by default; pass `confirm: true` to write. Creates a timestamped backup. |

---

## Troubleshooting

### "opencode-pilot is not reachable"

The pilot HTTP server is not running. Start it in a separate terminal:

```sh
opencode
```

If you want to run it standalone (without OpenCode):

```sh
opencode-pilot init
```

### "Pilot is running but rejected the auth token" (AUTH_FAILED)

The token stored in the state file is stale. This happens when opencode-pilot restarts and rotates its token. Fix:

1. Restart opencode (the state file is rewritten on startup).
2. Or set the `PILOT_TOKEN` env var manually:
   ```sh
   PILOT_TOKEN=$(cat ~/.opencode-pilot/pilot-banner.txt | grep Token | awk '{print $2}') codex
   ```

### "node: command not found" when installing the plugin

The MCP server requires `node` in PATH. If you use nvm:

```sh
nvm alias default $(nvm current)  # pin current version as default
```

Then restart codex so it inherits the updated PATH.

### Hooks not firing after configuration

After writing `config.toml`, you must restart codex for the hooks to load. If hooks still don't fire:

1. Check `cat .codex/config.toml` (or `~/.codex/config.toml` for global scope) — verify the `[[hooks.SessionStart]]` blocks are present.
2. Check that `curl` is available: `which curl`.
3. Check pilot is running: ask codex to call `pilot.status`.

### Running both OpenCode and Codex simultaneously

If you run opencode and codex at the same time, both will emit hooks to the same pilot instance. This is expected — you may see duplicate events in the dashboard. Pilot handles them correctly; the dashboard deduplicates by session ID where possible.

---

## How it works

The plugin is a thin proxy. It does NOT launch opencode-pilot — it talks to the already-running HTTP server at `localhost:4097`.

Token discovery order:
1. `~/.opencode-pilot/pilot-state.json` (auto-written by the pilot on startup)
2. `PILOT_URL` + `PILOT_TOKEN` env vars (power-user override)
3. Default URL `http://localhost:4097` with no token (yields AUTH_FAILED naturally on authed endpoints)

The TOML hook format is verified against `codex-rs/config/src/hook_config.rs` — each hook uses the nested `[[hooks.EventName.hooks]]` table array with `type = "command"` and a single `command` string (the curl invocation).
