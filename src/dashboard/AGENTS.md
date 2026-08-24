# dashboard

**Purpose:** Browser SPA served by `transport/http/` as static files — the remote-control UI that runs on the user's phone or second machine.

## Imports (dependency rule)
- May import from: NOTHING (browser runtime — no backend imports allowed)
- May NOT import from: any `src/` TypeScript module

## Key files
- `index.html` — SPA entry point; its `__PILOT_ASSET_GENERATION__` placeholder is replaced from the package version by the local server or Pages deployment
- `bootstrap.js` — external pre-module cache/theme/decorations bootstrap; keeps the dashboard compatible with `script-src 'self'`
- `components/messages.js` — message + part renderer. `renderFilePart(part, sessionId, messageId)` proxies raster images through `GET /sessions/:id/attachments/:partId`. Active SVG documents are excluded from both client and server safelists. The `?token=` query param is required for `<img>` tags which cannot send Bearer headers.
- `main.js` — bootstraps the app and wires all components
- `sw.js` — service worker; `__PILOT_CACHE_VERSION__` placeholder is templated by the server on each request
- `constants.js` — shared browser-side constants
- `api/api.js` — REST client against the pilot HTTP server; preserves response request IDs on surfaced errors
- `api/api-fetch.js` — fetch wrapper with auth headers
- `state/state.js` — reactive client-side state
- `sse/sse.js` — reconnecting `/events` client; forwards the last event ID, deduplicates bounded replay, detects host generations/offline state, applies jittered backoff, and reconciles canonical snapshots
- `sse/protocol.js` — rejects explicitly incompatible event protocols and presents a persistent reload action while allowing legacy servers with no advertised version
- `auth/` — legacy-token migration plus short-lived device pairing and credential storage
- `components/` — domain UI components (sessions, permissions, settings, etc.)
- `components/permission-response.js` — exactly-once client gate that prevents permission double-taps and stale queue removal
- `components/questions.js` / `questions-model.js` — accessible mobile question sheet and validated ordered OpenCode v2 answers
- `components/markdown.js` — renders agent-controlled Markdown through the vendored DOMPurify allowlist before any HTML sink
- `state/project-context.js` / `status-normalize.js` — concrete initial-project selection and OpenCode v2 status normalization
- `components/activity-center.js` — local-first attention inbox for unresolved permissions, failures, and recent completions
- `components/activity-store.js` / `attention-reconcile.js` — bounded, deduplicated local activity persistence plus project-scoped canonical reconciliation after SSE replay loss; never stores raw error output or clears attention for another project
- `modals/device-manager.js` — admin device list, role/name editing, current-device marker, and individual revocation UI
- `modals/debug-modal.js` — accessible diagnostics panel backed by the protected, secret-free `/diagnostics` snapshot
- `components/latest-request.js` — generation gate used to prevent stale asynchronous responses from committing UI state
- `modals/` — overlay dialogs (connect, debug, help)
- `ui/` — low-level UI utilities (diff, push notifications, shortcuts, toast, sound)
- `routing/hash-dir-router.js` — hash-based SPA router
- `__tests__/asset-sanity.test.ts` — **release pre-flight regression guard**: recursively scans all `.js` files for hardcoded `PILOT_VERSION` strings and checks runtime/hosted version injection
- `tokens.css` — **vendored** design tokens from `lesquel/remote-control-landing@<sha>`; DO NOT edit by hand — re-run `scripts/sync-design-tokens.ts` to update. **Authoritative source for palette tokens** (color, typography, radius). Loaded after `styles.css` in `index.html` so its `:root` declarations win via cascade. `styles.css` must NOT redefine `--bg*`, `--line*`, `--fg*`, `--accent`, `--mono`, `--radius`, `--warn`, or `--danger` — those belong to `tokens.css` exclusively. The 4 themes are `terminal-green` (default, `:root`), `amber`, `violet`, and `mono-light` — each as a `[data-theme="..."]` block.
- `vendor/` — pinned, self-hosted browser dependencies. See `vendor/README.md`; do not replace these with CDN scripts because this dashboard holds remote-control credentials.
- `ui/theme.js` — **theme module** (added v1.20): exports `THEMES`, `THEME_LABELS`, `STORAGE_KEY`, `applyTheme`, `getActiveTheme`, `cycleTheme`. All theme changes must go through this module. The active theme is stored in `localStorage['pilot-theme']` — the same key the landing page uses, enabling shared state on the same origin. `bootstrap.js` sets `[data-theme]` synchronously before the first paint; subsequent changes go through `applyTheme()`. Do NOT write a `theme` field into `pilot_settings` — theme is no longer part of the shared settings state. The body decoration toggles (grid background, scanlines overlay) follow the same naming convention: `localStorage['pilot-grid']` and `localStorage['pilot-scanlines']` (`"1"` / `"0"`), applied via `body[data-grid]` and `body[data-scanlines]` attributes that activate the corresponding CSS rules in `styles.css`.
- `__tests__/cost-pinned.test.ts`, `normalizeMessage.test.ts`, etc. — unit tests for browser-side logic
- `__tests__/file-part.test.ts` — unit tests for `renderFilePart` (added v1.21): verifies raster safelist output, SVG/unknown-mime link fallback, and URL construction with `?messageId=` and `?token=`

## Conventions specific to this folder
- Plain `.js` — no TypeScript in the browser bundle (TS migration is a future round).
- `HANDOFF.md` documents the dashboard's internal architecture separately from this file.
- The service worker (`sw.js`) uses `__PILOT_CACHE_VERSION__` as a placeholder; the server replaces it per response, so the browser always caches the right version.
- The self-heal generation in `index.html` uses `__PILOT_ASSET_GENERATION__`; both the local server and Pages workflow must replace it from the package version.

## DO NOT
- Import from backend `src/` modules — this code runs in the browser.
- Hardcode `PILOT_VERSION` directly in any `.js` file — the asset-sanity test will catch it and fail the release gate.
- Serve or render active SVG documents inline; keep them outside the attachment safelists unless a dedicated sanitizer and threat model are added.

## See also
- `docs/ARCHITECTURE.md` — overall architecture
- `src/transport/AGENTS.md` — `transport/http/handlers/system.ts` serves these files as static assets
