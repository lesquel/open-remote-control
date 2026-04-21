# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.13.13] — 2026-04-21

### Fixed — `pilot-state.json` silently missing when server is up ([#1](https://github.com/lesquel/open-remote-control/issues/1))

**The report**

@Marcwos reported that OpenCode was listening on port 4097 but `/remote`, `/remote-control`, and `/pilot-token` all surfaced "Remote control server not running or token not yet available". No `pilot-state.json` existed at either `.opencode/pilot-state.json` or `~/.opencode-pilot/pilot-state.json`. The user had a fully-functional pilot server but zero way for the TUI to find it — a totally invisible failure.

**Root causes (four paths led to the same symptom)**

1. **Stale package cache after `bunx init` while OpenCode was running.** The v1.13.11 init script refuses to invalidate `~/.cache/opencode/packages/@lesquel/opencode-pilot@latest/` while any `opencode` process is alive (because the live plugin reads dashboard assets from that same cache). The skip was printed as a single `console.log` line that users missed. OpenCode kept loading the previously-installed version, which — if old enough — only wrote the project-scoped `.opencode/pilot-state.json` and silently failed on workspaces like `~/Desktop` that have no `.opencode/` folder.

2. **`writeState` swallowed every I/O error.** `safeWrite()` wrapped `mkdirSync` + `writeFileSync` in a naked `try {} catch {}` that returned `false` and dropped the error on the floor. A user with an unwritable `~/.opencode-pilot/` (permissions, quotas, read-only FS, overlay weirdness) saw zero evidence of the problem — not in OpenCode's log panel, not in stderr, nowhere.

3. **`projectStatePath(directory)` could crash the whole dual write.** `writeState` called `join(directory, ".opencode", "pilot-state.json")` **before** wrapping the call in `safeWrite`. If a future OpenCode SDK change ever passes `ctx.directory` as `undefined` or `null`, `join()` throws `TypeError` out of `writeState`, which takes `activatePrimary` with it — and the global-path write that was supposed to be the fallback never runs.

4. **Passive-mode / non-pilot-owner of port 4097 was indistinguishable from "plugin not loaded".** The TUI reported the same toast in all three scenarios.

**The fix — defensive on all four paths**

1. **`src/cli/init.ts` — loud banner + nonzero exit when cache invalidation is skipped.** Previously the skip was a two-line `console.log`. Now it's a red ANSI banner with a 3-step remediation checklist, printed as the last thing on screen, followed by `process.exit(2)`. CI scripts, shell pipelines, and even humans skimming the output cannot miss it.

2. **`src/server/services/state.ts` — `writeState` now returns `WriteStateResult`.** Each path (`project`, `global`) reports `{ path, ok, error? }` so callers can log partial failures. The internal `safeWrite` helper is replaced by `writeOne`, which still tries `mkdir -p` + `writeFileSync`, but captures the error message into the outcome instead of discarding it.

3. **`src/server/index.ts` — `activatePrimary` surfaces write failures via `ctx.client.app.log`.** If the global write fails, an `ERROR` level log appears in OpenCode's log panel explaining exactly which path failed, the underlying error, and how to remediate. If the global write reports `ok` but `existsSync` says the file is missing (exotic FS case), that's also logged. Project-scoped failures are logged at `WARN` — not critical because the TUI reads the global path as of 1.13.x, but useful for debugging.

4. **`src/tui/liveness.ts` — new `probeHealth(host, port)` helper.** Returns `{kind: "pilot" | "other" | "none", ...}`. The `"pilot"` case is keyed on our specific `/health` JSON shape (`{status, version, services.sdk}`) so a random HTTP service on port 4097 doesn't pass as us.

5. **`src/tui/index.ts` — all three slash commands call `diagnoseAndToast` when no state file is found.** Each of the three probe outcomes gets a distinct, actionable message:

   - `pilot` — "Server is responding but state file is missing — this is a cache/permissions problem, run these 4 commands".
   - `other` — "Something is listening on :4097 but it isn't us, identify with `ss -tulpn` and either stop it or set `PILOT_PORT`".
   - `none` — "Nothing is listening and no state file exists — check the plugin is in `opencode.json` and restart OpenCode".

**Isolation of `projectStatePath` failures**

The `projectStatePath(directory)` call is now wrapped in its own `try/catch` inside `writeState`. If `join()` throws for any reason, the catch records `{path: "<invalid-directory>", ok: false, error}` for the project outcome and **the global write still runs unconditionally**. The TUI's canonical state path is the global one, so this guarantees the slash commands keep working even if `ctx.directory` is temporarily garbage.

**Regression tests**

`src/server/services/state.test.ts` now covers:

- `writeState` returns both outcomes populated when the directory is valid.
- `writeState(null, ...)` returns `project.ok === false` **and** still writes the global path successfully.
- When `.opencode` is blocked by a regular file at the expected location, the project outcome reports `ok: false` with a real error message, and the global write still succeeds.
- `globalStatePath()` stays anchored to `homedir()` / `.opencode-pilot/pilot-state.json` — a drift would silently break the TUI's cross-module contract.

**User-visible output (example of the new init banner)**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  !! CONFIG WRITTEN — BUT PLUGIN CACHE NOT REFRESHED !!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  OpenCode is currently running. The plugin package cache under
  ~/.cache/opencode/packages/ was NOT invalidated — OpenCode will
  keep loading the previously-installed version until you flush it.

  Required steps:

    1. Quit every OpenCode window / session:
         pkill -f opencode     # Linux / macOS
         (or close every terminal window running opencode)

    2. Re-run this installer so cache invalidation succeeds:
         bunx @lesquel/opencode-pilot@latest init

    3. Reopen OpenCode.

  Exiting with code 2 so CI/scripts notice this is NOT a success.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## [1.13.12] — 2026-04-20

### Added — dashboard auto-focuses the current project tab when opened via `/remote`

**The problem**

A developer working in `/path/to/projectA` runs `/remote` from OpenCode. The dashboard opens in the browser — but it shows whichever project tab was last active (or the default tab), not `projectA`. With multiple projects open as separate tabs the user had to manually click the right tab every time. If `projectA` had never been opened in the dashboard before, it was not even listed.

**The fix — `#dir=` hash fragment**

The TUI `/remote` command (and its aliases `/dashboard`, `/remote-control`) now appends the current working directory to the dashboard URL as a hash fragment:

```
Before: http://127.0.0.1:4097/?token=abc
After:  http://127.0.0.1:4097/?token=abc#dir=%2Fpath%2Fto%2FprojectA
```

A hash fragment was chosen over a query string deliberately:

- Hash fragments are client-only: they are never sent to the server and survive HTTP redirects without being stripped. Tunnel providers (cloudflared, ngrok) that proxy the dashboard URL occasionally mangle or log query strings; hash fragments are opaque to them.
- Adding a query param creates a browser history entry; a hash change does not, keeping the back-button behaviour clean.
- The server-side `?directory=` query param (already used by per-project API endpoints) is a different concern — it routes API calls to the right OpenCode instance. The `#dir=` fragment is purely a client-side tab-focus hint.

**Dashboard boot hook (v1.13.12 addition in `main.js`)**

After `restoreTabsFromStorage()` hydrates the tab strip from localStorage, the boot sequence now calls `applyDirHash()`:

```js
// 3.6 Auto-focus project tab from #dir= hash fragment
const parsed = resolveDirFromHash(location.hash)   // parse + validate
if (parsed.ok) {
  const tabs = getProjectTabs()
  const action = resolveTabAction(parsed.dir, tabs) // find or create
  if (action.action === 'activate') {
    ptSwitchProjectTab(action.tabId)                // focus existing tab
  } else {
    ptAddProjectTab(action.dir, action.label)       // create + focus new tab
  }
  history.replaceState(null, '', location.pathname + location.search)
}
```

Key properties:
- Runs **after** `restoreTabsFromStorage()` so a tab that already exists in LS is found by `resolveTabAction` and focused rather than duplicated.
- Runs **before** `loadSessions()` so `state.activeDirectory` is set correctly for the very first API fetch.
- The hash is erased via `history.replaceState` so a page refresh doesn't re-trigger the logic with stale state.
- Any error in hash parsing is silently swallowed — the dashboard always finishes booting normally.

**Server-side validation in `hash-dir-router.js`**

`resolveDirFromHash` rejects:
- Empty or whitespace-only paths
- Paths containing `..` (path traversal)
- Paths containing null bytes
- Paths longer than 512 characters
- Malformed percent-encoding sequences

**New pure helpers**

| File | Exported symbol | Purpose |
|------|-----------------|---------|
| `src/tui/url-builder.ts` | `buildDashboardUrl(baseUrl, cwd)` | Append `#dir=<encoded>` to dashboard URL |
| `src/server/dashboard/hash-dir-router.js` | `resolveDirFromHash(hash)` | Parse and validate the fragment |
| `src/server/dashboard/hash-dir-router.js` | `resolveTabAction(dir, tabs)` | Decide activate vs. create |

---

## [1.13.11] — 2026-04-20

### Fixed — stale state file after crash and 5-second promotion gap in `/remote`

**Bug 1 — stale state file (SIGKILL / crash)**

If the primary pilot process died via `SIGKILL` or a hard crash, `clearState()` never ran. The state file at `~/.opencode-pilot/pilot-state.json` kept pointing at a dead PID. All three TUI commands (`/remote`, `/remote-control`, `/pilot-token`) called `readPilotState()` and trusted the result unconditionally — so `/remote` opened the browser to a dead URL with zero feedback to the user.

The fix adds a `isServerAlive(state)` helper in `src/tui/liveness.ts`:

```ts
// Same-host case: process.kill(pid, 0) throws ESRCH if the PID is dead.
// EPERM means the process exists but we don't own it → treat as alive.
// No pid field (older state files, remote-host case): HTTP HEAD /health with 500ms timeout.
export async function isServerAlive(state: PilotState): Promise<boolean>
```

All three slash commands call `isServerAlive` before doing anything with the state. If it returns `false`, they show a clear message and return:

```
"Pilot server not running — start OpenCode again or wait for another instance to take over."
```

`writeState()` already wrote `pid: process.pid` (introduced in 1.13.8 alongside the promotion watcher). The `PilotState` type in `src/tui/index.ts` now marks `pid` as optional (`pid?: number`) so older state files still work via the HTTP fallback path.

**Bug 2 — 5-second promotion gap**

After the primary's `clearState()` ran on a clean shutdown, the passive's promotion watcher took up to 5,000 ms to notice the port was free and write new state. During that window `/remote` showed "not running" even though another window was ready to take over within milliseconds.

Fixed by dropping the poll interval from `5000` to `500` ms — see the "Changed" entry below.

### Fixed — hardcoded `PILOT_VERSION` in dashboard JS

The 1.13.10 release note said hardcoded version strings were "structurally impossible". They weren't — the sanity guard in `asset-sanity.test.ts` only checked `src/server/constants.ts`, not dashboard JS files. Both `src/server/dashboard/right-panel.js` and `src/server/dashboard/debug-modal.js` still carried:

```js
const PILOT_VERSION = '1.12.8'
```

Which means the right-panel instance badge and the debug-modal's `pilot_version` field both lied after any version bump.

**Fix**: removed the module-level constant from both files. Both now read the version from the `/health` endpoint at runtime:

- `right-panel.js`: `fetchVersion()` (already called on init to fetch `_instanceVersion`) now also populates `_pilotVersion` from `health.version`. Before the fetch resolves, the UI renders `v-` as a placeholder.
- `debug-modal.js`: `buildReport()` calls `fetchHealth()` on first open and caches the result in `_cachedPilotVersion`.

A new sanity test was added:

```ts
// src/server/dashboard/__tests__/asset-sanity.test.ts
test("no dashboard JS file contains a hardcoded PILOT_VERSION string literal", () => {
  // Scans every *.js under src/server/dashboard/ and fails if any contains:
  //   PILOT_VERSION = '...' or PILOT_VERSION = "..."
})
```

This closes the gap permanently — any future regression in any dashboard JS file is caught before publish.

### Changed — passive promotion poll interval: 5000 ms → 500 ms

```diff
-  }, 5000)
+  }, 500)
```

In `src/server/index.ts` — `startPromotionWatcher()`. The `server.start()` probe is a cheap no-op (no side effects when the port is still taken). Reducing the interval from 5 s to 500 ms means after a clean primary shutdown, the surviving passive window promotes itself and writes fresh state in under a second. `/remote` on the promoted window is usable within ~1 s of the primary closing.

---

## [1.13.10] — 2026-04-20

### Added — regression guards that block any broken publish

Six sanity tests in `src/server/dashboard/__tests__/asset-sanity.test.ts` that `bun test` now runs by default. Any of these failing aborts the publish:

1. `index.html` **must not** reference highlight.js CommonJS `/lib/core.min.js` / `/lib/languages/*.min.js` (the `module is not defined` bug that rode from 1.11.x through 1.13.8 because a fix claimed in the CHANGELOG never landed in the file).
2. `index.html` **must** load `/build/highlight.min.js` (the UMD bundle).
3. `index.html` **must** contain the self-heal cleanup script (`pilot:asset-gen`, `getRegistrations`, `caches.keys`) so returning users on any pre-1.13.9 install get flushed automatically on first load.
4. The self-heal `GEN` marker **must** match `package.json::version`. If you bump the package version but forget to bump the marker, the self-heal won't fire and users stay stuck on the old bundle.
5. `sw.js` **must** use `CACHE_NAME = "pilot-vNN"` — the `activate` handler depends on this shape to evict previous precaches.
6. `src/server/constants.ts::PILOT_VERSION` **must** match `package.json::version`. PILOT_VERSION was hardcoded at `1.12.8` through 1.13.5 because nobody bumped it in sync; the dashboard's `/health` response and right-panel label lied about what the user was running, making bug reports confusing.

### Changed — `prepublishOnly` now runs guard + typecheck + full test suite

```json
"prepublishOnly": "bun scripts/prepublish-guard.ts && tsc --noEmit && bun test"
```

Before, only the self-ref/SDK guard ran. Now `npm publish` aborts if:

- A self-reference or pinned SDK was silently re-injected into `package.json` by an upstream hook.
- `tsc --noEmit` reports any type error.
- Any of the 187 tests fails — including the six regression guards above.

No broken release reaches npm. The "CHANGELOG said fixed but the edit never landed" class of bug is structurally impossible from this point forward.

---

## [1.13.9] — 2026-04-20

### Fixed — `Uncaught ReferenceError: module is not defined` on dashboard load (highlight.js CommonJS)

The dashboard's `index.html` loaded nine scripts from `highlight.js@11.10.0/lib/*` — `lib/core.min.js` + eight `lib/languages/*.min.js`. Those files are the **CommonJS internals** shipped for bundlers (webpack, vite, etc.) and contain literal `module.exports` references + redeclared `const` bindings. Loading them directly via `<script>` tags in a browser throws:

```
Uncaught ReferenceError: module is not defined   (core.js:2595)
Uncaught SyntaxError: redeclaration of const IDENT_RE
Uncaught ReferenceError: module is not defined   (python.js, go.js, rust.js, …)
```

…and the dashboard fails to render any code highlighting. The v1.12.6 CHANGELOG claimed this was already fixed — it wasn't. The original patch landed in the CHANGELOG but the actual `<script>` tags in `src/server/dashboard/index.html` never changed. The bug silently rode through every release up to and including 1.13.8.

**Fix**: replace the nine `lib/*.min.js` scripts with a **single `/build/highlight.min.js`** — the proper UMD bundle that exposes `hljs` globally and includes ~190 languages. One network request, no errors, syntax highlighting works everywhere.

```html
<!-- before -->
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/core.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/languages/typescript.min.js"></script>
… (7 more)

<!-- after -->
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/build/highlight.min.js"></script>
```

### Also — defense in depth so this never happens again to any user

1.13.1 and earlier registered a cache-first service worker that pinned stale JS in users' browsers for weeks. Bumping `CACHE_NAME` flushed it, but the FIRST load after an upgrade still served the old bundle because the new `sw.js` hadn't activated yet. Not good enough when the old bundle blows up on page load.

Three additional safeguards in 1.13.9:

1. **Self-healing cache cleanup in `index.html`**. The very first `<script>` in the `<head>` reads `localStorage["pilot:asset-gen"]` and compares it to the plugin generation baked into the HTML ("1.13.9"). On mismatch — i.e. first load after an upgrade — it calls `navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))`, wipes every `caches.keys()` entry, sets the flag, and triggers a single reload. The second load lands SW-free on a fresh bundle. One 50ms flash instead of "dashboard is broken, please Ctrl+Shift+R".
2. **`Cache-Control: no-cache, must-revalidate`** on every dashboard asset (`index.html`, `*.js`, `*.css`, `*.json`, icons). `no-cache` doesn't mean "don't cache" — it means "revalidate with the origin before using". Browsers still get to 304-cache, but they round-trip to the server, so a new version is picked up on the very next refresh instead of weeks later.
3. **`CACHE_NAME` bumped to `pilot-v21`**. Any leftover `pilot-v18`/`pilot-v20` precache on returning users gets evicted by the service worker's `activate` handler.

Combined, a returning user on 1.13.1 (cache-first, `pilot-v18`) who upgrades to 1.13.9 sees at most one forced reload on the first dashboard load — after that, zero residual staleness.

### Manual escape hatch (only if the self-heal script didn't run)

Self-heal only runs if the HTML itself gets to the browser. If your existing SW is so aggressive it's still serving the PRE-1.13.9 `index.html` from cache, you can force a one-time clean manually:

- Firefox: `about:serviceworkers` → find `127.0.0.1:4097` → **Unregister** → `Ctrl+Shift+R`.
- Chrome: DevTools → Application → Service Workers → **Unregister** → `Ctrl+Shift+R`.

Or open the dashboard URL in a private/incognito window once — that browser context has no SW and will fetch the 1.13.9 HTML, run the self-heal, and then your normal window is clean on next visit.

### Cosmetic

- `PILOT_VERSION` bumped to `1.13.9`.

---

## [1.13.8] — 2026-04-20

### Fixed — Passive instances now auto-promote when the primary closes

1.13.7 introduced passive mode so a second OpenCode window wouldn't fail on `EADDRINUSE`. But if you closed the **primary** window, the surviving passive window stayed passive forever — `/remote` still read the stale global state file (or nothing after the primary's `clearState` ran on shutdown), and you couldn't open the dashboard from the remaining terminal without quitting it and reopening.

Also, closing the primary window sometimes left the tunnel child process (cloudflared / ngrok) holding sockets open for a beat, producing a "reconnecting…" blink in the dashboard before the browser even realized the server was gone.

Two fixes:

1. **Auto-promotion watcher**. A passive instance now polls `server.start()` every 5s. `start()` is a cheap no-op when the port is taken and returns `{ ok: true }` the moment the primary releases it. On that first successful bind, the passive instance runs the same `activatePrimary(true)` flow the boot path uses — writes state, writes banner, starts the tunnel, emits the Telegram startup notification, sets `deps.tunnelUrl`. The user sees a toast: **"OpenCode Pilot — promoted. Previous primary window closed. This window now hosts the dashboard on port 4097."** `/remote` works immediately after.
2. **Tunnel child dies deterministically**. `tunnel.stop()` used to fire `proc.kill()` and return. Now it fires SIGTERM, sets a 400ms fuse, and escalates to SIGKILL if the child is still alive. The `onDead` callback runs on `exit`/`close`, so `_tunnelInfo` flips to `off` synchronously. No more zombie cloudflared hanging on for seconds after the primary window closed.

Refactor inside `src/server/index.ts`: extracted the primary-specific setup into `activatePrimary(isPromotion)`. Shutdown reads `role` at the moment it runs rather than at boot, so a promoted instance cleanly tears down its server/tunnel/state. `clearState` only runs when `role === "primary"` at shutdown time — never from a passive window.

### Upgrading

```bash
pkill -f opencode
npx @lesquel/opencode-pilot@latest init
# Terminal A — primary
cd /some/project && opencode
# Terminal B — passive (polls every 5s)
cd /other/project && opencode
# Close terminal A's window. Within 5s terminal B auto-promotes;
# you'll see the "promoted" toast and `/remote` opens the dashboard.
```

### Cosmetic

- `PILOT_VERSION` bumped to `1.13.8`.

---

## [1.13.7] — 2026-04-20

### Fixed — Opening OpenCode in a second terminal failed with "Port 4097 in use"

When you had one OpenCode window already open and launched a second one from a different terminal (different workspace), the second instance tried to claim port 4097 and failed. Error surfaced as `Failed to start server. Is port 4097 in use?` in the log, plus a toast, plus a refusal to load the plugin. The second OpenCode window essentially ran without the pilot, and closing the first window didn't automatically promote the second one either.

**Passive mode**: the plugin now detects `EADDRINUSE` at bind time and, instead of propagating the error, silently enters "passive mode" for that workspace:

- The HTTP server, tunnel, telegram startup, banner write, state write, and the success toast are all **skipped**. The primary instance already owns those.
- All four plugin hooks (`event`, `permission.ask`, `tool.execute.before`, `tool.execute.after`) still get registered locally, so OpenCode itself behaves normally — tool calls work, permission flows work, etc.
- An **informational toast** tells the user: "OpenCode Pilot — passive mode. Port 4097 already in use by another OpenCode window. Open the existing dashboard to manage this workspace." The primary dashboard already has multi-project tabs, so the new workspace is reachable from there as soon as its SDK instance is live.
- `clearState` is NOT called on shutdown in passive mode — the global state file belongs to the primary window, and deleting it would blind every other pilot TUI/dashboard on the machine.
- Audit log records `boot.passive` with the reason so you can grep for it.

If the primary instance exits first, any window that starts afterwards binds normally and becomes the new primary. No coordination required.

### Cosmetic

- `PILOT_VERSION` in `src/server/constants.ts` bumped to `1.13.7`.

---

## [1.13.6] — 2026-04-20

### Fixed — Streaming still wasn't visible: intermediate `message.updated` events wiped the transcript mid-turn

After the 1.13.2–1.13.4 fixes (listening to `message.part.delta`, optimistic UI, on-the-fly surfaces, tool hot-swap, service worker rotation, in-memory asset cache), streaming still required a page reload to show the assistant's reply. A sub-agent traced the bug end-to-end: curl on `/events` PROVED deltas were flowing out the SSE stream (9+ delta events captured with correct `{sessionID, messageID, partID, field:"text", delta}`). The bug lived in the frontend.

**Root cause**: the SDK emits `message.updated` **several times per turn**, not just at the end — user-confirm, assistant-init, one or more assistant-intermediate, and assistant-final. The `sse.js` handler treated every `message.updated` the same way: `loadMessages(activeSession)` → `renderMessages` → `box.innerHTML = msgs.map(renderMsg).join('')`. That wipe erased every streaming text node `applyStreamingDelta` had been appending since the previous update, so the typewriter got reset on every intermediate — visually indistinguishable from "nothing happens until the end".

Two sub-bugs:

1. The code branched on `MESSAGE_CREATED` expecting the SDK to emit it. Checked `packages/opencode/src/session/message-v2.ts`: only `Updated`, `PartUpdated`, `PartDelta`, `PartRemoved` are defined — **no `Created`**. Our `MESSAGE_CREATED` branch was dead code. The subscription stays for forward-compat but will never fire today.

2. The final-update detector used `d?.id ?? d?.messageId ?? ev.properties?.id`. Since `d = ev.data ?? ev` and `ev.data` doesn't exist, `d = ev`, and `ev.id` is undefined — the real id lives at `ev.properties.info.id`. So `clearStreamingMessage` and `removeStreamingCursor` silently did nothing.

**Fix** (`src/server/dashboard/sse.js`):

- Detect "final" via `info.time.completed` (or `info.finish`, depending on SDK shape). Only run `loadMessages` on a **final assistant** `message.updated` — which is when we genuinely want to re-render with final markdown, tool blocks, agent badges, etc.
- For **intermediate** assistant updates: leave the DOM alone. `ensureTextPartSurface` + `applyStreamingDelta` + `replacePartInDom` already handle the incremental render.
- For **user** `message.updated`: reconcile the optimistic bubble with the real id if the optimistic node exists, otherwise `loadMessages` once (first-time case from another device).
- Sound / browser notification / session-meta refresh / label-strip refresh: all gated to the final update too.
- Properly read the id from `ev.properties.info.id`.

### Hard-refresh caveat

With `CACHE_NAME = "pilot-v20"` and stale-while-revalidate, the **first** reload after upgrade still serves the OLD `sse.js` from SW cache while fetching the new one in background. A **second** reload (or `Ctrl+Shift+R`) picks up the 1.13.6 streaming logic. The alternative — bumping the cache name to flush eagerly — would drop other in-flight SW state. If users still don't see streaming after `npx init`, tell them: close every tab, reopen the dashboard URL fresh.

### Cosmetic

- `PILOT_VERSION` in `src/server/constants.ts` was hard-coded at `1.12.8` and bumped through every release. Now set to `1.13.6`. Dashboard `/health` and right-panel will show the correct version.

---

## [1.13.5] — 2026-04-20

### Fixed — "Remote control server not running or token not yet available" on fresh workspaces (e.g. `~/Desktop`)

When another user tried the plugin from `~/Desktop` (or any folder without an `.opencode/` subdirectory), the TUI toast kept reporting the server as offline even when the dashboard was live and reachable. Root cause was a pair of matching bugs:

1. **Server silently failed to write state**. `writeState` called `writeFileSync(join(directory, ".opencode", "pilot-state.json"))` without creating the `.opencode/` folder first. On a workspace that didn't already have that folder, the call threw `ENOENT`, the error bubbled out of the plugin boot, and the state file never got written. The banner writer had a try/catch around the same mistake, so the banner swallowed silently and the state write took down the boot.
2. **TUI looked in the wrong place**. The `/pilot`, `/pilot-token`, `/remote-control` commands read from `join(process.cwd(), ".opencode", "pilot-state.json")`. `process.cwd()` in the TUI plugin isn't guaranteed to match the server plugin's `ctx.directory`, so even when the state file was written correctly, the TUI often couldn't find it.

Fixes:

- `writeState` / `writeBanner` now `mkdirSync(..., { recursive: true })` before writing and catch any remaining errors (read-only FS, permission denied, etc.) instead of propagating. The server boot can no longer be taken down by a failed state write.
- Both files are now **dual-written**: the per-project `.opencode/pilot-state.json` (kept for tooling that knows the workspace) PLUS a **canonical global file** at `~/.opencode-pilot/pilot-state.json` (and `pilot-banner.txt`). Since the HTTP server binds to a single port machine-wide, at most one server is live at any moment, so a single global file is sufficient.
- TUI `readPilotState` / `readBanner` now try the project path first and fall back to the global path. So `/pilot` works from any workspace, including bare folders like `~/Desktop`.
- `clearState` cleans both paths on shutdown.

### Upgrading

```bash
pkill -f opencode
npx @lesquel/opencode-pilot@latest init
opencode
```

From any workspace — no `.opencode/` folder required — `/pilot` and `/remote-control` should now surface the live dashboard URL, token, and QR.

---

## [1.13.4] — 2026-04-20

### Fixed — `npx init` broke the dashboard when OpenCode was running

`init` in 1.13.3 aggressively wiped `~/.cache/opencode/packages/@lesquel/opencode-pilot*` to force a fresh download of the plugin on the next OpenCode launch. Correct in principle — but if OpenCode was **already running** when you re-ran `init`, the live plugin lost the directory it was serving dashboard files from. Every subsequent request for `/sw.js`, `/sse.js`, `/main.js`, etc. returned 404. The browser kept running whatever JS it had previously cached, and the 1.13.3 SW rotation never took effect.

Two fixes:

1. **`init` now detects a running OpenCode process** (`pgrep -f opencode` on Unix, `tasklist` on Windows) and **refuses to wipe the cache** while OpenCode is alive. It prints a clear warning telling you to quit OpenCode first and re-run. The install/config steps still run — only the destructive cache cleanup is skipped.

2. **The plugin snapshots the dashboard into memory at boot** (`src/server/http/handlers.ts`). Prior versions read each file from disk on every request, so anything that deleted the plugin's cache directory mid-flight left the dashboard serving 404s until restart. Now every `.js`/`.css`/`.html`/`.svg` under `DASHBOARD_DIR` is loaded into an in-memory map the first time the dashboard is hit, and served from memory afterwards. Dev mode (`PILOT_DEV=true`) still re-reads from disk so live edits show up without a plugin restart.

### How to recover if you're already stuck

The 1.13.3 dashboard is serving 404s for static assets because its cache was deleted. To recover:

```bash
pkill -f opencode                                   # fully stop OpenCode
npx @lesquel/opencode-pilot@latest init             # reinstalls fresh (cache is re-populated on next launch)
opencode                                            # start it back up
# Then in the browser: Ctrl+Shift+R to force-fetch the new sw.js
```

---

## [1.13.3] — 2026-04-20

### Fixed — Service worker kept serving the old frontend bundle after upgrade

1.13.2 shipped a complete SSE/streaming rewrite (typewriter via `message.part.delta`, optimistic user messages, on-the-fly part surfaces, tool hot-swap) — all correct on disk. But **the dashboard still didn't stream** after upgrading, because the service worker was serving the 1.12.x JS from cache.

Two issues in the old `sw.js`:

1. **Cache name hadn't bumped**. `CACHE_NAME = "pilot-v18"` was set back in 1.12.x and never bumped, so the `activate` handler never flushed the stale precache. Browsers kept loading the 1.12.x `sse.js` with the old event subscriptions even though `~/.config/opencode/node_modules/@lesquel/opencode-pilot/src/server/dashboard/sse.js` on disk was the 1.13.2 version.
2. **Strategy was cache-first with no revalidation**. Once a file was in the cache, the browser never refetched it until the cache name changed. This made every future frontend change require a manual cache bump — easy to forget.

1.13.3 bumps `CACHE_NAME` to `pilot-v20` (v19 was announced but never shipped) and switches the fetch strategy to **stale-while-revalidate**: the cached copy renders instantly so the UI stays fast, and in parallel the SW fetches the current file from the server and updates the cache for the next load. No more "fix the code, publish, but users keep running the old bundle" traps — by the second load after publish, everyone's on the new code.

### How to recover if you're stuck on an old cache

```bash
npx @lesquel/opencode-pilot@latest init
pkill -f opencode
opencode
```

Then hard-reload the dashboard once (`Ctrl+Shift+R` / `Cmd+Shift+R`). The new SW activates, deletes `pilot-v18`, precaches everything at `pilot-v20`, and on the next prompt you should see tokens stream live.

---

## [1.13.2] — 2026-04-20

### Fixed — Dashboard didn't stream: user message + assistant tokens + tool updates all stuck until end of turn

The big one. The dashboard looked frozen from the moment you hit Send until the assistant's entire turn finished: the message you just sent didn't appear, no typewriter effect on the response, tool calls didn't animate through their states. Everything rendered as a single re-render at the very end.

Root cause (five concatenated issues, fixed together):

1. **We were listening to the wrong SSE event for streaming.** OpenCode's SDK emits TWO distinct events: `message.part.updated` (SNAPSHOT, used for tool state transitions pending → running → completed — never has a delta field) and `message.part.delta` (INCREMENTAL token chunks with `{ sessionID, messageID, partID, field, delta }`). The dashboard only subscribed to `message.part.updated` and looked for a `delta` property that never existed. Every token was silently dropped. Now we subscribe to `message.part.delta` for the typewriter and use `message.part.updated` exclusively for non-text hot-swaps.

2. **`sendPrompt` blocked the UI on the full turn.** It `await`ed `POST /prompt` (which on the backend `await`s `client.session.prompt(...)` until the assistant is done) and only then called `loadMessages` to render. Now it appends an optimistic `.message.user[data-pending="1"]` to the DOM immediately, fires the POST without awaiting, and lets SSE drive everything else. The SSE `message.created` (role=user) reconciles the pending marker with the real id.

3. **First delta arrived before the assistant bubble existed.** With the event name fixed, the first token would still be dropped because `applyStreamingDelta` couldn't find `[data-part-id=...]`. `ensureTextPartSurface(partId, messageId)` now creates an empty assistant bubble on demand, so every delta from token #1 lands visibly.

4. **Tool state transitions didn't animate.** Tool blocks now carry `data-part-id` and `data-message-id`. When `message.part.updated` lands with a tool snapshot, `replacePartInDom(part)` swaps only that node — the status icon goes ○ pending → ◐ running → ● completed live, and the OUTPUT pane fills in when the tool finishes. Text parts are deliberately skipped by the replace (the delta stream drives them).

5. **`loadMessages` wiped the transcript mid-turn.** It set `innerHTML = 'Loading…'` unconditionally, including on the final `message.updated` — erasing any in-progress deltas and flashing the whole pane. Now the placeholder only renders on a genuinely empty pane (first load or session switch).

Net effect: hit Send → your message appears instantly → typing indicator → assistant response streams token by token → tool calls animate through pending/running/completed in place → final bubble re-renders with full markdown. Real-time.

### Docs

- README now opens with "Install once, use everywhere" — one `npx init` in `~/.config/opencode` and the plugin works from **any** project. No `.opencode/` duplicates, no per-project setup.
- New "How to use it day-to-day" section covering: slash commands (`/pilot`, `/pilot-token`, `/dashboard`, `/remote`, `/remote-control`), terminal banner, dashboard tour (`?` palette, sidebar, transcript, right panel, settings gear), and phone access.

---

## [1.13.1] — 2026-04-20

### Fixed — TUI loader reads `tui.json`, not `opencode.json`

1.13.0 wrote the plugin spec into `~/.config/opencode/opencode.json::plugin`, expecting OpenCode's TUI loader to see it. It doesn't. OpenCode actually has **two separate plugin configs**, loaded by two separate loaders:

- `opencode.json::plugin` → read by the **server** loader (`src/plugin/index.ts`). Registers plugins that export a `server()` function (HTTP server, hooks, event listeners).
- `tui.json::plugin` → read by the **TUI** loader (`src/cli/cmd/tui/plugin/runtime.ts`). Registers plugins that export a `tui()` function (slash commands, toasts, sidebar widgets).

A spec in only `opencode.json` gets the dashboard but zero slash commands. A spec in only `tui.json` gets the slash commands but no dashboard. Our plugin ships both, so it needs to be in **both** files. The TUI loader never even logs "loading tui plugin" for the spec because it literally isn't in the list it reads — no error, no warning, just silent absence.

**`init` in 1.13.1** now writes the single canonical spec `@lesquel/opencode-pilot@latest` into **both** `opencode.json::plugin` and `tui.json::plugin`, creating `tui.json` if it doesn't exist. The `$schema` field defaults to `https://opencode.ai/tui.json` for editor autocompletion.

### Also fixed — OpenCode cache pinned the old pilot version under `@latest` spec

`init` in 1.13.0 cleaned `~/.cache/opencode/packages/@lesquel/opencode-pilot/` but OpenCode actually stores each plugin keyed by the **full spec string**, so the real cache lived at `~/.cache/opencode/packages/@lesquel/opencode-pilot@latest/` (suffix included). The cleanup missed it, so even after installing 1.13.0 in `~/.config/opencode/node_modules/`, OpenCode kept loading a stale 1.11.3 snapshot from that cache — where the server and TUI plugins shared the same `id` and the TUI got silently overwritten.

1.13.1 `init` now enumerates the `<cache>/@lesquel/` directory and removes every entry starting with `opencode-pilot`, covering `opencode-pilot`, `opencode-pilot@latest`, `opencode-pilot@<pinned>`, and stray `opencode-pilot/tui` subpath attempts in a single pass.

### Also fixed — Settings UI showed stale values after save

`GET /settings` and the response of `PATCH /settings` both returned `projectConfigToSettings(deps.config)`, where `deps.config` is a snapshot taken when the plugin booted. Any value saved from the UI (port, host, tunnel, etc.) would persist correctly to `~/.opencode-pilot/config.json` but the UI kept rendering the boot-time value, making it look like the save was ignored.

The handler now recomputes the effective config from the fresh store + shell env on every call. Restart-required fields still require a plugin restart to take effect at runtime — the UI badge makes that explicit — but the *displayed* value is now the one that WILL be active after restart.

### Also fixed — Settings modal clipped tall content on desktop

`.settings-box` had no height constraint, so with every section expanded the modal overflowed the viewport and the Save / Close buttons disappeared off-screen. Added `max-height: 85vh` and `overflow-y: auto` with a subtle scrollbar. Mobile already had the equivalent rules.

### Also fixed — UI froze during a turn (user message + assistant response didn't stream)

`POST /sessions/:id/prompt` blocks on `await deps.client.session.prompt(...)` until the assistant's entire turn is done. The dashboard then `await`ed that response before touching the DOM, so everything looked frozen: the sent message didn't render, the assistant's tokens didn't stream, tools didn't animate, and the whole transcript only appeared at the end as a single re-render.

Five coordinated fixes — the root of it was that we were listening to the wrong SSE event for streaming:

1. **Listen for `message.part.delta` (the real token stream)**. OpenCode's SDK emits TWO distinct events: `message.part.updated` is a SNAPSHOT (no delta field — used for tool state transitions pending → running → completed) and `message.part.delta` is the INCREMENTAL token stream (`{ sessionID, messageID, partID, field, delta }`). The dashboard was subscribing only to `message.part.updated` and looking for a `delta` field that never existed, which is why nothing streamed. We now subscribe to `message.part.delta` for the typewriter effect and use `message.part.updated` exclusively for non-text part hot-swaps.
2. **Optimistic user message**. `sendPrompt` appends the user's message to the DOM immediately (as a `.message.user[data-pending="1"]` node), clears the input, and fires `POST /prompt` without awaiting it. On failure the optimistic node is removed and a toast is shown; on success the SSE `message.created` (role=user) reconciles the `data-pending` marker with the real message id instead of re-rendering.
3. **On-the-fly streaming surface**. When the first `message.part.delta` arrives, the corresponding DOM node usually doesn't exist yet. `ensureTextPartSurface(partId, messageId)` now creates an empty assistant bubble with the right `data-part-id` on demand, so every delta lands visibly from token #1.
4. **Hot-swap for tool parts**. Tool blocks now carry `data-part-id` and `data-message-id` attributes. When `message.part.updated` lands with a tool snapshot, `replacePartInDom(part)` swaps only that node — text parts are deliberately left alone (the delta stream drives them), but tools update live: the status icon animates from ○ (pending) → ◐ (running) → ● (completed), the OUTPUT pane fills in, errors show in red, all without touching the rest of the transcript.
5. **No `Loading…` wipe while messages exist**. `loadMessages` used to set `innerHTML = 'Loading…'` unconditionally — including on `message.updated` at the end of a turn — which erased in-progress streaming deltas and caused the whole pane to flash. It now only shows the placeholder on a genuinely empty pane (first load, session switch).

Net effect: you hit Send → your message appears instantly → typing indicator → the assistant's response streams token by token → tool calls flicker through their state transitions live → the final bubble re-renders with markdown formatting when `message.updated` lands. Real-time, no frozen UI.

### New docs

- [`docs/INSTALL.md`](docs/INSTALL.md) documents the dual-config architecture, every gotcha from this saga, and the full troubleshooting matrix. Link it from any issue about "slash commands don't appear" or "plugin seems partly loaded".

### Upgrading from 1.12.x or 1.13.0

```bash
npx @lesquel/opencode-pilot@latest init
```

Then fully quit OpenCode (all sessions — `pkill -f opencode` if needed) and reopen. The toast should appear and `/remo<Tab>` should autocomplete the pilot commands.

---

## [1.13.0] — 2026-04-20

### Fixed — slash commands never registered on npm-installed plugin

**Symptom**: on the user's machine (OpenCode ≥ 1.14), after `npx @lesquel/opencode-pilot init`, the HTTP dashboard and banner came up fine, but typing `/remo<Tab>` showed only built-in commands. The TUI plugin silently never registered `/remote`, `/dashboard`, `/pilot`, `/pilot-token`, `/remote-control`.

**Root cause**: three concatenated bugs in the install pathway, all visible in `~/.local/share/opencode/log/<ts>.log`:

1. The `init` script added `"@lesquel/opencode-pilot/tui"` to `opencode.json::plugin` expecting OpenCode to honor the package's `exports["./tui"]` sub-path. It doesn't — OpenCode treats any string after `/` as a distinct npm package name and tries to download it into `~/.cache/opencode/packages/@lesquel/opencode-pilot/tui/`, which fails with `ENOENT … package.json`.
2. To "work around" #1, init also dropped two wrapper files under `~/.config/opencode/plugins/`. But OpenCode's server loader validates **every file** in that folder as a server plugin, and our TUI wrapper re-exported `{ id, tui }` without a `server` function. OpenCode rejected it: `must default export an object with server()`.
3. The server wrapper in that same folder collided with the npm-spec load: the plugin booted twice, and the second attempt crashed with `Failed to start server. Is port 4097 in use?`.

**The actual fix**: OpenCode's loader already does the right thing. Both the server loader (`plugin/index.ts`) and the TUI loader (`cli/cmd/tui/plugin/runtime.ts`) read the same `plugin_origins` array, and `shared.ts::resolvePackageEntrypoint` picks `exports["./server"]` or `exports["./tui"]` from the package's own `package.json`. **One npm spec is enough** for both modules.

`opencode.json::plugin` should contain exactly:

```json
"plugin": ["@lesquel/opencode-pilot@latest"]
```

No wrappers. No `/tui` sub-path. No file:// URLs.

**What `init` does in 1.13**:

- Adds a single canonical `@lesquel/opencode-pilot@latest` spec, removing any stale `/tui`, `/server`, or pinned variants.
- Deletes stale wrapper files `opencode-pilot.ts` and `opencode-pilot-tui.ts` left behind by 1.11.x–1.12.x installs.
- Invalidates OpenCode's package cache (`~/.cache/opencode/packages/@lesquel/opencode-pilot/`, or the platform equivalent) so the next launch re-fetches the new version instead of serving a stale copy.

### Canary — how to confirm the plugin actually loaded

On OpenCode startup the TUI plugin shows a toast:

> **OpenCode Pilot** — Remote control plugin loaded. Use `/pilot` or `/pilot-token`.

If the toast appears → TUI registered → slash commands work. If no toast appears, the TUI did not load. Inspect the latest log and grep for `pilot`, `tui.plugin`, or `error`:

```bash
tail -200 $(ls -t ~/.local/share/opencode/log/*.log | head -1) | grep -iE "pilot|tui.plugin|error"
```

### Upgrading from 1.12.x

```bash
npx @lesquel/opencode-pilot@latest init
```

That single command upgrades the package, strips the stale wrappers, and rewrites `opencode.json::plugin` to the single-spec form. Close **all** OpenCode sessions fully and reopen — the toast should appear on the next launch.

### Also in 1.13

- **`prepublishOnly` guard** (`scripts/prepublish-guard.ts`) fails the publish if `package.json::dependencies` contains the upstream-hook-injected self-reference `"@lesquel/opencode-pilot"` or if `@opencode-ai/plugin` is pinned instead of `"latest"`. This prevents two classes of broken publishes that bit us in 1.12.x.

---

## [1.12.6] — 2026-04-20

### Fixed — highlight.js threw "module is not defined" in browser

Dashboard loaded `highlight.js@11.10.0/lib/core.min.js` and seven `lib/languages/*.min.js` scripts. These are CommonJS internals meant for bundlers (webpack/vite) — they reference `module.exports` and crash with `Uncaught ReferenceError: module is not defined` when loaded directly via `<script>` in a browser.

**Fix**: replaced the 9 `lib/...` script tags with a single UMD bundle from `/build`:

```html
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/build/highlight.min.js"></script>
```

The `/build` bundle is proper UMD and includes ~190 languages out of the box (~1.2 MB minified). One file, no MIME errors, syntax highlighting works.

### How to spot this on your install

If you see in the browser console (after a hard reload):

```
Uncaught ReferenceError: module is not defined
    <anonymous> core.js:2595
Uncaught SyntaxError: redeclaration of const IDENT_RE
```

You're on the bad version. Upgrade and SW cache will rotate automatically (`pilot-v18` → `pilot-v19`).

### About the 401 errors

The 401s in the same console output were a separate issue: when you restart the plugin, a fresh token is generated. Browsers with cached tokens from the previous session get 401s. Hard reload + re-scan the QR (or re-open the URL from the new banner) to pick up the new token.

---

## [1.12.5] — 2026-04-20

### Fixed — `init` now upgrades `@opencode-ai/plugin` SDK too

OpenCode releases new SDK versions frequently (we saw `1.3.17 → 1.14.18` in a short window). When the SDK in `~/.config/opencode/node_modules/@opencode-ai/plugin` is stale, our plugin loads against an outdated API and the TUI silently fails to register slash commands.

`init` now installs `@opencode-ai/plugin@latest` alongside `@lesquel/opencode-pilot@latest` on every run, so the SDK keeps pace with whatever OpenCode binary the user is running.

If you hit "no slash commands" after upgrading to a new OpenCode release, re-run:

```bash
npx @lesquel/opencode-pilot init
```

That fixes it.

---

## [1.12.4] — 2026-04-20

### Fixed — `init` command no longer silently uses stale install

Re-running `npx @lesquel/opencode-pilot init` when the package was already installed used to be a no-op (because `bun add @lesquel/opencode-pilot` skips if already present). That made the v1.12.x bug fixes invisible to users who had v1.11.x installed.

Init now installs `@lesquel/opencode-pilot@latest` explicitly, forcing an upgrade on every run.

If you already installed via `init`, also run:

```bash
cd ~/.config/opencode
bun add @lesquel/opencode-pilot@latest
```

### Where to find OpenCode logs (FYI)

If the plugin doesn't seem to load, check the log directory:

- **Linux**: `~/.local/share/opencode/log/<timestamp>.log`
- **macOS**: `~/Library/Logs/opencode/<timestamp>.log`
- **Windows**: `%LOCALAPPDATA%\opencode\log\<timestamp>.log`

Look for lines like `service=tui.plugin path=...opencode-pilot... loading tui plugin`. If you see "loading" but no toast appears in the TUI, the plugin loaded but didn't initialize correctly — open an issue with the log lines.

---

## [1.12.3] — 2026-04-20

### Fixed — TUI plugin id collided with server plugin id (slash commands silently dropped)

The TUI plugin module exported `id: "opencode-pilot"` — same as the server plugin. OpenCode loads server and tui modules separately, but with the same id one of them gets silently overwritten/skipped. The server (loaded first) won, the TUI (loaded second) was dropped — no slash commands appeared.

**Fix**: TUI module now exports `id: "opencode-pilot-tui"`. Distinct id avoids the collision. Both modules now register independently.

If you were on v1.12.0 / v1.12.1 / v1.12.2 and slash commands didn't show up despite `npx @lesquel/opencode-pilot init` succeeding, this is the cause. After upgrading, the toast "OpenCode Pilot — Remote control plugin loaded" should appear when you start OpenCode, and `/remo<tab>` should autocomplete to `/remote`, `/remote-control`, `/dashboard`.

### Fixed — Self-reference in dependencies (third time)

Removed `@lesquel/opencode-pilot` from `dependencies` again. Keeps coming back when `bun add` is run from the plugin's own directory. Need to remember: NEVER run `bun add` inside the plugin repo's root.

### Notes for users

To upgrade:

```bash
cd ~/.config/opencode    # or your XDG OpenCode config dir
bun update @lesquel/opencode-pilot
```

Then **fully quit and restart OpenCode** (close ALL sessions, not just refresh — plugins load only at startup).

---

## [1.12.2] — 2026-04-20

### Fixed — TUI slash commands didn't load (only the server did)

The init wrapper only loaded the server plugin, not the TUI plugin — so `/remote`, `/pilot`, `/dashboard`, `/pilot-token` weren't available even after a successful install. Root cause: OpenCode's SDK separates `PluginModule` (server) and `TuiPluginModule` (tui) as mutually exclusive types — they CANNOT be combined into one file. We need TWO wrappers in `~/.config/opencode/plugins/`.

The init CLI now writes both:

- `plugins/opencode-pilot.ts` — server (HTTP + dashboard + banner)
- `plugins/opencode-pilot-tui.ts` — tui (slash commands)

Re-run `npx @lesquel/opencode-pilot init` to upgrade. Or manually create the second wrapper:

```bash
cat > ~/.config/opencode/plugins/opencode-pilot-tui.ts << 'EOF'
export { default } from "@lesquel/opencode-pilot/tui"
EOF
```

Then restart OpenCode.

### Fixed — Self-reference snuck back into dependencies

Removed `@lesquel/opencode-pilot` from its own `dependencies` again (must have been added by an editor / `bun add` with `--save` typo). Same fix as v1.12.0.

---

## [1.12.1] — 2026-04-20

### Added — One-command installer

```bash
npx @lesquel/opencode-pilot init
```

That's it. The installer locates your OpenCode config dir (XDG / `~/.config/opencode` / `%APPDATA%`), installs the plugin there with `bun` or `npm`, drops a wrapper file at `<config>/plugins/opencode-pilot.ts` so OpenCode loads it reliably, and adds the plugin to `opencode.json` if it isn't already. New `src/cli/init.ts`, registered as the `opencode-pilot` bin in package.json.

### Why this exists

The previous "manual install" path (install package → edit `opencode.json` → restart) had a failure mode where OpenCode's plugin-array resolution for scoped packages (`@scope/name`) didn't trigger the load. Result: package installed correctly, listed in config correctly, but no banner printed. Engram and other community plugins solve this by dropping a `.ts` wrapper file in `~/.config/opencode/plugins/` — we now do the same automatically.

The wrapper file is a single line that re-exports the plugin from `node_modules`, so `bun update @lesquel/opencode-pilot` still works for upgrades.

### Changed — README install section rewritten

One-command flow first, manual install second (collapsed for power users).

---

## [1.12.0] — 2026-04-20

Major UX release: configure the plugin from the dashboard Settings UI instead of editing `.env` files. The `.env` flow still works (power users); the UI is the new easy path.

### Added — Settings UI for env vars (the headline)

Open the dashboard → click the gear (⚙) → scroll to **Plugin configuration**. Five collapsible groups:

- **Server** — port, host
- **Tunnel** — provider dropdown (off / cloudflared / ngrok)
- **Notifications** — Telegram (token + chat id), VAPID keys (with **Generate VAPID keys** button), VAPID subject
- **Permissions** — timeout in ms
- **Advanced** — enableGlobOpener, fetchTimeoutMs

Each field shows a badge (`saved`, `.env`, `shell`, `default`) so you know where the current value comes from. Fields set via shell env vars are locked from the UI (you'd have to unset the shell var to override). Restart-required fields show an inline warning. Password fields (Telegram token, VAPID private key) have a show/hide eye toggle.

**Generate VAPID keys** calls a new server endpoint that runs `web-push.generateVAPIDKeys()` and fills both inputs in one click — no more `bunx web-push`.

**Reset to defaults** deletes `~/.opencode-pilot/config.json` after a confirm dialog.

### Added — Persistent settings store

- New `src/server/services/settings-store.ts` — atomic file write to `~/.opencode-pilot/config.json` (write to `.tmp`, then rename, so a crash can never leave a corrupt file).
- Sanitize on load AND save: drops unknown keys, validates types.
- Survives plugin restarts. Doesn't touch your `.env`.

### Added — Settings HTTP endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/settings` | required | Returns current effective settings + per-field source + restartRequired list |
| `PATCH` | `/settings` | required | Validates, merges with stored settings, writes to file. Returns 409 `SHELL_ENV_PINNED` for fields set via shell env |
| `POST` | `/settings/reset` | required | Deletes `~/.opencode-pilot/config.json` |
| `POST` | `/settings/vapid/generate` | required | Returns a fresh `{ publicKey, privateKey, subject }` pair |

All wired into the route table; `/settings*` added to `apiPaths` in the service worker.

### Changed — Config priority

Now (highest wins):

```
1. Shell env vars                e.g. PILOT_PORT=5000 opencode
2. ~/.opencode-pilot/config.json  written by the Settings UI
3. .env file                      power-user file-based config
4. Hardcoded defaults
```

Implementation: `mergeStoredSettings()` + `resolveSources()` in `src/server/config.ts`. `index.ts` snapshots `process.env` BEFORE `.env` and settings-store touch it, so we know which fields are truly "from shell" vs overlays.

### Fixed — Self-reference in package.json

A previous edit added `@lesquel/opencode-pilot` to its own `dependencies` (self-reference), which would have broken `npm install` on fresh clones. Removed.

### Added — Tests

35 new tests (`146 → 181` pass / 0 fail):
- `services/settings-store.test.ts` — 10 tests (load / save / merge / reset / corrupt-file / atomic-tmp-cleanup)
- `config.test.ts` — 13 new tests (mergeStoredSettings / resolveSources / projectConfigToSettings)
- `http/settings.test.ts` — 12 tests (GET/PATCH/RESET, 400/409 cases, source classification)

### Documentation

- `README.md` — new "Configuration — two ways" section. Explains UI flow + env-var table + priority diagram.
- `docs/CONFIGURATION.md` — top-of-file rewrite explaining UI vs `.env`, "Using the Settings UI (v1.12+)" walkthrough, priority block.
- `CLAUDE.md` — route table, structure tree, config section updated.

### Changed — SW cache `pilot-v17` → `pilot-v18`

---

## [1.11.3] — 2026-04-20

### Changed — npm metadata + README rewrite for users

- **README** rewritten for npm visitors. Features list, mobile / phone access, keyboard shortcuts table, all env vars at a glance, links to docs/. Badges for npm version, downloads, license, GitHub stars.
- **package.json keywords** expanded from 9 to 25 — covers `opencode-plugin`, `ai-agent`, `web-push`, `cloudflared`, `ngrok`, `pwa`, `multi-project`, `developer-tools`, `claude`, `anthropic` etc. for npm search discoverability.
- **package.json author** structured as `{ name, url }` so npm shows a clickable link.
- **package.json funding** field added pointing to GitHub Sponsors.
- **description** rewritten to mention the headline features (multi-project tabs, live SSE, mobile, tunnel, push/Telegram).

No code changes. Pure publish-quality polish.

---

## [1.11.2] — 2026-04-20

### Changed — Package renamed to `@lesquel/opencode-pilot`

The unscoped name `opencode-pilot` was already taken on npm (by an unrelated automation daemon by @athal7). Renamed to the scoped `@lesquel/opencode-pilot` so the name is permanently yours and never collides. `publishConfig.access: "public"` added so `npm publish` works without explicit `--access public`.

**Users now install via**: `npm install @lesquel/opencode-pilot` or `bun add @lesquel/opencode-pilot`.

The plugin id (`opencode-pilot` in `opencode.json`) is unchanged.

### Fixed — Project picker showed `(project)` instead of real names

The OpenCode SDK's `Project` shape is `{ id, worktree, vcsDir?, vcs?, time: { created, initialized? } }` — no `name` or `path` field. Our picker was looking for `p.name ?? p.path ?? p.root ?? p.directory` and falling through to the literal string `(project)`. Now reads `p.worktree` first and derives the basename for the label. Modified time falls back through `time.initialized → time.created` instead of `time.updated` (which doesn't exist on Project).

### Added — `publishConfig` and 2FA documentation

- `package.json::publishConfig.access = "public"` so scoped publish works without flag.
- `docs/PUBLISHING_TO_NPM.md` updated: package name, why we're scoped, NPM_TOKEN with 2FA bypass via Automation tokens, `--otp=` flag for one-shot publishes.

---

## [1.11.1] — 2026-04-19

Patch release fixing four issues reported after v1.11.0 + three new docs for npm publish, tunnel testing, and configuration.

### Fixed

- **Tab labels showed full path or wrong project name** — `applyProjectChoice` derived the label using `shortenPath()` which returned multi-segment paths like `~/proyectos/zimna-app`. Now uses true basename (`zimna-app`) via `path.split('/').filter(Boolean).pop()`. Falls back to picker label, then `shortenPath`, in that order.
- **Switching tabs felt frozen — messages pane stuck on previous tab's content** — `switchProjectTab()` only re-rendered when `!tab.loaded`. For previously-loaded tabs, sync happened but no DOM refresh. Added `else` branch that calls `renderSessions()`, `updateHeaderSession()`, `updateInfoBar()`, and `loadMessages(activeSession)` so loaded tabs also get a fresh paint.
- **SSE appeared to buffer until end of conversation** — root cause was `MESSAGE_CREATED` for assistant messages calling `loadMessages()` which wiped the messages pane to "Loading…", destroying the `[data-part-id]` DOM elements. Subsequent `MESSAGE_PART_UPDATED` events couldn't find their target nodes and silently dropped deltas. Now `MESSAGE_CREATED` shows a typing indicator (3-dot bounce) without wiping the DOM; `MESSAGE_UPDATED` (the final event) triggers the full re-render.
- **Mobile tab bar appeared to only show "default"** — actually all tabs rendered but the active tab could be off-screen with no visual cue. Added `requestAnimationFrame(() => activeEl?.scrollIntoView(...))` after every render and explicit `overflow-x: auto` + `-webkit-overflow-scrolling: touch` on mobile.

### Added — Typing indicator

- New `showTypingIndicator()` in `messages.js` — appends a 3-dot bounce animation (`.typing-indicator` + CSS keyframes) below the last message when SSE signals an assistant turn started. Disappears when first content arrives.

### Added — Three new docs in `docs/`

- **`PUBLISHING_TO_NPM.md`** — Complete guide for shipping the plugin as a public npm package: account setup, NPM_TOKEN in GitHub Secrets, scoped vs unscoped names, the `package.json::files` array, manual + CI publish flows, pre-publish checklist (typecheck + tests + version sync across 4 files + CHANGELOG entry + tarball smoke test), versioning policy (semver), unpublish/deprecate, and what new users have to do after `npm install opencode-pilot`. Includes a section explaining that `.env` is per-user and NOT replicated.
- **`TUNNEL_TESTING.md`** — End-to-end verification guide for `cloudflared` and `ngrok` tunnels: install commands per OS, minimum `.env`, step-by-step test (curl `/connect-info`, browser load, phone over cellular, SSE stability >5min, restart re-pair), troubleshooting tables, security checklist, and "when tunnels aren't appropriate".
- **`CONFIGURATION.md`** — Every environment variable explained, organized by category (server binding, tunnel, permissions, Telegram, Web Push, file browser, dev). Five copy-paste `.env` scenarios from "solo dev localhost" to "full setup with everything on". Includes how `.env` loading works (cwd → plugin dir, shell vars win), VAPID key generation, security notes, how to share setup with teammates (use `.env.example`, never `.env`).

### Changed — SW cache `pilot-v16` → `pilot-v17`

---

## [1.11.0] — 2026-04-19

### Added — Multi-project tabs bar (major feature)

- New `project-tabs.js` module + `state.js` `projectTabs`/`activeProjectId` + `addProjectTab`/`removeProjectTab`/`switchProjectTab` helpers.
- Horizontal tabs bar between header and layout. Each tab = one open project directory with its own cached `sessions`, `statuses`, `sessionMeta`, `activeSession`.
- Switching tabs is **instant** — no refetch. Each tab holds its own state; the top-level `state.sessions/…` slots are a live mirror of the active tab.
- **Persistence**: tabs saved to `localStorage.pilot_project_tabs` (lite: id/directory/label) + `pilot_active_project_id`. Restored on reload; the active tab's sessions are lazy-loaded.
- **UI**: Active tab visually distinct, close `×` always visible, `+` button opens the project picker. Min-height 44px on mobile; horizontal scroll when many tabs; labels truncate to 20 chars on smaller viewports.
- The project picker and custom-folder modal both go through `addProjectTab()` — so opening a project or a custom folder always creates or focuses a real tab.

### Fixed — Opening a custom folder left the user stuck with a disabled composer

- After `openCustomFolderModal()` confirmed a path, if the new folder had NO sessions, `activeSession` stayed `null` and the composer was disabled. User couldn't send anything.
- Fix: the new tab API calls `loadSessions(true)` (autoselect) AND auto-creates a fresh session when none exist — so the composer is always usable after opening a folder.
- Same fix applies to `applyProjectChoice` (picker path).

### Fixed — Debug Info modal Close button did nothing visible

- Root cause: `.modal-overlay` and `.modal-box` CSS classes were **never defined** in styles.css. The JS correctly toggled `.open`, but with no CSS rules the class change was invisible — so clicking Close appeared to do nothing.
- Fix: added proper modal CSS (`display:none` default; `.open` → `display:flex`, backdrop, centered box). Also switched close-button handling to event delegation on the overlay so clicks on the `×` icon / label inside the button always hit. Added global Escape-to-close.

### Added — Project picker is more descriptive

- Live search/filter input at the top of the picker (filters by name OR path).
- Each row shows: project name (bold) + full path (muted) + relative last-modified time (e.g. `3h`, `2d`) when available.
- Two sections: "Recent projects" (top 5 by mtime) and "All known projects".
- Still includes "Open custom folder…" and "Default (back to OpenCode instance)" at the top.

### Changed — SW cache `pilot-v15` → `pilot-v16`

- New `project-tabs.js` added to precache; bumping cache forces clients to pick up the new tab bar CSS, the debug-modal CSS, and the new modules.

---

## [1.10.0] — 2026-04-19

### Discovered — "Plan mode" is an AGENT, not a multi-choice prompt

Investigation finding: in OpenCode, "plan mode" is the agent named `"plan"` (siblings: `build`, `general`, `explore`). The SDK does NOT emit multi-choice option prompts. The interactive feeling some users get is from the `agent` part type (`type: 'agent'`) being emitted when the agent transitions mid-session — and we were silently dropping it. Plus four other part types we ignored: `step-start`, `step-finish`, `retry`, `compaction`.

### Added — Conversation rendering for previously-ignored part types

- `messages.js::renderPart` now handles:
  - **`agent`** — renders an inline agent-transition badge in the conversation flow
  - **`step-start` / `step-finish`** — subtle TUI-style notice line
  - **`retry`** — same, marked as retry
  - **`compaction`** — same, indicates context compaction happened
- Previously these were `''` returns → invisible.

### Added — Switch agent button next to compose bar label

- The `lbl-agent` span in the composer footer is now wrapped in a clickable `lbl-agent-btn` button (≥44px tap target on mobile).
- Click opens the existing agent picker (`openAgentPicker`) so users can switch to plan/build/general/explore mid-session without keyboard shortcuts.

### Added — "Open custom folder…" in project picker

- First item in `openProjectPicker()` opens an inline modal (not `window.prompt()` which is blocked on iOS).
- Validates path: must start with `/` (Linux/Mac) or `[A-Z]:\` (Windows).
- Calls `setActiveDirectory(path)` + reloads sessions + refreshes references — same flow as switching to a known project.
- Accessible from sidebar `▤ project` button, mobile header badge, and mobile kebab "Switch project" row.

### Fixed — File browser filter wasn't filtering on type

- The glob input only fired on Enter. Users expected typing to filter immediately.
- Now: **live substring filter** (debounced 200ms) on every keystroke — fast, no server call, works without `PILOT_ENABLE_GLOB_OPENER`.
- Glob server search still triggers on **Enter** when the pattern contains glob chars (`* ? { } [ ]`); 403 returns the existing error message about enabling the opt-in.

### Changed — SW cache `pilot-v14` → `pilot-v15`

### Test prompt to verify plan mode rendering

Click the agent name in the compose bar (now a button) → switch to "plan" → send:

> Plan a 3-step refactor of the auth flow and show me your plan before making any changes.

You should see the agent-transition badge appear in the conversation when the agent switches, and step-start/step-finish notices as the plan agent works through its steps.

---

## [1.9.0] — 2026-04-19

Polish release responding to user feedback after v1.8.4. Six items.

### Added — Notifications actually work now

- **Sound notification** (`s-sound` toggle) — generates a soft two-tone beep via Web Audio API (800Hz → 1000Hz, 80ms each, 0.15 volume). No audio file dependency. Plays when an assistant turn completes AND the page is not focused. Also plays on permission requests. New file `notif-sound.js`.
- **Browser notification** (`s-notif` toggle) — `new Notification('OpenCode Pilot', { body: 'Response ready in "<session>"' })` when MESSAGE_UPDATED fires AND `document.hidden` AND permission granted. Click on the notification focuses the window and selects that session.
- **Push notification toggle** (`s-push-notif`) was already wired but silent. Now shows a toast for the result of the permission prompt (granted / dismissed / error) so the user knows it actually happened.

### Added — Project switcher visible everywhere

The "Open Project" action existed only inside the command palette. Now there are three discoverable entry points:

- **Sidebar button** next to "Sessions" header (always visible): `▤ <project name>` — tap to open project picker.
- **Mobile header badge** in the breadcrumb (visible on phones): same icon + label, tap to switch.
- **Mobile kebab menu** (`⋮`) — new "Switch project" row.

All three call the same `openProjectPicker()` (now exported from `command-palette.js`). The label syncs via `subscribe('project-label', ...)` whenever directory changes.

### Changed — Multi-view hidden on mobile (per user request)

User said: *"en móvil no pongamos eso porque, o sea, como que dar a un diseño más minimalista en móvil"*. Done:

- `#multiview-btn` hidden under `@media (max-width: 768px)`.
- `initMultiView()` early-returns the toggle handler on mobile.
- `exitMultiviewIfMobile()` runs on init AND on window resize, forcing single-view if user shrinks past 768px.

Multi-view remains fully functional on desktop (≥769px).

### Changed — Agent panel readable on mobile

The agent context panel was unreadable on phone (cut-off rows, tiny font). Mobile rules added:
- Body font-size 13px, padding 10px 12px
- Rows stack vertically (no horizontal overflow)
- Word-break on long values
- Agent name 14px, descriptions 12px, chips 11px
- Max-height 60vh so it scrolls inside the drawer

### Changed — SW cache `pilot-v13` → `pilot-v14`

Forces fresh download on next visit (notif-sound.js added to PRECACHE).

### Things left untouched (per user's explicit "don't touch" list)

- Theme toggle ✓
- Show tools toggle ✓
- Default reasoning toggle ✓
- Command palette ✓
- Delete session ✓
- Rename session ✓

---

## [1.8.4] — 2026-04-19

### Fixed

- **Sidebar drawer wouldn't open on mobile** — the `☰` button had TWO click handlers competing: `main.js::createMobileDrawer()` (capture phase, opens drawer + shows backdrop) AND `shortcuts.js::toggleSidebar()` (bubble phase, also toggles the `open-overlay` class). They cancelled each other: my handler added the class, the shortcuts handler immediately toggled it OFF. Net effect: drawer flashed and closed, user saw nothing.

  Fix: `e.stopImmediatePropagation()` + `e.preventDefault()` in the capture handler when on mobile, so `shortcuts.js::toggleSidebar()` never fires for that click.

- SW cache `pilot-v12` → `pilot-v13`.

---

## [1.8.3] — 2026-04-19

### Removed

- **Mobile FAB for new session** removed — user reported it was redundant with the existing `+ New` button in the header. The `☰` (sidebar toggle) opens the drawer with the full sessions list and the "+ New Session" button inside, so two `+` buttons stacked together on mobile was noise.

### Changed

- Service worker cache `pilot-v11` → `pilot-v12` so the FAB element is dropped from cached pages on next visit.

---

## [1.8.2] — 2026-04-19

### Added — Mobile UX polish (6 fixes)

- **Floating + button on mobile** to create a new session without opening the drawer. 56×56 round, fixed bottom-right above composer. Visible only at ≤768px.
- **Kebab menu (`⋮`) in header on mobile** opens a popover with: Open command palette, Keyboard shortcuts, Connect from phone, Toggle info panel. The way to access keyboard-only commands when there's no keyboard.
- **Label-strip visible on mobile** showing real `agent · model · provider`. Tighter style (11px font, ellipsis if too long, max 28vw per span). Was previously hidden below 480px in v1.8.0.
- **Service worker cache bumped** `pilot-v10` → `pilot-v11` so the new mobile CSS reaches phones with stale caches.

### Fixed

- **Hardcoded placeholder labels gone** — `index.html` had `lbl-agent="Build"`, `lbl-model="Claude Opus 4.5"`, `lbl-provider="OpenCode"` baked in, so users saw those defaults until label-strip.js fetched the real values (~100-200ms). Spans now start empty; populated on first refresh.
- **Right panel data was stale during streaming** — `refresh()` is now throttled to one call per 250ms (trailing-edge call ensures last update lands). Renders short-circuit when `inputTokens / percentUsed / cumulativeCost / activeSession` are all identical to the previous render — no flicker.
- **Sessions list flicker on SSE bursts** — `renderSessions()` is now a debounced wrapper (16ms / one frame). Multiple SSE events within a frame coalesce into one DOM write.
- **Session row stayed stale after a message arrived** — new `refreshSessionMeta(sessionId)` re-fetches just that one session's last-message meta and re-renders. Called from `sse.js` on every `MESSAGE_UPDATED` event. Sessions list now shows updated `model · provider` without a full `loadSessions()`.

### Known minor

- The `·` separators in the label-strip are visible briefly when spans are empty (sub-200ms boot window). Cosmetic only — the values populate as soon as references load.

---

## [1.8.1] — 2026-04-19

### Fixed

- **Right panel could not be hidden on mobile** — there was no visible toggle anywhere; the only way to hide it was the `Alt+I` shortcut, which doesn't exist on phone. Two fixes:
  1. **Always-visible close button** (`×`) at the top-right corner of the right panel itself. Works on every viewport.
  2. **New `i` icon in the header** (between sidebar toggle and settings) toggles the right panel from any viewport. On phone, this is the way back in once you close it.
- **Right panel defaults to hidden on mobile** — main.js now adds `right-panel--hidden` on mount when `window.innerWidth <= 768`. So the first phone load starts with a clean main view, and the user opens the panel only when they want it.
- **Service worker cache bumped to `pilot-v10`** — v1.8.0's mobile CSS wasn't loading on phones because the service worker was still serving the cached `pilot-v9` shell from prior versions. Cache rotation forces re-download on next visit.

If you're on iOS and still see the old layout: open Settings → Safari → Clear History and Website Data, then reload. Chrome/Firefox: hard reload (`Ctrl+Shift+R`) or DevTools → Application → Service Workers → Unregister.

---

## [1.8.0] — 2026-04-19

Headline release for **mobile**. The dashboard is now properly usable from a phone after the v1.7 access path was unblocked.

### Added — Mobile responsive pass

868 lines of `@media (max-width: 768px)` CSS rules appended to styles.css. Zero existing desktop CSS touched — all additive, all under media queries. Desktop layout is bit-identical.

- **Header**: collapses to a single 44px row. Traffic-light dots hidden, SSE label hidden (dot stays), `+ New` button shows just `+`. All header buttons remain icon-tappable.
- **Sidebar drawer**: `#sessions-panel` becomes `position: fixed; transform: translateX(-100%)` and slides in from the left when toggled. New `#mobile-backdrop` div darkens the main panel and closes the drawer on tap. Tapping a session in the list auto-closes the drawer and shows messages. ESC closes too.
- **Multi-view as swipeable carousel**: panes stack horizontally with `scroll-snap-type: x mandatory` so each pane snaps to full viewport width. Native swipe gesture between panes feels right on phone. `+ Add session` hidden on mobile (use command palette).
- **Modals go full-screen**: settings, command palette, keymap/shortcuts, connect-from-phone modal, session picker — all become bottom sheets at `max-width: 768px` (`align-items: flex-end`, full width, no border radius on the bottom).
- **Composer**: textarea sticks to bottom, send button >=44×44 touch target. Label-strip below composer hidden under 480px to save vertical space.
- **Touch targets**: all interactive elements (`btn-icon`, `btn-send`, `session-item`, allow/deny, close X) get `min-height: 44px` per Apple/Material guidelines.
- **iOS zoom prevention**: every `input` and `textarea` gets `font-size: 16px !important` inside the mobile media block (Safari auto-zooms inputs <16px on focus).
- **Code blocks**: `pre, code` get `white-space: pre-wrap; word-break: break-word; overflow-x: auto` so long lines scroll horizontally inside their container instead of breaking the page layout.
- **Always-visible affordances**: delete X buttons and pin-TODO buttons no longer require hover — visible at all times on small screens.
- **Right panel**: hidden by default below 768px (existing Alt+I overlay behavior extended). Bottom-sheet variant deferred to v1.9.
- **Footer**: hidden on mobile to reclaim ~44px of vertical space.

### Plus a tiny JS addition

`createMobileDrawer()` factory in `main.js` (~30 LOC) wires the backdrop show/hide, session-tap-to-close, and ESC. Uses `capture: true` on the toggle button click so it intercepts before `shortcuts.js`. Early-returns above 768px so desktop behavior is untouched.

### How to verify

Open the dashboard on your phone (LAN URL via QR from v1.7 modal):
- Header: 1 row, fits on screen, all icons tappable
- Toggle the ☰ button (top right) → sidebar slides in from left, dark overlay behind
- Tap a session → drawer closes, messages render, composer sticky at bottom
- Multi-view: swipe horizontally between panes
- Settings, palette, etc.: open as full-screen sheets

### Known limitations (v1.9 candidates)

- Right panel on phone: just hidden, no bottom-sheet alternative yet
- No haptic feedback on swipe/tap
- Drawer doesn't have an edge-swipe gesture — must tap the toggle button
- No PWA install prompt UI (manifest is ready, just no in-app affordance)

---

## [1.7.2] — 2026-04-19

### Fixed

- **Phone access via LAN IP showed the standalone "Connect to instance" form** instead of auto-logging in with the URL token — `isEmbeddedMode()` only treated `127.0.0.1` / `localhost` as embedded, so any LAN IP (e.g. `192.168.100.115`), tunnel domain, or QR-generated URL fell through to standalone mode and asked for manual server URL + token. Now embedded mode detects:
  - URL with `?token=` query param (page came from a plugin-generated link)
  - Localhost (`127.0.0.1`, `localhost`, `::1`)
  - RFC1918 private network IPs (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`)
  - Cloudflare tunnel domains (`*.trycloudflare.com`)
  - ngrok tunnel domains (`*.ngrok.io`, `*.ngrok-free.app`, `*.ngrok.app`)

  Only genuine standalone deploys (e.g. GitHub Pages serving the dashboard with a separate API host) get the connect screen.

---

## [1.7.1] — 2026-04-19

### Fixed

- **`PILOT_HOST=0.0.0.0` in `.env` was ignored** — OpenCode does not auto-load the plugin's `.env` file, so `process.env.PILOT_HOST` was always undefined and the config silently fell back to `127.0.0.1`. The dashboard's "Connect from phone" modal correctly reported "Server bound to localhost only" but the user had set `PILOT_HOST=0.0.0.0` in `opencode-pilot/.env`. Added a tiny `loadDotEnv()` utility (no deps, ~50 LOC) that runs before config load. Searches `process.cwd()/.env` then plugin install dir / `.env`. Existing shell env vars always win over `.env` values. Logs the loaded path + variable count for visibility.

This unblocks **all** `PILOT_*` env var configuration when the plugin is installed as a dependency rather than run from its own directory.

---

## [1.7.0] — 2026-04-19

Headline release for **mobile / remote access**. Two new features that close the gap between "self-hosted toy" and "I can use this from my phone" — plus a complete design document for the future cloud relay (v2.0) for reference.

### Added — Connect from phone (LAN + tunnel + QR)

- **New `GET /connect-info` endpoint** (auth-required) reports `lan` (URL, IP, exposed?), `tunnel` (provider, URL, status), `local` (loopback URL), and an abbreviated `tokenPreview` for display. The dashboard polls this every 10 seconds while the modal is open so newly-started tunnels surface automatically.
- **"Connect from phone" modal** with three tabs: Local network, Public tunnel, Localhost. Each tab renders a scannable QR code from the corresponding URL using the `qrcode` library lazy-loaded from CDN (cached, with offline fallback to copyable text). Polished UX: warning boxes when LAN binding is off or tunnel isn't running, "Copy URL" buttons, security notes for tunnel mode.
- **Phone icon in the header** (next to SSE indicator) launches the modal. Also accessible via:
  - Single-key shortcut `c` (when no input focused)
  - Command palette action "Connect from phone"
- **Tunnel state visibility** — `services/tunnel.ts` now exposes a `getTunnelInfo()` getter with live status (`off | starting | connected | failed`) and the active URL. Audit logs `tunnel.connected` / `tunnel.disconnected` events.
- **README "Connect from phone" section** covers LAN setup (`PILOT_HOST=0.0.0.0`), tunnel setup (cloudflared / ngrok), security caveats (token = password, rotate via `/auth/rotate`), and limitations.

How to use it from your phone:

1. **Same WiFi**: set `PILOT_HOST=0.0.0.0` → restart OpenCode → click the phone icon in the header → scan QR with your phone camera.
2. **Anywhere**: also set `PILOT_TUNNEL=cloudflared` (or `ngrok`) → restart → modal's "Public tunnel" tab now has a QR with the public URL.

### Added — Cloud Relay v2.0 design document

`docs/CLOUD_RELAY_v2_DESIGN.md` — 5,850 words, 12 sections, ASCII diagrams, cost tables, threat model. Covers the architecture for a centralized service (think `pilot.lesquel.com`) where the plugin connects OUT to a relay so non-technical users can pair via QR without configuring tunnels.

**Verdict in the doc: 6/10 — "interesting, but not now"**. Recommends polishing self-hosted + tunnel UX first (1-2 weeks), validating with 5+ real paying commitments, only then building. Anthropic likely ships native remote access within 12 months which would compete head-on. Read the doc before committing to v2.0.

### Notes for users on v1.6.x

If you were on v1.6.4, no breaking changes. Just hard-reload the dashboard (`Ctrl+Shift+R`) to see the new phone icon in the header.

---

## [1.6.4] — 2026-04-19

### Fixed

- **Multi-view pane never refreshed after sending** — `sse.js` MESSAGE_CREATED/UPDATED handler only matched `d?.sessionId` (lower-d) when looking for pinned panes, but the OpenCode SDK emits `sessionID` (capital D) under `ev.properties`. Same shape we handle in line 179 already. The check silently missed every time, so `loadMVMessages` never ran. Combined with v1.6.3 removing the post-send fetch, the user's pane stayed stale forever. Now resolves all four shapes the SDK might use (`d.sessionId`, `d.sessionID`, `ev.properties.sessionID`, `ev.properties.sessionId`).

---

## [1.6.3] — 2026-04-19

### Fixed — Three multi-view UX bugs reported on v1.6.2

- **All panes recreated on every SSE event** — `loadSessions()` was calling `renderMultiviewGrid()` whenever multi-view was active. Since loadSessions runs on every `session.*` SSE event (incoming message, status change, title update), every keystroke from any session wiped ALL panes back to "Loading…" and re-fetched everything. Now loadSessions only updates the sidebar; multi-view panes refresh per-session via `loadMVMessages` from `sse.js`. Trade-off: if a session title changes while pinned in multi-view, the pane header stays stale until it's removed and re-added — acceptable because titles rarely change mid-session.
- **Pane wiped to "No messages yet" right after sending** — `doSend` was calling `loadMVMessages(id)` immediately after the POST. The POST returns before the SDK has persisted the user message, so the fetch returned `[]` and the renderer wiped the pane. SSE delivers `message.updated` within ~100-500ms anyway and `sse.js` already triggers a refresh on it. Removed the post-send fetch.
- **Empty / new sessions showed no agent or model in panes** — both the header badge and the mini strip relied on `session.mode/agent` metadata or a previous assistant message. New sessions have neither. Now both fall back to the default agent (prefers "build", else first available) and the default model from the references registry, rendered at 65-70% opacity to indicate "default, not from history".

---

## [1.6.2] — 2026-04-19

### Fixed

- **Multi-view panes stuck on "Loading…" forever** — `loadMVMessages` was called from inside `createMVPanel` BEFORE the panel was appended to the DOM. Since the loader uses `document.getElementById('mv-msgs-{id}')` to find the message container, it returned `null` and silently no-op'd, leaving the placeholder in place. The loader now runs from `renderMultiviewGrid` after every panel is in the document tree. As a side effect, this also fixes "send from pane doesn't seem to work" — sends were succeeding but the SSE-driven re-render landed on a panel whose initial state machine was wedged. With the initial render fixed, message.updated SSE events now show streaming responses correctly.

---

## [1.6.1] — 2026-04-19

Patch release for 3 bugs reported immediately after v1.6.0 release.

### Fixed

- **`POST /sessions` returned 400 INVALID_JSON** — the new `createSession` validator added in v1.6.0 attempted `req.json()` whenever `Content-Type: application/json` was present, but the dashboard's `createSession()` helper sends that header without a body. Bun's `req.json()` throws on empty body. Now reads `req.text()` first and only parses if non-empty. Regression test added.
- **highlight.js CDN URLs were mangled with `[email protected]`** — `index.html` contained literal `[email protected]` instead of `highlight.js@11.10.0`, likely from a copy-paste from a Cloudflare-protected page that obfuscated the `@` pattern. All 9 script + 1 stylesheet tags fixed. Syntax highlighting in code blocks now works.
- **`GET /instance` returned 404** on every page load — `right-panel.js` called a non-existent `/instance` endpoint as a primary version source, with `/health` as fallback. Removed `fetchInstanceInfo()` entirely and use `fetchHealth()` directly. No more 404 in console.

---

## [1.6.0] — 2026-04-19

### Fixed

- **Sessions list now shows model and provider per row** — agent badge already worked, but `model · provider` never appeared in the list (only in the label-strip + multi-view headers). Each row now fetches its last assistant message in parallel (capped at 50 most-recent sessions, failures swallowed per session) and renders a small mono `model · provider` after the agent badge.
- **Agent badge race on first paint** — if `renderSessions()` ran before `initReferences()` finished, badges fell back to raw names with default colors. `initSessions` now subscribes to `references:ready` and re-renders once references load. Same fix pattern that previously stabilized `label-strip.js`.
- **Multi-view panes stuck on "Loading…"** — when `renderMessageIntoPanel` or the message fetch threw, the pane never recovered. Now both are wrapped in try/catch and replaced with `Failed to load · Retry` (clickable) plus a `console.error` with pane + session id context.
- **Stale `@ts-expect-error` directive** in `push.test.ts:71` triggered TS2578 because an empty-string endpoint is valid TS (only the runtime guard rejects it). Removed the directive, kept a comment explaining intent.

### Changed — Simpler keyboard shortcuts

The Alt-chord soup is gone. Single-key shortcuts now work when no input is focused, modifier shortcuts always work.

| Key | Action |
|-----|--------|
| `?` | Open shortcuts modal |
| `n` | New session |
| `s` | Toggle sidebar |
| `m` | Toggle multi-view |
| `t` | Toggle theme |
| `/` | Focus prompt input |
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+Enter` | Send prompt |
| `Esc` | Close modal/picker/palette |
| `Alt+B`, `Alt+P` | Legacy aliases (kept for muscle memory) |

Removed: `Alt+\``, `Alt+[`, `Alt+]`, `Alt+T`, `Alt+N` — they were rebusque on non-US layouts and most weren't discoverable.

### Added — Robustness pass

- **`apiFetch` wrapper** (`src/server/dashboard/api-fetch.js`) — exponential backoff (250ms → 500ms → 1s → 2s, max 4 attempts) on network errors and 502/503/504/429. Honors `Retry-After` (capped at 5s). Aborts on `AbortSignal`. Throws `ApiError` with `{ url, status, attempts, body }` on exhaustion. GET requests in `api.js` migrated; mutations stay fail-fast to avoid duplicate side effects.
- **Server payload validators** (`src/server/http/validators.ts`) — manual type-guard validators (no Zod dep added) wired into `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/:id/prompt`, `POST /push/subscribe`, `POST /push/test`. Returns 400 with `code: VALIDATION_FAILED` and audits `validation.failed` on bad input.
- **`GET /health`** (no auth) returns `{ status, version, uptime_s, started_at, sse_clients, telegram_ok, push_configured }` for monitoring. Backward-compat fields kept so existing tests pass.
- **17 new integration tests** for auth gating, validation, delete-session roundtrip, payload-size limits, push gating. Total **145 pass / 0 fail** at release.

### Changed — Refactor pass (zero behavior change)

- **`src/server/dashboard/constants.js`** — single source of truth for status classes, agent badge classes, SSE event names, numeric limits, localStorage keys, and the agent-color HSL formula. 50 magic strings/numbers migrated across 8 dashboard files.
- **`renderSessions()` split** — the 140-line god function was carved into `buildSessionGroups`, `renderSessionRow`, `renderSessionGroup`, `wireSessionEvents`, with `renderSessions()` now a ~30-line orchestrator. Public API preserved — every external caller keeps working.
- **`createReference({ fetchFn, key })` factory** in `references.js` — reusable cache+load+get pattern for reference-data endpoints. Migrated `agents` and `mcpStatus`. Providers deferred (multi-field shape needs its own type).
- **`normalizeMessage` consolidation** — audit confirmed all consumers use the shared util. 7 unit tests added for wrapped/flat/null/empty cases. 6 tests added for `createReference` happy path + failure.

### Added — Cost tracking

- **Cost panel** (collapsible, in sidebar) — per-session cost (4 decimals), today's total, this week's total, top-3 sessions today. Reads `cost` from each assistant message defensively (handles `number`, `{total}`, `{input,output,cacheRead,cacheWrite}`, null).
- **Daily budget alert (opt-in)** — Settings field "Daily budget limit ($)". When today's total exceeds the limit, a toast warning fires once per calendar day. Doesn't block sending — informational.
- **History persisted in `localStorage`** under `pilot_cost_history`, structured as `{ "YYYY-MM-DD": { sessions: { id: cost }, total } }`. Quota errors swallowed.

### Added — Pinned TODOs (cross-session)

- **Per-item pin button** appears on hover when a `todowrite` tool result is expanded in the messages pane. Click to pin that TODO item.
- **Sidebar section** above the sessions list, collapsible, with **Active / Done / All** filter tabs. Each pinned item shows a checkbox (toggle done), the text (truncated at 80 chars), source-session link (click to jump), and unpin X button.
- **Persisted in `localStorage`** under `pilot_pinned_todos`. Multi-tab sync via the `storage` event. Capped at 100 items with a confirm prompt to clear done items when full. Dedup via stable `djb2` hash of `text|sessionId`.

### Fixed — CI lockfile (separate commit `eee2e52`)

`bun.lock` was not regenerated when v1.5.0 added the `web-push` dependency, so `bun install --frozen-lockfile` failed in both `publish` and `test` workflows. Lockfile now in sync.

### Changed — Version strings synchronized

`PILOT_VERSION` was stale at `0.4.0` in `src/server/constants.ts`, `0.5.0` in `debug-modal.js`/`right-panel.js`, and the `getStatus` handler hardcoded `0.1.0`. All bumped to `1.6.0`. `getStatus` now reads from the constant.

---

## [1.5.0] — 2026-04-17

### Fixed

- **`/remote` command noise polluted the TUI** — browser launch used `stdout: "inherit"` / `stderr: "inherit"`, so Chromium's `canberra-gtk-module` warning and `CanCreateUserNamespace() EPERM` sandbox message were written directly on top of the OpenCode TUI. Now `/dev/null`'d with `proc.unref()` and a 1.5s fuse so a stuck spawn never blocks the command.
- **Multi-view grid still didn't load chats** — the inline renderer in `loadMVMessages` only handled `p.type === 'text'` parts and ignored reasoning + tool-invocation parts. Messages with only tool calls (common for assistant turns) rendered as empty panes. Now delegates to a shared `renderMessageIntoPanel()` helper exported from `messages.js` that reuses the single-session renderer (text, reasoning, tool calls, agent badge). Cross-project panes also now pass each session's own `directory` to `fetchMessages` instead of the global `activeDirectory`.
- **Live usage/context/cost updates** — tokens, context %, and cumulative cost now refresh live on every `message.updated` / `message.part.updated` SSE event. Previously required leaving the session and coming back. Root cause: `right-panel.js` and `usage-indicator.js` subscribed only to `activeSession` changes and re-rendered with cached zeros on directory change instead of calling `refresh()`.
- **Files changed panel stale on project switch** — `command-palette.js::applyProjectChoice` now calls `refreshFilesChanged(null)` after clearing sessions state, and `sse.js` `tool.completed` refreshes any multi-view panel whose session matches the event's `sessionID`.
- **Sessions grid / multi-view rendered empty** — `multi-view.js::loadMVMessages` was reading `m.role` / `m.parts` directly on raw SDK messages, but the SDK returns `{ info: Message, parts: Part[] }` (wrapped). Now runs `normalizeMessage()` before rendering.
- **Multi-project SSE didn't reconnect on directory switch** — `sse.js::connect` now builds the URL with `?directory=` and a new `activeDirectory` subscription closes and reopens the `EventSource` when the directory changes. Events from the new project context now reach the dashboard without a manual reload.

### Added — Web Push (end-to-end)

Full VAPID-based Web Push implementation. Previous releases announced the feature but only implemented the browser Notification API (local-only toasts).

- **Backend**: `src/server/services/push.ts` — factory with in-memory subscription store, circuit-breaker-wrapped `sendNotification`, auto-prune dead subs on 404/410. Endpoints `GET /push/public-key`, `POST /push/subscribe`, `POST /push/unsubscribe`, `POST /push/test` (all auth-required). Triggered from `notifyPermissionPending` so every permission request fires a push to every subscribed device.
- **Config**: `PILOT_VAPID_PUBLIC_KEY`, `PILOT_VAPID_PRIVATE_KEY`, `PILOT_VAPID_SUBJECT` (default `mailto:admin@opencode-pilot.local`). Push is disabled when either key is missing; `/push/public-key` returns 503 with a clear message so the dashboard can guide the user.
- **Frontend**: `push-notifications.js` now subscribes via `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, sends the subscription JSON to the backend, and re-subscribes silently on next load if previously enabled.
- **Service worker**: added `push` event handler (`showNotification` with Open/Dismiss actions, `requireInteraction: true`) and `notificationclick` handler that focuses an existing dashboard tab or opens `data.url`. Cache bumped to `pilot-v9`.
- **Dev-friendly**: `main.js` SW registration now allows `localhost` / `127.0.0.1` hostnames in addition to HTTPS, per browser PWA spec.

### Added — Glob file opener

Open arbitrary files from the dashboard via glob patterns, opt-in for safety.

- **Config flag**: `PILOT_ENABLE_GLOB_OPENER=true` (default `false`). Endpoints return 403 `GLOB_DISABLED` when off.
- **Endpoints**: `GET /fs/glob?pattern=&cwd=&limit=` uses `new Bun.Glob(pattern).scan()` with mtime-desc sort, default 1000 / max 5000 results. `GET /fs/read?path=` reads UTF-8 content with a 2 MB cap (413 on overflow).
- **Security**: paths are `realpathSync`'d and must resolve under the project directory OR `process.env.HOME`. Non-absolute paths, symlink escapes, missing files, and directories all rejected. Every access audited (`glob.search`, `fs.read`).
- **Frontend**: `file-browser.js` adds a glob search row above the file tree (Enter/Esc keybinds, clear button). Results render as a flat list; clicking opens the file in the existing preview modal.

### Added — `/remote` slash command in OpenCode TUI

Type `/remote` (or `/dashboard`) inside the OpenCode TUI and the web dashboard opens in the default browser with the current pilot token pre-applied. Cross-platform: `open` on macOS, `xdg-open` on Linux, `cmd /c start "" <url>` on Windows (empty title arg protects against special chars in the token). On spawn failure, falls back to a long-duration toast containing the URL for manual copy.

### Added — Session delete (single + bulk)

- `DELETE /sessions/:id` endpoint proxies `client.session.delete({ path: { id }, query: { directory } })`, audits `session.deleted`, handles 404 gracefully. `DELETE` added to `Route.method` union and CORS allow-methods.
- Per-row `×` button on each session item (opacity-0 by default, revealed on hover; `stopPropagation` so click doesn't activate).
- Command-palette actions: "Delete Session" (danger variant, `window.confirm` guard) and "Delete old sessions (>30 days)" (bulk, sequential with progress toast every 5 deletions + final summary).
- `api.js::deleteSession(id, { directory })` helper; `sessions.js::deleteSessionById` cleans up `sessions`, `statuses`, `mvPanels`, `activeSession`, and re-renders the grid.

### Added — Production readiness documentation

- `docs/PRODUCTION_READINESS.md` — honest deploy-mode verdicts (LAN ready, tunnel not ready without rate limit, SaaS not compatible with in-process architecture), 12 prioritized recommendations (rate limiting + token refresh on the MUST list), a cloud-relay pairing architecture sketch, and 5 high-value features to ship next that work with real SDK data (cost tracking, shareable read-only links, offline prompt queue, WebAuthn passkeys, cross-session pinned TODOs).

### Added — TUI parity features

- **Agent badge on sessions list** — colored pill to the left of status, matching the dynamic `hsl()` badge style used in messages. Reused from `agentColorFromName`.
- **Agent badge on subagents panel** — same consistent style, so child sessions from `Task` tool spawn render with their agent identity at a glance.
- **Multi-view pane mini label-strip** — each pane in the sessions grid now shows `agent · model · provider` pulled from the last assistant message, matching the footer label strip.
- **Session rename via command palette** — new "Rename Session" action (icon ✎). Optimistically patches local state, then calls the new `PATCH /sessions/:id` endpoint that proxies `client.session.update({ body: { title } })`. `session.updated` SSE event reconciles any out-of-band renames.

### Changed — Telegram hardening

- **Startup verification** — `telegram.testConnection()` calls `getMe` once on init and logs the result (info/warn). Previously, failures surfaced only when the first permission notification fired.
- **Exponential backoff** — polling loop replaced fixed 5s retry with `[5s, 10s, 30s, 60s]` step list; advances on failure, resets to 0 on success.
- **Audited send failures** — `.catch(() => {})` replaced in `services/notifications.ts` and `http/handlers.ts` (token-rotation path) with `audit.log('telegram.send_failed', { error, kind })`. Silent Telegram failures no longer leave the user guessing.

### Dependencies

- Added `web-push@^3.6.7` (runtime) and `@types/web-push@^3.6.4` (dev). `web-push` is lazy-imported inside `push.ts` so the plugin boots cleanly even before `bun install` has run.

## [1.4.0] — 2026-04-17

### Fixed — CRITICAL root-cause bugs

SDK `client.session.messages()` returns messages as `{ info: Message, parts: Part[] }` — a **wrapped shape**. The dashboard was reading `m.mode`, `m.role`, `m.modelID`, `m.tokens`, `m.cost` on the outer object, getting `undefined` everywhere. This single bug masked as **four different user-visible bugs**:

- **Agent badge never rendered** — `m.mode` was undefined for every assistant message
- **Label strip never showed the real model/provider** — `m.modelID` / `m.providerID` undefined
- **Context / usage / cost always zero** — `.filter(m => m.role === 'assistant')` matched nothing
- **Cumulative cost always `$0.00`** — same filter fail

Fixed by a single `normalizeMessage()` helper that unwraps `{ info, parts }` into a flat shape. Wired into `messages.js`, `label-strip.js`, `usage-indicator.js`, and `right-panel.js` Context block.

### Fixed — Switch Agent / Switch Model actually work end-to-end

- `sessions.js::sendPrompt` called `apiSendPrompt(sessionId, message)` (bare), silently **dropping** the `agent` / `model` preferences stored by the command palette. Swapped to `sendPromptWithOpts` which reads prefs on each send.
- `sendPromptWithOpts` was sending `body.modelID` / `body.providerID` as **flat** fields, but `postSessionPrompt` expects `body.model = { providerID, modelID }` (nested) per SDK `SessionPromptData`. Fixed payload shape.
- Label strip now updates **immediately** on palette pick via `window.__labelStripSetPending({ agent, modelID, providerID })` — shown dimmed with `·` suffix until the next prompt confirms it via `message.updated`.

### Fixed — Open Project didn't actually switch

`applyProjectChoice` called `window.__refreshReferences?.()` without `await`, so `loadSessions()` ran before the new directory's references were fetched — the dashboard would show stale state. Also didn't clear the active session (still pointed at the OLD project's session id). Fixed: clear session + await references refresh + reload sessions, in that order.

### Added — Self-service debug

- **Debug Info modal** (palette action "Show Debug Info") — shows `activeDirectory`, references state (counts of agents / providers / mcp / lsp), active session id + message counts, last AssistantMessage JSON snapshot, SSE status + last event received, pilot + OpenCode versions. File: `dashboard/debug-modal.js`.
- `console.debug('[pilot:data]', ...)` logs added at every significant read point: `api.js::request`, `references.js::refresh`, `label-strip.js::refresh`, `usage-indicator.js::refresh`, `right-panel.js::computeUsage`, `messages.js::renderMsg`. Filter by `[pilot:data]` in DevTools to trace the full data flow.

### Added — File browser (sidebar panel)

- New sidebar section with lazy-loaded tree view from the worktree
- `GET /file/list?path=<relPath>&directory=<path>` and `GET /file/content?path=<absPath>&directory=<path>` — proxy `client.file.list` and `client.file.read`
- Path traversal (`..`) rejected with 403; missing path → 400
- Gitignored files dimmed (`FileNode.ignored`), toggleable via "Show ignored" checkbox
- Click a file → modal with syntax-highlighted content (reuses hljs)
- Max 500 children per directory, truncation indicator if more

### Added — Streaming deltas for assistant messages

- Subscribes to `message.part.updated` SSE events with a `delta` field
- Appends delta to the in-progress text part directly in the DOM — no full message re-render, scroll stays pinned
- Blinking cursor `▎` at the end of streaming text; removed on `message.updated` completion
- Tradeoff: during streaming, text arrives raw (no markdown); markdown is re-applied on the final `message.updated` re-render — matches TUI behavior

### Added — Reasoning panel (Opus / Sonnet thinking)

- Collapsed grey block with prefix `~ thinking` + duration
- Expanded: dimmed monospace with subtle left border
- Settings toggle "Show reasoning by default" — default OFF

### Added — TodoWrite dock

- Persistent strip above the message list driven by the `todo.updated` SSE event
- `☐` pending (muted), `◐` in_progress (accent blue), `☑` completed (strikethrough + fade)
- Auto-hides when list is empty; collapse state persisted in `localStorage`

### Added — Browser push notifications

- Opt-in via settings checkbox "Push notifications for permissions" — requests permission on first enable
- Fires a system `Notification` on `pilot.permission.pending` SSE **only when the tab is hidden** (`document.hidden`)
- Clicking the notification focuses the tab
- "Test" button to verify delivery; gracefully hides when `Notification` API is unavailable (old Safari, some mobile browsers)

### Added — Command history

- `↑` / `↓` in an empty prompt walk a 50-entry ring buffer stored in `localStorage`
- Dedups consecutive duplicates; global (not per-session)
- `Esc` resets the pointer without clearing the input
- Palette action "Clear Prompt History" with confirm

### Changed

- Service worker cache bumped to `pilot-v8`.
- Tests: 89 passing (+7 for `/file/list`, `/file/content` including auth + traversal + missing-param cases).

## [1.3.0] — 2026-04-17

### Added — Multi-project routing (the big one)

- **`?directory=<path>` query-param routing** across every per-project endpoint. OpenCode's HTTP layer auto-boots an instance context for any directory — pilot now forwards the directory from the dashboard to the SDK transparently. One pilot process can serve multiple projects without restarting OpenCode.
- Affected routes: `/sessions*`, `/agents`, `/providers`, `/mcp/status`, `/project/current`, `/lsp/status`, `/tools`. Pilot-owned routes (`/health`, `/auth/rotate`, `/status`, `/permissions`, `/projects`) are unaffected.
- Directory validation on entry: reject path traversal (`..`) and overlong paths (>512 chars) with `400 INVALID_DIRECTORY`.

### Added — Backend

- **`GET /lsp/status`** — proxies `client.lsp.status()`. Returns `{ clients: Array<{ id, name, root, status: "connected" | "error" }> }`.
- Test mock now captures SDK call arguments to assert directory forwarding (`lastListSessionsArgs`, `lastListAgentsArgs`, etc.).
- Mock gained `session.children` (was missing — future-proofed).

### Added — Dashboard

- **Right-side info panel** (`right-panel.js`) matching the OpenCode TUI layout: Session header, Context (tokens / % used / $ spent), **MCP** servers with live status dots (connected / needs-auth / failed / disabled), **LSP** clients populated from `/lsp/status`, worktree Path block with branch, and OpenCode instance indicator with version detection (`● OpenCode local` vs `● OpenCode 1.x.x`).
- **Switch Model** picker in command palette — flattens `providers[].models` from connected providers, highlights the current model, "Default Model" entry at top to clear override.
- **Open Project** picker in command palette — lists all projects from `client.project.list()`, selecting one sets `activeDirectory` in state (persisted to `localStorage`) and reloads sessions/references/MCP/LSP from that project's instance. "Default (back to OpenCode instance)" entry to clear.
- **Footer reorganized to match TUI** — label strip on the left (`Build  GPT-5-mini  GitHub Copilot`), compact usage + `alt+p commands` + `alt+i info` + `?` help on the right. Keymap modal opens via `?` button.
- **`Alt+I`** toggles the right panel (desktop always visible ≥1280px; tablet/mobile overlay).
- Label strip now renders RAW agent/model/provider names when references haven't resolved — no more `—` placeholder for custom agents.
- Usage indicator shows `0 tokens 0% used $0.00` for fresh sessions (was `— — —` forever).
- SSE subscriptions extended: `vcs.branch.updated` updates the right panel's branch display; `lsp.updated` refreshes the LSP block + references cache.
- 30-second poll for `/mcp/status` to catch changes (SDK does not emit MCP events).
- `references.js` dispatches a `references:ready` CustomEvent on first init — label-strip listens once so it re-renders after references resolve (fixes a cold-load race).
- `api.js` gained a `buildUrl()` helper that transparently appends `?directory=<activeDirectory>` to non-exempt calls and preserves existing query strings via `URLSearchParams`.

### Changed

- Service worker cache bumped to `pilot-v6`.
- The old client-side project filter (`window.__applyProjectFilter`, `pilot_active_project` localStorage key) removed — superseded by server-side directory routing and the new `pilot_active_directory` key.
- `sessions.js` folder tree still groups by `Session.directory` — still useful for drilldown within a given directory's sessions.

### Notes

- Tests: 82 passing (+7 from 1.2.0 — 1 LSP auth, 1 LSP with auth, 4 directory-forwarding + traversal + length, 1 agents forwarding).
- `GET /instance` endpoint skipped — `client.instance` is not exposed on `PluginInput["client"]`. Dashboard infers "local" from `/health` response's `version` string instead.
- MCP has no SSE stream in the SDK — dashboard uses a 30s `setInterval` poll to keep the right panel fresh.

## [1.2.0] — 2026-04-17

### Added — Backend

- **`GET /agents`** — proxies `client.app.agents()`; returns `{ agents: Array<Agent> }`. Used by the dashboard to resolve agent colors, descriptions, models, tools, and permissions without hardcoded mappings.
- **`GET /providers`** — proxies `client.provider.list()`; returns `{ all, default, connected }`. Enables resolving model display names and `Model.limit.context` for the usage indicator.
- **`GET /mcp/status`** — proxies `client.mcp.status()`; returns `{ servers: Record<string, McpStatus> }`. Dashboard uses server names to detect MCP-prefixed tool calls (pattern: `sanitize(serverName) + '_' + sanitize(toolName)`).
- **`GET /projects`** — proxies `client.project.list()`; returns `{ projects: Array<Project> }`.
- **`GET /project/current`** — proxies `client.project.current()`; returns `{ project }`. Dashboard header can show the current project label.
- `POST /sessions/:id/prompt` now accepts optional `agent: string` and `model: { providerID, modelID }` in the request body; forwarded to `client.session.prompt`.
- `logger` added to `RouteDeps` so handlers can log without contaminating OpenCode TUI output.

### Added — Dashboard

- **Alt-based keybindings** — `Ctrl+*` → `Alt+*` across the board to avoid browser-level conflicts (`Ctrl+P` = print, `Ctrl+T` = new tab). New bindings:
  - `Alt+P` — command palette (plus `Cmd+K` on macOS)
  - `Alt+N` — new session
  - `Alt+T` — toggle theme
  - `Alt+B` — toggle sidebar
  - `Alt+[` / `Alt+]` — collapse / expand all folders
  - `Ctrl+Enter`, `Esc` — unchanged (muscle memory, no conflicts)
  - Footer shortcut bar is now **tappable** on mobile (each label triggers its action)
- **Folder-based session tree** — sessions grouped by `Session.directory`, collapsible folders with chevron, count badge, path shortening (`$HOME` → `~`, over-long paths collapse to `…/parent/dir`), active-session folder auto-expands and gets a subtle left accent, persisted expand/collapse in `localStorage`, "Switch Folder" action in the command palette.
- **Dynamic agent badges** — agent color comes from the user's actual `opencode.jsonc` / `.opencode/agent/*.md` config via the new `references.js` module. Unknown agents get a deterministic hash-based color. Hover tooltip shows the agent description.
- **Dynamic prompt label strip** — `Build · Claude Opus 4.5 · OpenCode Zen`-style strip now reflects the actual agent + model + provider from the most recent `AssistantMessage` in the selected session. Updates live via `message.updated` SSE events.
- **Usage indicator** in the TUI header — `{input_tokens}  {%context}  (${cumulativeCost})` computed from `AssistantMessage.tokens` and `Model.limit.context`. Tooltip breaks down input / output / cache read / cache write tokens and cost.
- **Agent context panel** (new sidebar panel) — shows the active agent's name, mode badge, model assignment, system prompt (with "show full" toggle), enabled tools, and permission flags. Collapsible. Backed by `client.app.agents()` via `references.js`.
- **OpenCode-style MCP + tool rendering** — tool calls render as compact one-liners with builtin-aware formatters (`* Read src/foo.ts`, `* Grep "pattern" (18 matches)`, `* Bash(cmd) [exit 0]`, `* Edit src/foo.ts +3 -1`, `* Task "fix lint" (agent: build)`, `* TodoWrite 5 items`). MCP tools now detected via the **OpenCode convention** (`sanitize(serverName) + '_' + sanitize(toolName)` against `client.mcp.status()` server names) — not the Claude Code `mcp__` prefix — and rendered as `* [serverName] toolName(...)`.
- **Files changed panel** (new sidebar panel) — parses `GET /sessions/:id/diff`, lists modified files with `+N -N` counts, click a row to open the full diff, refreshes automatically on `tool.completed` for `Write`/`Edit`/`MultiEdit`.
- **Command palette expansions** — new actions: "Switch Folder", "Switch Agent" (mini-picker; stores client-side per-session preference and forwards `agent` in the next prompt via `sendPromptWithOpts`), "Show Agent Context", "Refresh References" (refetch agents/providers/MCP/project after editing `opencode.jsonc`).
- **SSE dot tooltip** — shows last connect time + reconnect attempt count.

### Added — Types

- `PilotEvent` union: additions already shipped in 1.1.0 (`pilot.token.rotated`, `pilot.error`). No new event types this release — the dashboard now subscribes to the full SDK event union (`message.updated`, `message.part.updated`, `session.diff`, `file.edited`, etc.) for live refresh of the dynamic sections.

### Changed

- Service worker cache bumped to `pilot-v4`. Precache list now includes: `command-palette.js`, `files-changed.js`, `files-changed-bridge.js`, `references.js`, `label-strip.js`, `usage-indicator.js`, `agent-panel.js`.
- `RouteDeps` gained `logger: Logger` — internal refactor; no user-facing impact. Test mocks updated.

### Notes

- Tests: 75 passing (+10 from 1.1.0, covering the 5 new SDK passthrough endpoints with and without auth).
- The "dynamic" surface (agent badges, model/provider labels, usage indicator, agent panel) degrades gracefully when the SDK endpoints are unavailable — empty states instead of errors.
- MCP tool identification is **client-side** — the `ToolPart` has no `mcpServer` field; the dashboard infers it by comparing against known MCP server prefixes.

## [1.1.0] — 2026-04-17

### Added — Robustness

- **Circuit breaker** (`src/server/util/circuit-breaker.ts`) — closed → open → half-open state machine wrapping the Telegram bot. When the external service fails `maxFailures` times, the circuit opens and further calls are short-circuited until `resetMs` elapses. 10 unit tests covering every transition.
- **Global error traps** (`process.on('uncaughtException' | 'unhandledRejection')`) — write to audit log + file logger (never stdout/stderr, which the OpenCode TUI renders as red noise), emit a `pilot.error` SSE event for the dashboard, and deliberately do **not** crash the plugin.
- **Input validation** (`src/server/http/validation.ts`) — hand-written schema guards for JSON bodies (no new runtime dep). Bad input returns `400 { error, details }` with accumulated field errors. 13 validator tests + handler hardening on `POST /sessions/:id/prompt`.
- **Fetch timeouts** — all external HTTP calls (Telegram API) wrapped with `AbortController` + timeout. Configurable via `PILOT_FETCH_TIMEOUT_MS` (default `10000`).
- **`GET /health`** (no auth) — returns `{ status, uptimeMs, version, services: { tunnel, telegram, sdk } }`. Used for liveness checks.
- **Audit log rotation** — size-based, 5 MB threshold, `.1 → .2 → .3` shift, drops `.3`. Throttled to every 50 writes to avoid `stat()` overhead.
- **`POST /auth/rotate`** (auth required) — generates a new 32-byte token, invalidates the old one in place, writes the state file, emits `pilot.token.rotated` with the new connect URL, and notifies Telegram (when enabled).

### Added — Dashboard TUI rework

- **TUI look** — dark purple palette (`#1e1b2e` base, `#26223a` panels, `#3a3550` borders), monospace everywhere, macOS traffic-light chrome (decorative), slimmer padding, higher information density. Accent colors: blue for agent/active, green for success, red for errors, purple for subagents.
- **Message prefixes** — `*` for tool calls, `→` for reads/writes, `~` for reasoning states. Flat list layout replacing per-message boxes.
- **Footer shortcuts bar** — always visible: `esc interrupt` left, `ctrl+t variants | tab agents | ctrl+p commands` right.
- **Prompt composer** — fixed at the bottom with a label strip underneath (`Build · Claude Opus 4.5 · OpenCode Zen` style).
- **Command palette** (`ctrl+p` / `cmd+k`) — fuzzy-searchable over sessions, subagents, and actions: new prompt, copy session ID, TUI resume, toggle theme, toggle sound, toggle tools, scan QR, **rotate token** (calls `POST /auth/rotate` and auto-reconnects with the new token). Primary navigation replaces the multi-session grid as the default switcher (grid still available from the sidebar button).
- **Responsive layout** — desktop (≥1024px) full TUI with toggleable sidebar (`ctrl+\``); tablet (≥640px) sidebar as overlay; mobile (<640px) single column with collapsible shortcut chips, font-size steps down from 13px → 12px.

### Added — Dashboard robustness

- **SSE exponential backoff reconnect** — 1s → doubles → 30s cap, resets on successful open. Header shows a visible status indicator (green dot = live, yellow = reconnecting).
- **Per-panel error boundaries** — `messages`, `subagents`, `permissions`, `diff`, and markdown renderers are now wrapped so a single throw no longer nukes the whole UI. Failed panels show a fallback `⚠ Panel failed to render [Retry]` state.

### Changed

- `PilotEvent` discriminated union now includes `pilot.token.rotated` and `pilot.error` (previously emitted via passthrough cast).
- Service worker cache bumped to `pilot-v2` — precaches `command-palette.js` and the updated styles; forces clean install on activation.
- PWA `manifest.json` `background_color` / `theme_color` updated to `#1e1b2e` to match the new palette.
- `hljs` theme switched from `github-dark` to `base16/monokai` for better contrast on purple.

### Deferred (needs backend work later)

- Header **token/cost indicator** (the `39,413  20%  ($0.29)` strip) — DOM slot exists but the SDK does not yet surface per-session token usage via SSE or any handler. Wire when the SDK exposes it.
- **Input label strip** model/provider text — currently a static placeholder; will become dynamic once the SDK exposes the active model/agent per session.

### Test count

- Unit/integration tests: 65 passing (32 new in this release: 10 circuit-breaker, 13 validation, 6 audit-rotation, 3 `/health` integration).

## [1.0.0] — 2026-04-16

### Changed
- **Auth flow simplified** — dashboard no longer prompts for token paste. Token arrives via QR URL (`?token=`), is stored in `localStorage` (persists across tabs and restarts), and the URL is scrubbed. If no token is found, a "No token" screen with a "Try again" button is shown — never a manual form.
- `resolveToken()` now rejects with `NO_TOKEN` instead of rendering a fallback gate.

### Added
- **Session ID prominence** — active session shows the full ID in a monospace `<code>` block with a Copy button and a TUI hint: `opencode --session <ID>`.
- **Agent type badges** — assistant messages and the session header show a colored badge with the agent mode (`plan` blue, `build` green, other `custom` gray). Reads `message.mode` and `session.agent` / `session.mode`.
- **Subagents panel** — collapsible panel listing child sessions with Open and Copy ID actions. Backed by a new `GET /sessions/:id/children` endpoint. Refreshes live via the new `pilot.subagent.spawned` SSE event emitted from the `tool.execute.before` hook when the Task tool is invoked.
- `docs/TESTING.md` — step-by-step smoke test guide for a real OpenCode project (389 lines).
- `docs/ARCHITECTURE.md` — system overview, Mermaid diagrams, component map, security model, extension recipes (359 lines).
- README: `Installation` section with three paths (npm future, GitHub clone, local dev) + path-resolution warning for `.opencode/opencode.jsonc` configs.
- README: `Troubleshooting` section covering silent-fail on wrong path, port 4097 conflict, missing tunnel binary, Telegram env var gotchas, and the historical Bun `idleTimeout` SSE drop.
- `.github/workflows/ci.yml` — typecheck + tests + lint on PR/push to `main`, with Bun install cache.
- `.github/workflows/release.yml` — tag-driven npm publish with provenance + GitHub Release from `CHANGELOG.md` (requires `NPM_TOKEN` secret).
- `src/server/http/server.test.ts` — 10 end-to-end HTTP tests (auth, sessions, tools, permissions, 404, SSE keepalive, dashboard HTML, CORS preflight).

### Notes
- Version bumped to `1.0.0` — the plugin is now feature-complete for remote control and safe to publish once the `NPM_TOKEN` secret is set and the repository is made public.

## [0.4.0] — 2025-04-15

### Changed
- Refactored architecture: dashboard split into focused modules (`messages.js`, `multi-view.js`, `sessions.js`, etc.)
- Extracted `constants.ts` as single source of truth for magic numbers and version string
- Added `util/logger.ts` wrapper around `ctx.client.app.log` for cleaner service code
- Fixed tool parts rendering: correctly reads `part.state.input`, `part.state.output`, `part.state.error`, and `part.state.title` from OpenCode SDK `ToolState` shape instead of the legacy `part.args`/`part.result` fields
- Tool blocks now auto-expand for running/error states and auto-collapse for completed/pending
- Tool block header now shows a status icon (⏳🔄✓❌) and title when available

### Added
- Tests for `util/auth`, `config`, `services/permission-queue`, and `http/auth`
- `LICENSE` file (MIT)
- `CHANGELOG.md` (this file)
- `package.json`: `files` array, `repository`/`bugs`/`homepage` fields, `test` script

## [0.3.0] — 2025-03-10

### Added
- Cloudflare Tunnel and ngrok tunnel support (`PILOT_TUNNEL`)
- Telegram bot integration with inline approve/deny buttons (`PILOT_TELEGRAM_TOKEN` + `PILOT_TELEGRAM_CHAT_ID`)
- Rich dashboard UI with syntax-highlighted messages, diff view, and permission panel
- Multi-session split view in the dashboard
- QR code in banner file for easy mobile pairing
- Unified notification service (`services/notifications.ts`)
- Audit log (`services/audit.ts`)

## [0.2.0] — 2025-02-05

### Added
- Web dashboard served at `GET /` (single-page app, no build step)
- QR code pairing: banner printed to `.opencode/pilot-banner.txt` at startup
- SSE event stream at `GET /events` with keepalive
- Session diff endpoint (`GET /sessions/:id/diff`)
- Session abort endpoint (`POST /sessions/:id/abort`)

## [0.1.0] — 2025-01-15

### Added
- Initial release: HTTP + SSE server as an OpenCode plugin
- Endpoints: `/status`, `/sessions`, `/sessions/:id/messages`, `/sessions/:id/prompt`
- Permission queue: remote approve/deny via `/permissions/:id`
- Auth token generated at startup (32-byte hex, Bearer scheme)
- Binds to `127.0.0.1` by default (localhost-only for security)
- `PILOT_PORT`, `PILOT_HOST`, `PILOT_PERMISSION_TIMEOUT` env vars
