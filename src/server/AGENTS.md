# server

**Purpose:** Composition root and façade for the `./server` npm export — the single file that wires all 8 modules together and returns the OpenCode plugin handle.

## Imports (dependency rule)
- `server/index.ts` is the ONLY file in the project allowed to import from ALL layers.
- `server/config.ts` and `server/constants.ts` import from `core/` and (for config) nothing else.
- Other modules (`transport/`, `integrations/`, `notifications/`, `infra/tunnel/`) currently import from `server/constants` and `server/config` directly — those are documented violations tracked for future cleanup.

## Public API (what other modules consume from here)
- External consumers via `@lesquel/opencode-pilot/server` — receives the OpenCode `Plugin` handle.
- `Config` type + `loadConfigSafe / mergeStoredSettings / resolveSources` — (`config.ts`) consumed by `transport/` and `notifications/` (violation of strict layering; tracked).
- `PILOT_VERSION` and all shared constants — (`constants.ts`) consumed by `transport/`, `notifications/`, `integrations/`, `infra/tunnel/` (violations; tracked).
- Internal modules do NOT import from `server/` in the intended design — data flows inward via dependency injection, not outward imports.

## Key files
- `index.ts` — THE composition root; 7 named sections (ENV+CONFIG → CORE → NOTIFICATIONS → STATE+BANNER → TRANSPORT → INTEGRATIONS → START → PLUGIN HANDLE); shutdown order is documented here
- `config.ts` — `loadConfigSafe`, `mergeStoredSettings`, `resolveSources`; config priority: shell env > `~/.opencode-pilot/config.json` > `.env` > defaults
- `constants.ts` — `PILOT_VERSION`, `DEFAULT_PORT`, all magic numbers; **path is hard-referenced by the release script — do NOT move or rename this file**
- `config.test.ts` — unit tests for config parsing and merging

## Conventions specific to this folder
- `PILOT_VERSION` in `constants.ts` must be bumped in sync with `package.json::version` and `dashboard/index.html` `var GEN` on every release (enforced by `__tests__/asset-sanity.test.ts`).
- Shutdown order in `index.ts` is non-negotiable: integrations → server → tunnel → notifications → clearState.

## DO NOT
- Let other modules import from `server/index.ts` — it is the composition root, not a library.
- Move `constants.ts` — the release script references it by absolute path.
- Add business logic here — orchestrate existing factories, do not implement new domain rules.

## See also
- `docs/ARCHITECTURE.md` — composition root section (7 named phases) and shutdown order
- `AGENTS.md` §4 — the three-file version bump rule for releases
