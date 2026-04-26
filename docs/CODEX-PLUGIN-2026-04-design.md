# Codex Plugin for opencode-pilot — Design Spec

**Status:** Approved (pending implementation)
**Date:** 2026-04-26
**Target version:** Plugin `v1.18.1` (initial; tracks current opencode-pilot)
**Branch:** TBD (suggested: `feat/codex-plugin`)
**Predecessor research:** [`docs/CODEX-PLUGIN-RESEARCH.md`](./CODEX-PLUGIN-RESEARCH.md)
**Scope:** Net-new feature. Adds a `codex-plugin/` subfolder to the existing `open-remote-control` repo. Does NOT modify the published npm package or the existing `POST /codex/hooks/:event` HTTP bridge.

---

## TL;DR

Package `opencode-pilot` as a formal Codex Plugin so codex users get the same `/remote` experience that opencode users get today. Distribution is via personal marketplace pointing at a `codex-plugin/` subfolder of the existing repo. The plugin bundles a `SKILL.md` (teaches the workflow), a 3-tool MCP server (`pilot.status`, `pilot.open_dashboard`, `pilot.configure_hooks`), and the `plugin.json` manifest. Effort: ~6-8 hours, one focused session.

The plugin is a **thin proxy** to the already-running opencode-pilot HTTP server (`localhost:4097`). It does NOT launch the server, does NOT replicate its functionality, and does NOT mutate user state without explicit confirmation.

---

## Context — why now

`opencode-pilot` v1.18.0 added a Codex HTTP bridge (`POST /codex/hooks/:event`) that codex can be configured to call when its hooks fire. Today this requires the user to:
1. Manually run `opencode-pilot` (or have OpenCode auto-start it as a plugin)
2. Manually edit `~/.codex/config.toml` to add `[hooks]` blocks pointing at the bridge endpoint
3. Manually copy the auth token from the pilot banner into the curl commands

This works but has friction for codex users who don't already use opencode. The user reported this as a gap: "in codex CLI I expected `/remote` to be there like in opencode."

A formal Codex Plugin closes that gap. It uses the **real plugin system** in `codex-rs/core-plugins/` (verified during research) — `.codex-plugin/plugin.json`, marketplace registration, MCP server bundling, skills.

---

## Locked decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Path B**: skill + MCP server (no auto-launch) | Auto-launch (Path C) is fragile — Bun daemon management adds 2-3 sessions for ambiguous value. Path A (skill only) leaves user doing manual TOML edits. Path B is the sweet spot. |
| D2 | **Token discovery: hybrid** — state file first (`~/.opencode-pilot/pilot-state.json`), fallback to env var (`PILOT_TOKEN`) | State file is auto-magic when pilot already wrote it. Env var allows power-user override. Default URL fallback exists for completeness but yields AUTH_FAILED naturally. |
| D3 | **When pilot not running: detect + instruct** — tools return rich error with start command; NO auto-launch | Honest about the constraint. Daemon management is its own project. Most users have pilot already running via `opencode` CLI. |
| D4 | **Language: Node.js** (`.mjs` ESM) | codex-cli already requires Node (`engines: node >=16`). Forcing Bun or Python adds barriers for codex-only users. Performance is irrelevant for ~10 fetch/sec. |
| D5 | **MVP tool set: 3 tools** — `pilot.status`, `pilot.open_dashboard`, `pilot.configure_hooks` | Covers "first 5 minutes" UX. The other 3 from research (sessions/permissions) are dashboard's job; defer to v2 if real demand. |
| D6 | **`configure_hooks` scope: project-local default + `--global` flag** | Matches npm/gh/git convention (local first, --global override). Project-local is safer (one mistake = one project). Plus 3 non-negotiable behaviors: dry-run preview, automatic backup, idempotent. |

---

## Final architecture

### Folder structure

```
opencode-pilot/                         # existing repo (open-remote-control)
├── (existing: src/, docs/, AGENTS.md, etc. — unchanged)
├── codex-plugin/                       # NEW — entire Codex Plugin
│   ├── .codex-plugin/
│   │   └── plugin.json                 # plugin manifest
│   ├── skills/
│   │   └── remote/
│   │       └── SKILL.md                # `/remote` skill (~30 lines markdown)
│   ├── .mcp.json                       # MCP server config (single entry)
│   ├── scripts/
│   │   └── mcp-server.mjs              # ~150 lines, Node ESM, MCP SDK
│   ├── tests/
│   │   └── mcp-server.test.mjs         # bun test, ~100 lines, 7 tests, mocked pilot HTTP
│   ├── README.md                       # install + use, marketplace snippet
│   └── package.json                    # private; declares @modelcontextprotocol/sdk dep
└── (npm package files: src/, docs/, ... — unchanged; codex-plugin/ NOT in `files` field)
```

### Why a subfolder (not a separate repo)

- One release process: existing CI/Release workflow covers both
- Versioning conjoined initially: plugin tracks pilot npm version
- Documentation co-located: `docs/CODEX-INTEGRATION.md` already in the repo
- No npm publish: codex plugins install via marketplace.json (git URL), not npm

### Why not in the published npm package

- `package.json` `files` field stays as-is: `["src/", "README.md", ...]`. The `codex-plugin/` subfolder is NOT included in the npm tarball
- npm consumers don't get the codex plugin (they don't need it — they use opencode)
- Codex consumers install via git URL pointed at the repo root with `path: "codex-plugin"`

### Distribution (user-facing install)

User adds an entry to `~/.agents/plugins/marketplace.json`:

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

Then `codex /plugins` → install. Codex clones the repo, takes `codex-plugin/` subfolder, installs to `~/.codex/plugins/cache/lesquel-personal/opencode-pilot/main/`.

The `codex-plugin/README.md` ships this snippet ready to copy-paste.

---

## Components

### 1. `plugin.json` (manifest)

```json
{
  "name": "opencode-pilot",
  "version": "1.18.1",
  "description": "Remote control dashboard for Codex sessions — monitor, send prompts, approve permissions, get notifications.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "OpenCode Pilot",
    "shortDescription": "Remote control for your Codex sessions",
    "longDescription": "Monitor sessions, approve permissions, send prompts, and receive push/Telegram notifications — all from a browser dashboard or your phone. Requires opencode-pilot HTTP server running locally (install via `npm i -g @lesquel/opencode-pilot` and run `opencode`).",
    "developerName": "lesquel",
    "category": "Productivity",
    "capabilities": ["Interactive", "Read"],
    "websiteURL": "https://github.com/lesquel/open-remote-control",
    "brandColor": "#3B82F6",
    "defaultPrompt": [
      "Open the remote control dashboard",
      "Configure my Codex hooks for opencode-pilot",
      "Check pilot status and dashboard URL"
    ]
  }
}
```

**Constraints verified in `codex-rs/core-plugins/src/manifest.rs`:**
- `defaultPrompt`: max 3 entries × 128 chars (`MAX_DEFAULT_PROMPT_COUNT`, `MAX_DEFAULT_PROMPT_LEN`)
- `skills` and `mcpServers`: must start with `./`; `..` rejected by `resolve_manifest_path`
- `name`: normalized; defaults to directory name if blank
- `version`: tracks opencode-pilot npm version initially; bumps independently after first release

### 2. `skills/remote/SKILL.md`

```markdown
---
name: "remote"
description: "Manage and open the opencode-pilot remote control dashboard for Codex sessions. Use when the user wants to monitor sessions remotely, get permission notifications on their phone, or open a web dashboard for codex."
---

# Remote control via opencode-pilot

The user has opencode-pilot installed (an HTTP server on localhost:4097 that exposes a web dashboard, SSE event stream, and permission queue). This skill lets you help them connect codex to it.

## Workflow

1. **First, check status**: call `pilot.status` MCP tool. If `running: false`, instruct the user to start it (the tool's error message includes the exact command for their OS).

2. **If hooks not configured yet**: call `pilot.configure_hooks` (defaults to project-local `.codex/config.toml`). This returns a dry-run preview first — show it to the user, ask them to confirm. If they confirm, call again with `{ confirm: true }`.

3. **To open the dashboard**: call `pilot.open_dashboard`. Returns the URL the user should open in their browser. If they're on phone, the response includes a QR code (ASCII).

## When the user types `/remote`

Run `pilot.status` then `pilot.open_dashboard` and present the dashboard URL with a one-line summary of what they can do there.

## When opencode-pilot is NOT running

DO NOT try to start it yourself — codex plugins cannot launch background processes. Tell the user the exact command from the error response and wait for them to start it.
```

~30 lines. Concrete, no vagueness. The `description` frontmatter field is what codex uses to decide when to load this skill into context.

### 3. `.mcp.json` (MCP server config)

```json
{
  "mcpServers": {
    "opencode-pilot": {
      "command": "node",
      "args": ["scripts/mcp-server.mjs"],
      "env": {
        "PILOT_URL": "",
        "PILOT_TOKEN": ""
      }
    }
  }
}
```

`PILOT_URL` and `PILOT_TOKEN` empty by default. The MCP server resolves connection in this order: state file → env vars → defaults.

### 4. `scripts/mcp-server.mjs` (the MCP server)

~150 lines, Node ESM, single file. Structure:

```
mcp-server.mjs
├── imports: @modelcontextprotocol/sdk, node:fs, node:path, node:os
├── constants:
│     PILOT_DEFAULT_URL = "http://localhost:4097"
│     STATE_FILE_PATH   = ~/.opencode-pilot/pilot-state.json
├── resolveConnection() → { url, token, source }
│     // 1. Try state file
│     // 2. Else env vars
│     // 3. Else default URL, no token
├── pilotFetch(path, options) → { ok: true, data } | { ok: false, error }
│     // wraps fetch() with auth header + base URL + 5s timeout
├── createOSStartHint() → "Start it: opencode" (with OS-aware variants if useful)
├── tools:
│     pilotStatus()         — GET /health
│     pilotOpenDashboard()  — GET /connect-info
│     pilotConfigureHooks() — see Tool 3 detailed behavior below
├── server.start() — stdio transport
```

**Token discovery code** (~35 lines, hybrid pattern):

The state file shape is fixed by `src/core/state/store.ts` `PilotState` interface — `{ token, port, host, startedAt, pid }`. **There is NO `url` field.** The URL must be reconstructed from `host` + `port`. If `host` is `0.0.0.0` (the default per `src/server/constants.ts` `DEFAULT_HOST`), use `127.0.0.1` for the client URL (browsers can't connect to `0.0.0.0` reliably).

The state file path is determined by `globalStatePath()` in `src/core/state/store.ts`, which calls `stateFile("pilot-state.json")` from `src/infra/paths/index.ts`. That function respects `XDG_STATE_HOME` on Linux/macOS — defaulting to `~/.opencode-pilot/pilot-state.json` only when `XDG_STATE_HOME` is unset. The MCP server should mirror that resolution logic (read `XDG_STATE_HOME` first).

```js
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import * as os from "node:os"

const PILOT_DEFAULT_URL = "http://localhost:4097"

function getStateFilePath() {
  if (process.env.PILOT_STATE_FILE) return process.env.PILOT_STATE_FILE  // test-only override
  const xdg = process.env.XDG_STATE_HOME
  const dir = xdg ? join(xdg, "opencode-pilot") : join(os.homedir(), ".opencode-pilot")
  return join(dir, "pilot-state.json")
}

function resolveConnection() {
  // 1. State file (preferred — auto-discovery from running pilot)
  const stateFile = getStateFilePath()
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"))
      if (state.token && state.host && state.port) {
        // Browsers + MCP can't reliably hit 0.0.0.0; use 127.0.0.1 instead
        const host = state.host === "0.0.0.0" ? "127.0.0.1" : state.host
        return {
          url: `http://${host}:${state.port}`,
          token: state.token,
          source: "state-file",
        }
      }
    } catch { /* fall through to env vars */ }
  }
  // 2. Env vars (power-user override)
  if (process.env.PILOT_URL && process.env.PILOT_TOKEN) {
    return {
      url: process.env.PILOT_URL,
      token: process.env.PILOT_TOKEN,
      source: "env",
    }
  }
  // 3. Default URL, no token (will fail with AUTH_FAILED on any authed endpoint)
  return { url: PILOT_DEFAULT_URL, token: undefined, source: "default" }
}
```

`PILOT_STATE_FILE` is a **test-only override** — not documented in `.mcp.json`'s env block, only used by the test suite to point at a tmp-dir state file.

### 5. `package.json` (codex-plugin deps)

```json
{
  "name": "codex-plugin-opencode-pilot",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

Single dep. Lives in `codex-plugin/` (NOT the repo root). Doesn't touch the npm package's dependencies.

### 6. Tests (`tests/mcp-server.test.mjs`)

bun test (consistent with rest of repo) — `~120 lines`, 7 tests:

1. `pilot.status` with mock pilot alive + valid token → `{ running: true, token_valid: true, ... }`
2. `pilot.status` with mock pilot alive + invalid token → `{ running: true, error: AUTH_FAILED }` (probes /connect-info)
3. `pilot.status` with no mock pilot → `{ running: false, error: NOT_RUNNING }`
4. `pilot.open_dashboard` with mock pilot → primary URL valid + alternative_urls populated
5. `pilot.configure_hooks` dry-run → returns preview with full TOML, file unchanged
6. `pilot.configure_hooks` confirm → file written with correct nested `[[hooks.X.hooks]]` structure, backup created with timestamp
7. Token discovery — three branches: (a) state file present (with `host`+`port` reconstruction, `0.0.0.0` → `127.0.0.1`); (b) state file absent + env vars present → uses env; (c) state file absent + no env vars → default URL, no token

Mock pilot HTTP server via `Bun.serve` on random port; tests run isolated in tmp dirs (use `PILOT_STATE_FILE` env override to point at tmp state file).

---

## The 3 MCP tools (detailed signatures)

### Tool 1 — `pilot.status`

**Purpose:** health check + discover URL/version. Entry point for all interactions.

**Input:** none.

**Behavior:**
1. `resolveConnection()` → URL + token + source
2. `GET /health` (no auth required — public endpoint per opencode-pilot routes.ts) — confirms server is reachable + extracts version
3. **If a token is available**, ALSO probe `GET /connect-info` (auth required) to validate the token. If `/health` succeeds but `/connect-info` returns 401, that's `AUTH_FAILED`. If no token (`source === "default"`), skip the probe and return success — `AUTH_FAILED` will surface naturally on the next tool that requires auth.

**Output (success):**
```ts
{
  running: true,
  url: string,                          // reconstructed from state.host + state.port
  version: string,                      // "1.18.1" — from /health response
  source: "state-file" | "env" | "default",
  token_valid: true | false | null,     // true = probe succeeded; false = probe rejected (rotated/wrong token); null = no token available, probe skipped
  features: { tunnel: bool, telegram: bool, push: bool }
}
```

**Note on `token_valid`**: `null` ≠ `false`. `null` means the MCP server had no token to probe (state file missing AND no env vars) — the user needs to start the pilot or set `PILOT_TOKEN`. `false` means a token WAS provided but rejected by `/connect-info` — the user has a stale token (rotated or wrong). The model should phrase the next action differently in each case.

**Output (NOT_RUNNING):**
```ts
{
  running: false,
  error: {
    code: "NOT_RUNNING",
    message: "opencode-pilot is not reachable at <url>",
    hint: "Start it: opencode (in a separate terminal). The pilot auto-starts when opencode loads it as a plugin."
  }
}
```

**Output (AUTH_FAILED — only if token was probed and rejected):**
```ts
{
  running: true,
  error: {
    code: "AUTH_FAILED",
    message: "Pilot is running but rejected the auth token",
    hint: "Set PILOT_TOKEN env var to the value in ~/.opencode-pilot/pilot-banner.txt, or restart opencode-pilot to refresh state file"
  }
}
```

### Tool 2 — `pilot.open_dashboard`

**Purpose:** give the user a URL to open in browser/phone.

**Input:** none.

**Behavior:**
1. `resolveConnection()`
2. `GET /connect-info` (auth required)
3. Compose response prioritizing: tunnel URL > LAN URL > localhost

**Output (success):**
```ts
{
  primary_url: string,                  // tunnel > LAN > localhost
  alternative_urls: string[],
  qr_ascii: string | null,
  instructions: "Open this URL in your browser. Authentication is embedded; you'll be in immediately."
}
```

**Output (errors):** same shape as Tool 1 (NOT_RUNNING / AUTH_FAILED).

### Tool 3 — `pilot.configure_hooks` ⚠️

**Purpose:** write the `[hooks]` block to codex `config.toml` connecting codex hooks to the pilot bridge.

**Input:**
```ts
{
  scope?: "project" | "global",   // default: "project" → <cwd>/.codex/config.toml
  confirm?: boolean,              // default: false → dry-run preview only
}
```

**Hooks configured** (the 6 events of the `CODEX_DISPATCH` table in `src/integrations/codex/handlers.ts`):
- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`

**TOML snippet generated** — verified against `codex/codex-rs/config/src/hook_config.rs` `HookEventsToml` + `MatcherGroup` + `HookHandlerConfig::Command` structs:

The Rust struct `MatcherGroup` requires `hooks: Vec<HookHandlerConfig>` nested inside each event group. The handler is tagged `type = "command"` per `#[serde(tag = "type")]` on `HookHandlerConfig`. `command` is a single `String` (NOT a `Vec<String>`).

```toml
# Added by opencode-pilot Codex Plugin v1.18.1 — do not edit manually.
# Re-run `pilot.configure_hooks` to update.
[hooks]
  [[hooks.SessionStart]]
    [[hooks.SessionStart.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/SessionStart -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"

  [[hooks.UserPromptSubmit]]
    [[hooks.UserPromptSubmit.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/UserPromptSubmit -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"

  [[hooks.PreToolUse]]
    [[hooks.PreToolUse.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/PreToolUse -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"

  [[hooks.PostToolUse]]
    [[hooks.PostToolUse.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/PostToolUse -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"

  [[hooks.PermissionRequest]]
    [[hooks.PermissionRequest.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/PermissionRequest -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"

  [[hooks.Stop]]
    [[hooks.Stop.hooks]]
      type = "command"
      command = "curl -fsS -X POST http://127.0.0.1:4097/codex/hooks/Stop -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' -d @-"
```

The `<TOKEN>` placeholder is replaced with the actual token from `resolveConnection()` at write time. The `<URL>` is reconstructed from `state.host` + `state.port` (with `0.0.0.0` substituted to `127.0.0.1`).

> **Pre-existing bug (separate fix):** `docs/CODEX-INTEGRATION.md` (lines 140-159) shows a TOML format with `name = "..."` and `command = ["array", ...]` that does NOT match the actual codex `hook_config.rs` schema. That doc snippet is wrong and should be updated as a separate task — but it does not block this plugin spec, since `pilot.configure_hooks` writes the CORRECT format.

**Behavior — dry-run path (`confirm: false` or omitted):**
```ts
{
  would_write: true,
  target_path: string,                  // /cwd/.codex/config.toml or ~/.codex/config.toml
  target_exists: boolean,
  already_configured: boolean,          // true if all 6 hooks present with matching commands
  toml_snippet: string,                 // the [hooks] block
  diff_preview: string,                 // human-readable
  next_step: "Call this tool again with { confirm: true, scope: ... } to write the config."
}
```

**Behavior — confirm path (`confirm: true`):**
- **already_configured?** → return `{ written: false, reason: "already_configured", target_path, next_step: "No changes needed." }` (idempotent)
- **pilot not running?** → return `PILOT_NOT_RUNNING` (need token to embed)
- **target not writable?** → return `PERMISSION_DENIED`
- **existing config invalid TOML?** → return `INVALID_TOML`, NO write, suggest manual fix
- **otherwise**: backup → write → return:
  ```ts
  {
    written: true,
    target_path: string,
    backup_path: string | null,         // null if target_exists was false
    next_step: "Codex hooks configured. Restart codex for the hooks to load, then start a new session."
  }
  ```

**Specific errors:**
- `PILOT_NOT_RUNNING`: same hint as Tool 1
- `PERMISSION_DENIED`: `{ code, message: "Cannot write to <path>: permission denied", hint }`
- `INVALID_TOML`: `{ code, message: "Existing <path> has invalid TOML syntax at line N", hint: "Fix it manually, then re-run" }`

### Edge cases (all tools)

| Case | Behavior |
|---|---|
| Pilot reachable but `/health` returns 5xx | Treat as NOT_RUNNING with hint "server reachable but unhealthy" |
| Token present but expired/rotated | AUTH_FAILED — hint suggests `pilot.status` retry or token change |
| Network timeout (>5s) | NOT_RUNNING (pilot hung or not listening) |
| Multi-instance pilot (different port) | Resolved naturally via state file (each pilot writes its URL+token) |
| State file corrupted | Falls through to env vars → fallback to default URL → AUTH_FAILED |
| `pilot.status`: `/health` returns 200 but `/connect-info` times out (>5s) | Return `{ running: true, token_valid: null, error: { code: "PROBE_TIMEOUT", message: "Pilot is running but token validation timed out", hint: "Retry pilot.status; if persistent, check pilot logs for slow handlers" } }`. Distinguish from NOT_RUNNING — pilot IS up, just slow on the authed probe. |

### What the 3 tools explicitly do NOT do

- ❌ List sessions (`pilot.list_sessions`) — open the dashboard
- ❌ Manage permissions (`pilot.get_permissions`, `pilot.resolve_permission`) — open the dashboard
- ❌ Auto-launch the pilot (`pilot.start`) — Path C, fragile, deferred
- ❌ Modify pilot settings — dashboard has full UI
- ❌ Test push notification — dashboard has button

Each can be added in v2 based on real demand.

---

## Lifecycle

```
[Plugin registration]   on codex install (clone git → cache → register skill + MCP)
[MCP server start]      on first tool invocation (codex spawns stdio process)
[MCP server lifetime]   spans codex chat session; restarts cleanly on codex restart
[Pilot HTTP lifetime]   INDEPENDENT — user-managed via opencode CLI
[State persistence]     none in plugin; everything is in pilot's state file + HTTP API
[Failure modes]
  - Pilot dies mid-session  → tools return NOT_RUNNING; user re-starts pilot
  - Codex restarts          → MCP server restarts clean
  - State file corrupted    → fallback to env vars (already designed)
```

**Key**: the plugin holds no state. Pure proxy. Plugin restart = zero data loss.

---

## Install flow (user-perspective, step-by-step)

```
1. (one-time) npm i -g @lesquel/opencode-pilot         # already published, v1.18.1
2. (one-time) Paste marketplace entry to ~/.agents/plugins/marketplace.json
              (snippet ready to copy in codex-plugin/README.md)
3. Restart codex
4. codex /plugins → "OpenCode Pilot" → Install
              → codex clones repo, takes codex-plugin/ subfolder
5. (separate terminal) opencode                         # starts pilot HTTP on localhost:4097
6. In codex chat: "configure codex hooks for pilot"     # invokes pilot.configure_hooks
              → preview → confirm → writes ~/.codex/config.toml
   Restart codex                                        # so hooks load

# After setup, normal use:
- In codex: /remote → invokes skill → MCP tools → dashboard URL
- In codex: any session emits hooks → pilot captures → dashboard shows
```

---

## Versioning strategy

- **Initial release**: plugin `v1.18.1` (synced with current pilot npm version)
- **Subsequent releases**: plugin version bumps **only when plugin code changes** (independent of pilot bumps)
  - Example: pilot bumps to 1.19.0 with new server features → plugin stays at 1.18.1 if no plugin changes needed
  - Example: new MCP tool added → plugin bumps to 1.19.0 (regardless of pilot version)
- **Compat tracking**: `plugin.json` adds custom field `compat: { pilot: ">=1.18.0" }` (informational, not parsed by codex). `pilot.status` exposes it so the model can warn if incompatible.
- **Breaking changes in pilot HTTP API**: documented in CHANGELOG, plugin re-released with new compat range.

---

## Backward compatibility

**Existing functionality is 100% preserved:**
- `POST /codex/hooks/:event` (the endpoint codex hooks call) — UNCHANGED
- Users who today configure hooks manually in `config.toml` continue to work
- The plugin AUTOMATES that configuration step + adds MCP tools that call OTHER endpoints (`/health`, `/connect-info`)
- The `opencode-pilot` npm package is UNCHANGED (no `codex-plugin/` in the `files` field)

---

## Out of scope (v1)

Documented explicit non-goals:

- ❌ Auto-launch of opencode-pilot (Path C — fragile)
- ❌ Tools `pilot.list_sessions`, `pilot.get_permissions`, `pilot.resolve_permission` (deferred to v2)
- ❌ Settings management from codex chat
- ❌ Multi-pilot instances simultaneously
- ❌ Public marketplace of OpenAI (curated submission process not publicly documented)
- ❌ Apps integration (does not apply — pilot is not SaaS)
- ❌ TLS / non-localhost deployments (assumption: pilot on localhost:4097)
- ❌ Plugin TypeScript (Node ESM `.mjs` is sufficient for 150 lines)
- ❌ JSON hook format (`hooks.json`) — only TOML format
- ❌ Custom hook event filtering — always configures all 6 events

---

## Risks + mitigations

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Pilot state file format changes, MCP server breaks | M | M | Stable contract documented in this spec; pilot's `core/state/store.ts` locked; bump `compat` field on breaking changes |
| User sets stale `PILOT_TOKEN` env var | M | L | State file takes precedence in hybrid (designed) |
| `configure_hooks` writes to wrong config.toml | L | **H** | dry-run + backup + idempotent + scope explicit (designed) |
| MCP server fails startup (Node missing) | L | H | Codex requires Node (`engines: >=16`); clear error if missing |
| Codex MCP SDK API breaks the plugin | L | M | Pin SDK version; manual E2E test on SDK update |
| User has pilot on custom port | L | M | Auto-discovery via state file uses real port |
| User has BOTH plugins installed (opencode + codex) for same pilot, double-fires events | L | M | Documented in README: "if running both, expect duplicate events; deduplicate at pilot level if needed" |
| Pilot token rotates between `configure_hooks` runs → backup file overwritten | L | L | Backup files use timestamp suffix `config.toml.bak.<ISO-8601>` — never overwrite. Re-runs after token rotation create new backups, no data loss. |
| `node` not in PATH when codex spawns MCP server (e.g., nvm-managed Node) | M | H | README documents prerequisite: `which node` must succeed in the same shell where codex runs. MCP server `mcp-server.mjs` does a startup check and prints a clear error if `node` features are missing (unlikely but defensive). |
| Marketplace path `~/.agents/plugins/marketplace.json` changes in future codex versions | L | M | Spec verified against current `codex-rs/core-plugins/src/marketplace.rs`. Pin codex version range in plugin metadata if/when codex starts versioning the plugin SDK. |

---

## Definition of Done

Plugin v1 is complete when **ALL** of the following are true:

1. ✅ `codex-plugin/` subfolder exists with the structure documented above
2. ✅ `plugin.json` validates against codex's manifest schema (verified via local marketplace install)
3. ✅ `SKILL.md` teaches the workflow correctly (~30 lines, valid frontmatter)
4. ✅ MCP server passes all **7 bun tests** (status-ok-valid-token, status-auth-failed, status-not-running, dashboard, configure-dryrun, configure-confirm-with-timestamped-backup, token-discovery-3-branches)
5. ✅ The 3 tools respond correctly with the shapes documented in this spec
6. ✅ `configure_hooks` end-to-end: dry-run preview → confirm → writes → backup created → codex emits hook → pilot receives → dashboard shows event
7. ✅ `README.md` (in codex-plugin/) has copy-pasteable marketplace snippet
8. ✅ `CHANGELOG.md` (repo root) mentions the Codex Plugin
9. ✅ **Litmus test**: a fresh user can install + configure + see functional dashboard in **5 min** following the README only (no prior context)
10. ✅ npm package of opencode-pilot is UNCHANGED (additive only — plugin not in `files`)

---

## Effort breakdown

| Component | Estimated lines | Time (focused) |
|---|---|---|
| `plugin.json` + `package.json` + `.mcp.json` | ~30 total | 30 min |
| `SKILL.md` | ~30 | 30 min |
| `mcp-server.mjs` (3 tools + connection + helpers) | ~150 | 2-3h |
| `tests/mcp-server.test.mjs` (7 tests + mocks) | ~100 | 1-2h |
| `README.md` (install + use docs) | ~80 | 1h |
| Manual E2E smoke test | — | 30 min |
| **Total** | **~390 lines** | **~6-8 hours** (1 session) |

---

## References

- [`docs/CODEX-PLUGIN-RESEARCH.md`](./CODEX-PLUGIN-RESEARCH.md) — full research report grounded in codex-rs source
- [`docs/CODEX-INTEGRATION.md`](./CODEX-INTEGRATION.md) — existing HTTP bridge documentation
- [`docs/REFACTOR-2026-04-architecture.md`](./REFACTOR-2026-04-architecture.md) — broader architecture context
- `codex/codex-rs/core-plugins/src/manifest.rs` — `RawPluginManifest` struct (source of truth for manifest schema)
- `codex/codex-rs/core-plugins/src/marketplace.rs` — `Marketplace`, `MarketplacePlugin` types
- `codex/codex-rs/core-plugins/src/loader.rs` — plugin loading (`DEFAULT_MCP_CONFIG_FILE = ".mcp.json"`)
- `codex/codex-rs/core-skills/src/loader.rs` — skill discovery
- `codex/codex-rs/config/src/hook_config.rs` — `HookHandlerConfig` (TOML hook format)
- `opencode-pilot/src/integrations/codex/handlers.ts` — `CODEX_DISPATCH` table (6 hook events)
- `opencode-pilot/src/core/state/store.ts` — pilot state file write (URL + token)
- This spec produced via `/brainstorming` skill on 2026-04-26 (5 sequential decisions + 4 design sections)
