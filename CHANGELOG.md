# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
