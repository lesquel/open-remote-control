# Installation & Plugin Loading — Deep Dive

This document explains HOW opencode-pilot loads into OpenCode, every trap we hit getting there, and how to recover if your install is broken. If you're just running the plugin, [README.md](../README.md) is enough. Read this if you're debugging an install, contributing, or publishing a new OpenCode plugin yourself.

## TL;DR — the happy path

```bash
npx @lesquel/opencode-pilot@latest init
pkill -f opencode
opencode
# → toast "Remote control plugin loaded" + /remo<Tab> autocompletes
```

If the toast doesn't appear, jump to [Troubleshooting](#troubleshooting).

## OpenCode's plugin architecture — the critical facts

OpenCode 1.14+ has **two plugin subsystems** backed by **two separate config files** and **two separate loaders**. Treating them as one is the fastest way to a broken install.

| Subsystem | Config file | Loader source | Registers |
|-----------|-------------|---------------|-----------|
| **Server** | `opencode.json::plugin` | `packages/opencode/src/plugin/index.ts` | Plugins exporting `server(ctx)` — HTTP servers, hooks, event listeners |
| **TUI** | `tui.json::plugin` | `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts` | Plugins exporting `tui(api)` — slash commands, toasts, sidebar widgets |

Both loaders share the resolution logic in `packages/opencode/src/plugin/shared.ts` and both honor `package.json::exports["./server"]` and `exports["./tui"]` — but they read **different config files**, so a spec in only one gets you half the plugin with zero errors logged.

opencode-pilot ships both:

- `exports["./server"] → "./src/server/index.ts"` — the HTTP+SSE dashboard, banner, settings store
- `exports["./tui"] → "./src/tui/index.ts"` — the slash commands + startup toast

So `init` writes the canonical spec into **both** files:

```json
// ~/.config/opencode/opencode.json
{
  "plugin": ["@lesquel/opencode-pilot@latest"]
}
```

```json
// ~/.config/opencode/tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@lesquel/opencode-pilot@latest"]
}
```

## What `init` actually does

Source: [`src/cli/init.ts`](../src/cli/init.ts).

1. **Locate config dir**. Respects `XDG_CONFIG_HOME`, falls back to `~/.config/opencode` on Linux, `%APPDATA%\opencode` on Windows, `~/Library/Application Support/opencode` on macOS (via XDG honoring).
2. **Install the plugin** with `bun add @lesquel/opencode-pilot@latest @opencode-ai/plugin@latest`. The SDK is pinned to `@latest` because OpenCode releases new SDK versions weekly and stale SDKs silently break TUI loading.
3. **Delete stale wrappers** from `<configDir>/plugins/`. Specifically `opencode-pilot.ts` and `opencode-pilot-tui.ts`, left by 1.11.x–1.12.x installs. See [Gotcha #2](#gotcha-2-wrappers-are-server-only).
4. **Invalidate OpenCode's package cache** for any `<cacheDir>/@lesquel/opencode-pilot*` entry. See [Gotcha #3](#gotcha-3-cache-key-includes-the-spec-suffix).
5. **Write `opencode.json`** (creates if missing) with a single canonical entry `"@lesquel/opencode-pilot@latest"`, stripping any stale subpath/pinned variants.
6. **Write `tui.json`** (creates if missing) with the same canonical entry, plus the `$schema` field for editor autocomplete.

All five cleanup/write steps are idempotent — re-running `init` is safe and is the correct fix for most broken states.

## Gotchas that cost us many hours

### Gotcha 1: `pkg/subpath` specs don't resolve as exports sub-paths

OpenCode uses [`npm-package-arg`](https://github.com/npm/npm-package-arg) to parse specs in `plugin` arrays. That parser treats `@lesquel/opencode-pilot/tui` as if `tui` were part of a package name. OpenCode then tries to install it at `~/.cache/opencode/packages/@lesquel/opencode-pilot/tui/` and fails with:

```
ENOENT: no such file or directory, open '<cache>/@lesquel/opencode-pilot/tui/node_modules/@lesquel/opencode-pilot/package.json'
failed to resolve plugin server entry
```

**Rule**: never put `pkg/sub-path` strings in `plugin` arrays. Use a single `pkg@spec` and rely on `package.json::exports` to split kinds.

### Gotcha 2: wrappers are server-only

`<configDir>/plugins/*.ts` files are **always loaded as server plugins**. The loader at `src/plugin/index.ts` calls `readV1Plugin(mod, spec, "server", "detect")` — strict-server mode in disguise. A wrapper re-exporting a TUI module (`{ id, tui }`) is rejected with:

```
Plugin file:///.../plugins/opencode-pilot-tui.ts
must default export an object with server()
```

And if you ALSO have the npm spec in `opencode.json::plugin`, the server wrapper double-loads and you get:

```
Failed to start server. Is port 4097 in use?
```

**Rule**: don't drop wrapper files in `<configDir>/plugins/`. Use the npm spec in `opencode.json` and `tui.json` and let the package's `exports` map route the kinds. `init` deletes legacy wrappers automatically.

### Gotcha 3: cache key includes the spec suffix

OpenCode caches npm plugins in `<cacheDir>/<package-name>`**`<spec-suffix>`**. So `@lesquel/opencode-pilot@latest` is cached at `<cacheDir>/@lesquel/opencode-pilot@latest/`, NOT `<cacheDir>/@lesquel/opencode-pilot/`. Cleaning only the suffix-less path leaves the stale copy intact and OpenCode keeps serving it even after `bun add @latest` updated `node_modules`.

**Rule**: to invalidate our cache entry, enumerate `<cacheDir>/@lesquel/` and remove any entry whose name starts with `opencode-pilot`. `init` does this.

### Gotcha 4: the upstream `opencode/` dev hook injects `package.json` pollution

When you run OpenCode in dev mode from a workspace that also contains `opencode-pilot/`, the upstream repo's husky hook silently modifies our `package.json`:

- Adds `"@lesquel/opencode-pilot": "^<version>"` as a **self-reference** in `dependencies`.
- Pins `@opencode-ai/plugin` to the locally-installed version (e.g. `^1.14.18`) instead of `latest`.

If you `npm publish` without noticing, the published package has a circular self-dep (`npm install` loops or errors) and locks users to a specific SDK version.

**Defense**: `scripts/prepublish-guard.ts` runs as `prepublishOnly` and fails publish if either pollution is present. Fix `package.json` by hand before re-running publish.

### Gotcha 5: TUI has no error path for "missing config"

If your spec is only in `opencode.json` (not `tui.json`), the TUI loader never receives it, never logs anything about it, and never errors. The server loads, the banner prints — but no slash commands appear. There's no log line saying "pilot TUI not found" because the TUI loader iterates its own (empty-of-pilot) list.

**Canary**: the TUI plugin shows a toast on successful init — `"OpenCode Pilot — Remote control plugin loaded. Use /pilot or /pilot-token."`. Use the toast as your indicator that TUI registration succeeded. Absence of toast + presence of banner = `tui.json` missing the spec.

## Troubleshooting

### Slash commands `/remote`, `/dashboard`, etc. don't autocomplete

```bash
# 1. Re-run init — it covers most broken states.
npx @lesquel/opencode-pilot@latest init

# 2. Fully quit OpenCode. The plugin loader is per-process, not per-session.
pkill -f opencode

# 3. Reopen from any project.
opencode
```

If the toast still doesn't appear:

```bash
# 4. Check the latest log.
tail -200 $(ls -t ~/.local/share/opencode/log/*.log | head -1) | grep -iE "pilot|tui.plugin|error"
```

Look for:

- `service=plugin path=@lesquel/opencode-pilot@latest loading plugin` — server loader sees the spec ✓
- `service=tui.plugin ... loading tui plugin` — TUI loader sees the spec ✓ (should exist for the pilot, not just `internal:*`)
- `service=opencode-pilot ... Remote control active on 127.0.0.1:4097` — server booted ✓
- `ERROR ... failed to resolve plugin server entry` — check which spec failed
- `ERROR ... must default export an object with server()` — stale wrapper in `<configDir>/plugins/`

If you don't see `loading tui plugin` for the pilot, open `~/.config/opencode/tui.json` and verify:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@lesquel/opencode-pilot@latest"]
}
```

### Dashboard loads but `/settings`, `/events`, etc. return 401

Token rotates on every server start. Hard-reload the browser and re-scan the QR (or re-open the URL from the fresh banner).

### Port 4097 already in use

```
ERROR ... Failed to start server. Is port 4097 in use?
```

Something is still running on 4097 (a previous OpenCode session that didn't fully exit, or another app). Options:

```bash
pkill -f opencode          # kill any stragglers
lsof -iTCP:4097 -sTCP:LISTEN   # find what owns it
```

Or change the port from the Settings panel (gear icon → Server → Port) or via `PILOT_PORT` in `~/.opencode-pilot/config.json`.

## For plugin authors — replicating our shape

If you're writing your own OpenCode plugin that needs **both** a server and a TUI module:

1. In `package.json`, declare the exports map:
   ```json
   "exports": {
     "./server": "./src/server/index.ts",
     "./tui": "./src/tui/index.ts"
   },
   "main": "./src/server/index.ts"
   ```
2. Give each module a **distinct `id`** — `foo` for the server, `foo-tui` for the TUI. Sharing an id causes silent overwrites in older OpenCode versions.
3. In the user's install, your spec must appear in **both** `opencode.json::plugin` AND `tui.json::plugin`. Provide an `init` CLI that does this automatically.
4. Ship a `prepublishOnly` guard against self-reference pollution if you develop from inside the upstream `opencode/` monorepo.
5. Add a startup toast so users have a canary for TUI registration.
