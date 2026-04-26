# dashboard

**Purpose:** Browser SPA served by `transport/http/` as static files — the remote-control UI that runs on the user's phone or second machine.

## Imports (dependency rule)
- May import from: NOTHING (browser runtime — no backend imports allowed)
- May NOT import from: any `src/` TypeScript module

## Key files
- `index.html` — SPA entry point; `var GEN = "x.y.z"` must match `PILOT_VERSION` (enforced by `__tests__/asset-sanity.test.ts`)
- `main.js` — bootstraps the app and wires all components
- `sw.js` — service worker; `__PILOT_CACHE_VERSION__` placeholder is templated by the server on each request
- `constants.js` — shared browser-side constants
- `api/api.js` — REST client against the pilot HTTP server
- `api/api-fetch.js` — fetch wrapper with auth headers
- `state/state.js` — reactive client-side state
- `sse/sse.js` — `EventSource` wrapper for the `/events` stream
- `auth/` — token management and connect-modal flow
- `components/` — domain UI components (sessions, permissions, settings, etc.)
- `modals/` — overlay dialogs (connect, debug, help)
- `ui/` — low-level UI utilities (diff, push notifications, shortcuts, toast, sound)
- `routing/hash-dir-router.js` — hash-based SPA router
- `__tests__/asset-sanity.test.ts` — **release pre-flight regression guard**: recursively scans all `.js` files for hardcoded `PILOT_VERSION` strings and checks version consistency across the three canonical locations
- `__tests__/cost-pinned.test.ts`, `normalizeMessage.test.ts`, etc. — unit tests for browser-side logic

## Conventions specific to this folder
- Plain `.js` — no TypeScript in the browser bundle (TS migration is a future round).
- `HANDOFF.md` documents the dashboard's internal architecture separately from this file.
- The service worker (`sw.js`) uses `__PILOT_CACHE_VERSION__` as a placeholder; the server replaces it per response, so the browser always caches the right version.

## DO NOT
- Import from backend `src/` modules — this code runs in the browser.
- Hardcode `PILOT_VERSION` directly in any `.js` file — the asset-sanity test will catch it and fail the release gate.

## See also
- `docs/ARCHITECTURE.md` — overall architecture
- `src/transport/AGENTS.md` — `transport/http/handlers/system.ts` serves these files as static assets
