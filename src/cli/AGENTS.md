# cli

**Purpose:** `opencode-pilot init` binary — the install/uninstall command users run with `npx` or `bunx` to wire the plugin into their OpenCode config.

## Imports (dependency rule)
- May import from: Node.js built-ins only (by design — must work before `node_modules` is installed)
- **Deviation:** `init.ts` imports `getPluginStateDir / stateFile` from `../tui/paths` instead of `infra/paths`. This is intentional: `tui/paths` is self-contained (no transitive deps), `infra/paths` could pull in more of the build graph. The deviation is safe for a single-file binary.
- May NOT import from: `core/`, `transport/`, `integrations/`, `notifications/`, `server/`

## Public API (what other modules consume from here)
- Nothing — this is a binary entry point, not a library.
- The binary is referenced in `package.json` under `bin` as `opencode-pilot`.

## Key files
- `init.ts` — the entire install logic: locates OpenCode config dir, installs the npm package, adds the plugin spec, removes stale wrappers from older installs, invalidates OpenCode's package cache
- `init.test.ts` — unit tests for the init logic

## Conventions specific to this folder
- Single-file, minimal deps — must work the instant `npx` downloads it, before any install step.
- Cleans up stale wrappers from `<=1.12.x` installs (port-4097 collision, TUI wrapper rejection).

## DO NOT
- Add imports from `core/`, `transport/`, or any module that requires a built project.
- Split into multiple files without ensuring the binary still self-contains everything it needs.

## See also
- `docs/ARCHITECTURE.md` — overall architecture
- `src/tui/AGENTS.md` — `tui/paths` is the shared path utility used by both TUI and CLI
