# tui

**Purpose:** OpenCode TUI plugin — registers slash commands (`/remote`, `/pilot-token`, `/remote-control`) and event listeners inside the OpenCode TUI session.

## Imports (dependency rule)
- May import from: Node.js built-ins, `@opencode-ai/plugin/tui`, `@opencode-ai/plugin`
- Does NOT import from `core/` or `infra/` — by design (see note below)
- May NOT import from: `transport/`, `integrations/`, `notifications/`, `server/`

> **Note:** `tui/paths.ts` intentionally duplicates the XDG path logic from `infra/paths/index.ts`. This is documented in `tui/paths.ts` itself: the TUI and server run in separate Bun instances / bundle contexts; importing across that boundary would create a hard coupling that breaks independent bundling.

## Public API (what other modules consume from here)
- `export default { id: "opencode-pilot-tui", tui }` — the TUI plugin handle consumed by OpenCode via `@opencode-ai/plugin/tui`
- `cli/init.ts` imports `getPluginStateDir / stateFile` from `tui/paths.ts` (path utilities shared between TUI and CLI)

## Key files
- `index.ts` — the TUI plugin; registers commands and event listeners
- `liveness.ts` — `isServerAlive`, `probeHealth`, `defaultProbeTarget` — HTTP health check before reading state
- `paths.ts` — XDG-aware path helpers (intentional duplication of `infra/paths`; see note above)
- `types.ts` — `PilotState` shape
- `url-builder.ts` — `buildDashboardUrl()` — constructs the full dashboard URL with `?directory=` param
- `__tests__/` — unit tests for liveness, URL builder, and command dead-state handling

## Conventions specific to this folder
- Loaded via `@opencode-ai/plugin/tui` — a **different export** from the server plugin (`@opencode-ai/plugin/server`). They must NOT share an export entry point.
- Plugin `id` is `"opencode-pilot-tui"` — distinct from the server plugin's `"opencode-pilot"` to avoid OpenCode silently deduplicating them.

## DO NOT
- Import from `server/` or any backend module — the TUI plugin may run in a separate process.
- Share the TUI export path with the server plugin — OpenCode's loader would drop one silently.

## See also
- `docs/ARCHITECTURE.md` — overall architecture
- `src/cli/AGENTS.md` — `cli/init.ts` reuses `tui/paths` for XDG path resolution
