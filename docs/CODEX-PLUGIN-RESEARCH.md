# Codex Plugin for opencode-pilot — Research Report

**Status:** Research only (no implementation)
**Date:** 2026-04-25
**Audience:** lesquel (maintainer)

---

## TL;DR

A Codex Plugin for opencode-pilot is technically feasible using the real plugin system found in the
codex-rs source. The recommended path is **Path B (MCP-based)**: a plugin directory with a
`.codex-plugin/plugin.json`, a `SKILL.md` that teaches users how to start the dashboard, and a
`.mcp.json` MCP server that exposes `pilot.status`, `pilot.open_dashboard`, and `pilot.configure_hooks`
as callable tools. The hard constraint is that the HTTP server (opencode-pilot itself) must already
be running — the Codex plugin ecosystem has no mechanism to launch a Bun process. Effort estimate
for Path B is 1–2 focused sessions.

---

## What Codex Plugins Are (Concise Primer)

A Codex Plugin is a directory that contains a `.codex-plugin/plugin.json` manifest (or
alternatively `.claude-plugin/plugin.json` for Claude-compat). The manifest is a JSON file with
top-level fields `name`, `version`, `description`, `skills`, `mcpServers`, `apps`, and an
`interface` block for marketplace presentation metadata. Codex discovers plugins via a
`marketplace.json` file located at `~/.agents/plugins/marketplace.json` (user-global) or
`<repo-root>/.agents/plugins/marketplace.json` (repo-local). Plugins bundle three kinds of
capabilities: **Skills** (Markdown instruction files that inject context into the model's system
prompt), **MCP Servers** (stdio JSON-RPC processes exposing tools), and **Apps** (OAuth connectors
for external SaaS — not relevant here). The entire runtime is in
`codex-rs/core-plugins/src/loader.rs` and `codex-rs/utils/plugins/src/plugin_namespace.rs`.

---

## Anatomy of a Hypothetical "opencode-pilot" Codex Plugin

### Plugin Manifest Skeleton (`.codex-plugin/plugin.json`)

```json
{
  "name": "opencode-pilot",
  "version": "1.18.1",
  "description": "Remote control dashboard for Codex sessions — dashboard, SSE events, permission queue, push/Telegram notifications.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "OpenCode Pilot",
    "shortDescription": "Remote control for your Codex sessions",
    "longDescription": "Monitor sessions, approve permissions, send prompts, and receive push/Telegram notifications — all from a browser dashboard or your phone.",
    "developerName": "lesquel",
    "category": "Productivity",
    "capabilities": ["Interactive", "Read"],
    "websiteURL": "https://github.com/lesquel/open-remote-control",
    "brandColor": "#3B82F6",
    "defaultPrompt": [
      "Open the remote control dashboard",
      "Configure my Codex hooks for opencode-pilot",
      "Check pilot status and connection info"
    ]
  }
}
```

Key rules derived from the source:
- `skills` and `mcpServers` must be paths starting with `./` relative to the plugin root
  (`resolve_manifest_path` enforces this; `..` is rejected)
- `name` is normalized from `plugin.json` `"name"` field; defaults to directory name if blank
- `interface.defaultPrompt` is capped at 3 entries, 128 chars each
  (`MAX_DEFAULT_PROMPT_COUNT = 3`, `MAX_DEFAULT_PROMPT_LEN = 128` in `manifest.rs`)

---

### Components to Bundle and Why

#### Skills

A single `skills/remote/SKILL.md` that teaches the model:
- How to check if opencode-pilot is running (`curl localhost:4097/health`)
- How to open the dashboard URL
- How to configure Codex hooks in `~/.codex/config.toml` (or `config.toml` in-project)
- How to use MCP tools exposed by the plugin's MCP server

Skills are discovered by scanning for `SKILL.md` files up to 6 directories deep under the `skills/`
root (`MAX_SCAN_DEPTH = 6` in `core-skills/src/loader.rs`). The skill's namespace in Codex will be
`opencode-pilot:remote` (derived from plugin name + skill directory).

The SKILL.md frontmatter must include at minimum:
```yaml
---
name: "remote"
description: "Manage and open the opencode-pilot remote control dashboard for Codex sessions."
---
```

An optional `agents/openai.yaml` sibling can declare `interface`, `dependencies`, and `policy`
metadata (see `SkillMetadataFile` struct in `core-skills/src/loader.rs`).

#### MCP Server (The Core Mechanism)

The MCP server is the real value-add over a skill-only approach. It exposes callable tools so the
model can actively check pilot state and configure hooks instead of just instructing the user.

The plugin's `.mcp.json` would register an MCP server (stdio transport):

```json
{
  "mcpServers": {
    "opencode-pilot": {
      "command": "node",
      "args": ["path/to/mcp-server.js"],
      "env": {
        "PILOT_URL": "http://localhost:4097",
        "PILOT_TOKEN": ""
      }
    }
  }
}
```

**Proposed MCP tools:**

| Tool | Params | Returns | What it does |
|------|--------|---------|--------------|
| `pilot.status` | none | `{ running: bool, url: string, version: string }` | GETs `localhost:4097/health`; returns whether pilot is live |
| `pilot.open_dashboard` | none | `{ url: string, qr?: string }` | GETs `/connect-info`; returns the dashboard URL the user should open |
| `pilot.list_sessions` | none | `{ sessions: [...] }` | GETs `/sessions`; returns active Codex sessions |
| `pilot.configure_hooks` | `{ config_path?: string, token?: string, port?: number }` | `{ written: bool, path: string, toml_snippet: string }` | Writes the `[hooks]` block to codex `config.toml` with correct `curl` commands |
| `pilot.get_permissions` | none | `{ pending: [...] }` | GETs `/permissions`; returns pending permission requests |
| `pilot.resolve_permission` | `{ id: string, action: "allow" \| "deny" }` | `{ ok: bool }` | POSTs to `/permissions/:id` |

**Relationship to opencode-pilot's HTTP server:**

The MCP server does NOT replace opencode-pilot's HTTP server — it is a thin HTTP client that talks
to it. The MCP server process would be a small Node.js or Python script (bundled in the plugin's
`scripts/` dir) that:

1. Reads `PILOT_URL` and `PILOT_TOKEN` from env
2. Starts as a stdio MCP server (using `@modelcontextprotocol/sdk` or equivalent)
3. Each tool call makes a single `fetch()` to the running opencode-pilot HTTP server
4. Returns results as MCP tool outputs

This design means the MCP server is trivially simple (~100 lines) and the HTTP server does all the
real work.

**Critical constraint**: opencode-pilot MUST already be running when the MCP server's tools are
invoked. If it isn't, tools return a clear error. The plugin has no way to start opencode-pilot
itself — Codex plugins cannot launch long-lived background processes.

#### Apps

Not applicable. The `apps` field in `plugin.json` is for OAuth-based external SaaS connectors
(e.g., Gmail, Linear). opencode-pilot is a local HTTP server, not a SaaS app. Set `apps` to null
or omit it.

#### Hook Configuration

The Codex hook system (in `codex-rs/config/src/hook_config.rs`) reads hooks from:
- `~/.codex/config.toml` or `<repo>/.codex/config.toml` (TOML `[hooks]` block)
- `~/.codex/hooks.json` or `<repo>/.codex/hooks.json` (JSON format)
- `plugin.json` has a `hooks` field pointing to a `hooks.json` inside the plugin directory

**The `plugin.json` `hooks` field is documented in the spec** (`plugin-creator/references/plugin-json-spec.md`
lists `"hooks": "./hooks.json"` as a top-level field), but the manifest struct in
`core-plugins/src/manifest.rs` does NOT include a `hooks` field — only `skills`, `mcp_servers`,
and `apps` are present. This means **plugins cannot auto-configure Codex hooks**. Hook configuration
must be done by the user manually or by the MCP tool `pilot.configure_hooks` writing to config files.

The TOML format for the hooks is:
```toml
[hooks]
  [[hooks.PreToolUse]]
    type = "command"
    command = "curl -s -X POST http://127.0.0.1:4097/codex/hooks/PreToolUse -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d @-"

  [[hooks.PermissionRequest]]
    type = "command"
    command = "curl -s -X POST http://127.0.0.1:4097/codex/hooks/PermissionRequest -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d @-"
```

(Hook handler schema: `HookHandlerConfig::Command { command, timeout_sec, async, status_message }`
in `config/src/hook_config.rs` — `type = "command"` is required.)

The `pilot.configure_hooks` MCP tool is the practical solution: it writes this block to the
appropriate `config.toml` and prints the snippet for review.

### Marketplace Entry

For a personal marketplace at `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "lesquel-personal",
  "interface": {
    "displayName": "lesquel plugins"
  },
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

Or for local dev, with `source: "local"`:
```json
{
  "source": "local",
  "path": "./plugins/opencode-pilot"
}
```

The `source` field supports: `local` (absolute or `./` relative), `url`/`git-subdir` (git clone
with optional `path` subdir, `ref`, `sha`). Git URL shorthand `owner/repo` is also supported
(normalized to `https://github.com/owner/repo.git`).

---

## Three Implementation Paths

### Path A — Lightweight (Skill Only, Manual Hook Config)

Create a plugin with only a `SKILL.md`. The skill tells the model how to check if pilot is running,
how to write the hooks config, and how to open the dashboard URL. No MCP server.

**Pros:** Tiny — the plugin is one Markdown file plus `plugin.json`. Zero runtime dependencies.
Easy to ship inside the existing npm package as a `codex-plugin/` subdirectory.

**Cons:** The model can only instruct the user; it cannot actually check status, write config, or
resolve permissions on its own. The user still has to do all the work. Typing `/remote` would
trigger the skill but the model can't confirm anything is running without a shell command.

**Effort:** 1–2 hours (write SKILL.md + plugin.json + marketplace entry).

---

### Path B — MCP-Based (Skill + MCP Server, Manual or Tool-Assisted Hook Config)

Plugin directory with `plugin.json`, `skills/remote/SKILL.md`, `.mcp.json`, and a
`scripts/mcp-server.mjs` (or `.py`) that implements the 6 tools above. The `pilot.configure_hooks`
tool eliminates manual config edits.

**Pros:** The model can actually check status, get the dashboard URL, list sessions, and resolve
permissions. `/remote` becomes a genuinely useful command. The MCP server is a thin HTTP proxy —
no business logic needed.

**Cons:** Requires a bundled Node.js (or Python) script. The plugin cannot start opencode-pilot
if it isn't running — the user must start it separately. Token management needs a solution
(see Decision 2).

**Effort:** 1–2 sessions (half a day to a day). The MCP server script is ~100–150 lines; the skill
~50 lines of Markdown; `plugin.json` and marketplace entry are mechanical.

**This is the recommended path.**

---

### Path C — Full (Skill + MCP Server + Marketplace Publishing)

Path B plus publishing the plugin as a git-backed marketplace entry on a public GitHub repo, with
auto-update support via `ref: main`. Optionally add a `pilot.start` MCP tool that spawns
opencode-pilot via `bun` if detected, with proper process lifecycle management.

**Pros:** Users can `codex plugin install opencode-pilot` from a curated marketplace. The auto-launch
tool removes the "pilot must be running" constraint for users who have bun installed.

**Cons:** Auto-launch of bun background processes from an MCP server is non-trivial and potentially
fragile (orphan processes, startup race conditions). Publishing requires a separate git repo or
a dedicated `codex-plugin/` subdirectory in the existing repo. The auto-launch implementation
needs careful handling of daemonization.

**Effort:** 2–4 sessions. The MCP server grows by ~50–100 lines for the launcher; marketplace
publishing is mostly documentation.

---

## Architecture Decisions to Flag

### Decision 1 — Where Does the HTTP Server Actually Run?

opencode-pilot is a Bun TypeScript process (`bun run src/server/index.ts`). The Codex plugin
system cannot start it — plugins execute as MCP stdio servers or skills, not long-lived daemons.

Options:
- **(a) Require user to have opencode-pilot running** — simplest; the MCP tool returns a clear
  error if `/health` fails. Document this as a prerequisite.
- **(b) Bundle a binary** — compile opencode-pilot to a single executable with
  `bun build --compile`. The MCP server can then launch it as a background process. Hard: bun
  compile currently has limitations with complex projects; the binary would be large (~50MB).
- **(c) MCP server as a pure proxy** — identical to (a); the MCP server has no launch logic and
  just proxies to the already-running HTTP server.
- **(d) MCP server launches via bun if available** — the `pilot.start` tool checks for `bun` in
  `PATH`, spawns the server detached, writes PID to a lockfile, and waits for `/health` to respond.
  Viable for Path C.

**Recommendation for Path B**: option (a)/(c). Keep it simple. Document the prerequisite clearly.

### Decision 2 — Auth Between Codex Plugin and opencode-pilot

opencode-pilot uses a Bearer token (`PILOT_TOKEN` or `PILOT_HOOK_TOKEN`). The MCP server needs
this token to call the HTTP API.

Options:
- **Env var in `.mcp.json`**: `PILOT_TOKEN` is passed in the MCP server's `env` block. The user
  sets it once in their Codex config (or via `codex config set`). This is the standard MCP
  pattern — same as how other MCP servers handle API keys.
- **Auto-discover from state file**: opencode-pilot writes state to `~/.opencode-pilot/` (see
  `src/core/state/`). The MCP server could read the connect-info state file to get the URL and
  token without requiring user configuration.
- **Prompt on first use**: the `pilot.configure_hooks` skill flow could prompt the user for the
  token and write it to `~/.codex/config.toml` `[env]` section.

**Recommendation**: env var in `.mcp.json`, with a fallback to reading the state file if
`~/.opencode-pilot/` exists. This matches how other Codex MCP servers handle credentials.

### Decision 3 — Distribution Model

Three tiers:
- **Personal marketplace** (`~/.agents/plugins/marketplace.json`): no review process, immediate.
  Best for testing and personal use.
- **Repo marketplace** (`<repo>/.agents/plugins/marketplace.json`): visible to all Codex users in
  that repo. Good for team environments.
- **Official marketplace**: requires submission to OpenAI. Not yet documented as a public process
  in the source code; the curated marketplace name `"openai-curated"` appears in `core-plugins`
  source but there's no public submission process visible.

**Recommendation**: start with a personal marketplace entry pointing to a `codex-plugin/` subfolder
in the existing `open-remote-control` repo. This lets users install via git URL without any official
review.

### Decision 4 — Coupling with the npm Package

Options:
- **Subfolder in the existing repo** (`codex-plugin/` at repo root): the Codex plugin lives
  alongside the npm package. Users who install via OpenCode get the npm package; Codex users
  clone/reference the repo for the plugin. Clean separation — the plugin only contains the MCP
  server script and plugin metadata, not the full opencode-pilot source.
- **Separate repo**: maximum independence. Higher maintenance overhead.
- **Separate npm package** (e.g. `@lesquel/codex-opencode-pilot`): npm distribution doesn't help
  here — Codex plugins are installed via git URL or local path, not npm install.

**Recommendation**: `codex-plugin/` subfolder. The marketplace entry points to it via
`path: "codex-plugin"` in the git source spec.

---

## Effort Estimate (Per Path)

| Path | Estimate | Bottleneck |
|------|----------|-----------|
| A (skill only) | 1–2 hours | Writing a good SKILL.md |
| B (skill + MCP) | 4–8 hours (1 session) | MCP server script + token wiring |
| C (B + auto-launch + publishing) | 1–2 days | Bun auto-launch reliability + marketplace docs |

---

## Open Questions for the Maintainer

1. **Runtime expectation**: Should the plugin work only when opencode-pilot is already running
   (simplest), or should it offer a `pilot.start` MCP tool that tries to spawn it? The latter
   requires bun in PATH and careful daemon management.

2. **Token discovery**: Should the MCP server read the opencode-pilot state file
   (`~/.opencode-pilot/`) to auto-discover the token and URL, or require the user to set
   `PILOT_TOKEN` explicitly in their Codex env? Auto-discovery is more ergonomic but couples the
   MCP server to opencode-pilot's internal file format.

3. **MCP server language**: The MCP server can be Node.js (`.mjs`, uses
   `@modelcontextprotocol/sdk`), Python (`mcp` package), or even a compiled Rust binary. Given
   that opencode-pilot is Bun/TypeScript, Node.js is the natural choice — but it adds a Node
   dependency for Codex users who may not have it. What runtime should be assumed?

4. **Scope of `/remote` experience**: Should `/remote` in Codex simply open a URL (low value) or
   actually show something interactive — like calling `pilot.status` and `pilot.list_sessions` and
   presenting a summary? The latter requires the MCP server to be invoked first.

5. **Hook auto-configuration**: Should `pilot.configure_hooks` write to the user-global
   `~/.codex/config.toml` or the project-local `.codex/config.toml`? The project-local approach
   is safer (doesn't affect other sessions) but requires running from the right directory.

---

## References

### Source Files Read

- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/core-plugins/src/manifest.rs`
  — `PluginManifest`, `PluginManifestPaths`, `PluginManifestInterface`, `load_plugin_manifest()`
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/core-plugins/src/marketplace.rs`
  — `Marketplace`, `MarketplacePlugin`, `MarketplacePluginSource`, `MarketplacePluginInstallPolicy`,
  `MarketplacePluginAuthPolicy`, marketplace JSON layout, git/local source types
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/core-plugins/src/loader.rs`
  — plugin loading, MCP config file resolution (`DEFAULT_MCP_CONFIG_FILE = ".mcp.json"`)
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/utils/plugins/src/plugin_namespace.rs`
  — manifest discovery paths: `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/core-skills/src/loader.rs`
  — skill discovery (`SKILL.md`, `AGENTS_DIR_NAME = ".agents"`, `SKILLS_DIR_NAME = "skills"`,
  `MAX_SCAN_DEPTH = 6`, `SKILLS_METADATA_FILENAME = "openai.yaml"`)
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/core-skills/src/model.rs`
  — `SkillMetadata`, `SkillInterface`, `SkillDependencies`, `SkillPolicy`
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/config/src/hook_config.rs`
  — `HookEventsToml`, `MatcherGroup`, `HookHandlerConfig` (command/prompt/agent), hook event names
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/hooks/src/registry.rs`
  — `HooksConfig`, `Hooks::new()`, hook dispatch model
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/hooks/src/engine/discovery.rs`
  — hook discovery from `hooks.json` and `config.toml` TOML `[hooks]` blocks
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/hooks/src/types.rs`
  — `HookEvent`, `HookPayload`, `HookEventAfterAgent`, `HookEventAfterToolUse`, wire format
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/mcp-server/src/codex_tool_config.rs`
  — `CodexToolCallParam`, `create_tool_for_codex_tool_call_param()`, MCP server tool definition
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/mcp-server/src/lib.rs`
  — MCP server runtime architecture
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/skills/src/assets/samples/imagegen/SKILL.md`
  — reference for real SKILL.md structure and frontmatter format
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/skills/src/assets/samples/plugin-creator/SKILL.md`
  — plugin creation workflow, marketplace conventions
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/codex/codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md`
  — canonical `plugin.json` and `marketplace.json` schemas (field guide)
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/opencode-pilot/src/integrations/codex/index.ts`
  — existing Codex HTTP bridge (route registration)
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/opencode-pilot/src/integrations/codex/handlers.ts`
  — dispatch table for all hook events; `CODEX_DISPATCH`, `PermissionRequest` blocking flow
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/opencode-pilot/docs/CODEX-INTEGRATION.md`
  — existing hook bridge documentation, `config.toml` hook snippet, auth model
- `/mnt/01DC970F199C75A0/Users/lesqu/Documents/proyectos/plugin-opencode/opencode-pilot/package.json`
  — package name `@lesquel/opencode-pilot`, version `1.18.1`

### Key Finding on the `hooks` Field

The `plugin-json-spec.md` documents a `"hooks"` top-level field in `plugin.json`, but
`core-plugins/src/manifest.rs` does NOT parse it — the `RawPluginManifest` struct only has
`skills`, `mcp_servers`, and `apps`. This confirms that **plugins cannot auto-configure Codex
hooks**; that must be done via user-edited `config.toml` or by a MCP tool that writes to it.
