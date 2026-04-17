# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
