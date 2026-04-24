# Design: project-state-opt-in

## Technical Approach

Thread a new `Config.projectStateMode` (`"off" | "auto" | "always"`, default `"auto"`) from `loadConfig` through `activatePrimary` into both `writeState` and `writeBanner`. A single shared predicate `shouldWriteProjectState(directory, mode)` exported from `state.ts` decides whether the per-project branch runs; `auto` uses `existsSync(join(directory, ".opencode"))` and never creates the directory. Global writes (`~/.opencode-pilot/...`) are unaffected and remain the always-on TUI fallback. Settings UI, shell-env pinning, and 409 `SHELL_ENV_PINNED` come for free by adding the field to `PERSISTED_KEYS`, `sanitize`, `ENV_KEY_MAP`, and `validateSettingsPatch`. Strict TDD: every behavior is RED-first; new `banner.test.ts` is created before the production change.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| 1 | `clearState` mode-awareness | Leave unchanged — keep catch-all `unlinkSync` + swallowed ENOENT for both paths | (a) Skip project unlink when `mode !== "always"`; (b) Pass `mode` into `clearState` | Behavior is already idempotent. Adding mode plumbing buys nothing observable, expands the signature, and breaks existing call sites. ENOENT-on-never-written-file is a no-op. |
| 2 | `RESTART_REQUIRED_FIELDS` membership | EXCLUDE `projectStateMode` | Include it | The mode is consumed only at the next `activatePrimary` write. There is no in-memory cache, no open file handle, no bound resource depending on the value. Existing already-written per-project files are harmless under any mode (TUI still prefers them). Runtime PATCH is safe. |
| 3 | Helper location | Export `shouldWriteProjectState` from `state.ts` | (a) New `services/project-state-mode.ts` module; (b) Inline in each writer | `banner.ts` already imports from `state.ts` indirectly via `util/paths` and the `.opencode/` concern is shared by exactly two callers. A new module would be premature abstraction. Single export keeps the module count flat and the predicate trivially testable in isolation. Revisit if a third caller appears. |
| 4 | Default mode | `"auto"` | `"always"` (preserve legacy), `"off"` (most conservative) | `auto` matches user intent: write when there's already an `.opencode/` (the user opted in by having OpenCode artifacts there); skip otherwise. `always` is the regression we are fixing (issue #2). `off` would silently disable per-project files for users who depend on them. |
| 5 | Default param value in writers | `mode = "auto"` in `writeState` and `projectStateMode = "auto"` in `BannerOptions` | Required param | Existing tests and any internal call sites compile unchanged. The runtime path always passes the explicit `config.projectStateMode`, so the default only matters for tests. |
| 6 | Predicate signature | `shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean` (sync, no I/O for off/always) | Async + stat-based existence; accept `Pick<Config, ...>` | Sync `existsSync` matches the surrounding code (`safeRead`, `existsSync` in index.ts). No async cascade required — `writeState` itself is sync. Direct args (no Config dep) keeps the helper independent and testable. |
| 7 | Fix unguarded `join` in `banner.ts` | Replace bare `safeWrite(join(directory, ".opencode", ...))` with `if (shouldWriteProjectState(directory, mode)) try { safeWrite(...) } catch {}` | Add a separate guard helper; defer to a future patch | The predicate already guarantees `directory` is a valid string for `auto`/`always`; for `off` the branch is skipped entirely. Wrapping the call in a try/catch matches the defensive pattern from `writeState`. Same PR, no scope creep. |

## Data Flow

```
shell env (PILOT_PROJECT_STATE)  ─┐
                                  ├─→ mergeStoredSettings ─→ loadConfig ─→ Config.projectStateMode
~/.opencode-pilot/config.json ────┘                                              │
                                                                                 ▼
                                                                        activatePrimary(ctx)
                                                                                 │
                              ┌──────────────────────────────────────────────────┤
                              ▼                                                  ▼
                writeState(ctx.directory, state, mode)            writeBanner({ directory, ..., projectStateMode: mode })
                              │                                                  │
                              ▼                                                  ▼
                shouldWriteProjectState(dir, mode)                 shouldWriteProjectState(dir, mode)
                  ├─ false → SKIP project write                     ├─ false → SKIP project write
                  └─ true  → writeOne(projectStatePath(dir))        └─ true  → safeWrite(join(dir, ".opencode", "pilot-banner.txt"))
                              │                                                  │
                              ▼                                                  ▼
                writeOne(globalStatePath())   [ALWAYS]            safeWrite(globalBannerPath())   [ALWAYS]
```

PATCH `/settings` flow:

```
PATCH /settings  ─→ validateSettingsPatch (three-way union check)
                 ─→ if shellEnv["PILOT_PROJECT_STATE"] is set ─→ 409 SHELL_ENV_PINNED
                 ─→ else settingsStore.save({ projectStateMode })  ─→ persisted; takes effect on next boot/promotion
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/server/constants.ts` | Modify | Add `export const DEFAULT_PROJECT_STATE_MODE = "auto"` |
| `src/server/services/state.ts` | Modify | Add `ProjectStateMode` type; add `shouldWriteProjectState(directory, mode)`; extend `writeState(directory, state, mode = "auto")` to gate the project branch via the helper |
| `src/server/services/banner.ts` | Modify | Add `projectStateMode?: ProjectStateMode` to `BannerOptions`; gate the project-path `safeWrite` via `shouldWriteProjectState`; wrap the call in try/catch (closes the unguarded-`join` gap) |
| `src/server/config.ts` | Modify | Add `projectStateMode: ProjectStateMode` to `Config`; add `parseProjectStateMode`; add `projectStateMode: "PILOT_PROJECT_STATE"` to `ENV_KEY_MAP`; update `loadConfig`, `projectConfigToSettings`; do NOT add to `RESTART_REQUIRED_FIELDS` |
| `src/server/services/settings-store.ts` | Modify | Add `projectStateMode?: "off" \| "auto" \| "always"` to `PilotSettings`; append to `PERSISTED_KEYS`; extend `sanitize` with three-way union check (mirrors `tunnel`) |
| `src/server/http/validators.ts` | Modify | Extend `validateSettingsPatch` with `projectStateMode` three-way union branch |
| `src/server/http/handlers.ts` | No change | Existing pipeline (`getEffectiveSettings`, PATCH 409 path, `envKeyFor`) handles the new field automatically once the surrounding modules know about it |
| `src/server/index.ts` | Modify | Pass `config.projectStateMode` to both `writeState` and `writeBanner` in `activatePrimary` |
| `src/server/services/state.test.ts` | Modify | Add tests for `shouldWriteProjectState`; add `writeState` cases for `off` / `auto`-no-dir / `auto`-with-dir / `always`; assert directory NOT created in `off` and `auto`-no-dir |
| `src/server/services/banner.test.ts` | Create | NEW file; mirror state matrix; assert per-project banner write only happens per the predicate; verify global banner ALWAYS written |
| `src/server/config.test.ts` | Modify if exists, else Create | Cover `parseProjectStateMode` (default `"auto"`, accepts `off`/`auto`/`always`, rejects garbage); verify `loadConfig` reads `PILOT_PROJECT_STATE` |
| `CLAUDE.md` | Modify | Add `PILOT_PROJECT_STATE` row to the Config table |
| `docs/CONFIGURATION.md` | Modify | Document the three modes with concrete examples and the `auto` rationale |
| `CHANGELOG.md` | Modify | Add entry: "feat(state): add `PILOT_PROJECT_STATE` (off/auto/always); default `auto` no longer creates `.opencode/` in fresh workspaces" |

## Interfaces / Contracts

```ts
// src/server/services/state.ts
export type ProjectStateMode = "off" | "auto" | "always"

export function shouldWriteProjectState(
  directory: string,
  mode: ProjectStateMode,
): boolean

export function writeState(
  directory: string,
  state: PilotState,
  mode?: ProjectStateMode,    // defaults to "auto" for back-compat
): WriteStateResult

// src/server/services/banner.ts
export interface BannerOptions {
  localUrl: string
  publicUrl: string | null
  token: string
  directory: string
  pwaUrl?: string | null
  projectStateMode?: ProjectStateMode    // defaults to "auto"
}
export function writeBanner(opts: BannerOptions): Promise<string>

// src/server/config.ts
export interface Config {
  // ...existing fields...
  projectStateMode: ProjectStateMode
}
function parseProjectStateMode(raw: string | undefined): ProjectStateMode

// src/server/services/settings-store.ts
export interface PilotSettings {
  // ...existing fields...
  projectStateMode?: "off" | "auto" | "always"
}

// src/server/constants.ts
export const DEFAULT_PROJECT_STATE_MODE = "auto" as const
```

Predicate semantics (the contract every consumer relies on):

```ts
function shouldWriteProjectState(directory, mode) {
  if (mode === "off") return false
  if (mode === "always") return true
  // auto:
  if (typeof directory !== "string" || directory.length === 0) return false
  return existsSync(join(directory, ".opencode"))
}
```

## Testing Strategy

Strict TDD active. RED-first ordering, all `*.test.ts` co-located, runner is `bun test`.

| REQ | Layer | What | How (RED first) |
|-----|-------|------|-----------------|
| REQ-WRT-OFF | unit | `writeState`/`writeBanner` skip project write when mode=`off` | tmp dir via `mkdtempSync(join(tmpdir(), "pilot-..."))`; call writer with `mode="off"`; assert `existsSync(join(dir, ".opencode"))` is false AND `existsSync(globalStatePath())` is true |
| REQ-WRT-AUTO-NODIR | unit | `auto` + no `.opencode/` → no project write, no dir created | fresh tmp dir; assert `.opencode/` is NOT created |
| REQ-WRT-AUTO-WITHDIR | unit | `auto` + pre-existing `.opencode/` → project write happens | tmp dir + `mkdirSync(join(dir, ".opencode"))`; assert project file present |
| REQ-WRT-ALWAYS | unit | `always` writes project file even if dir absent | fresh tmp dir; assert dir + file created (legacy behavior) |
| REQ-WRT-PREDICATE | unit | `shouldWriteProjectState` is pure and table-driven | matrix: `(off, *)`, `(always, *)`, `(auto, dir absent)`, `(auto, dir present)`, `(auto, "" or null directory)` |
| REQ-WRT-CLEARSTATE | unit | `clearState` does NOT throw after skipped project write | run `writeState(dir, s, "off")` then `clearState(dir)`; assert no throw |
| REQ-WRT-BANNER-GUARD | unit | `writeBanner` no longer crashes on invalid `directory` | call with `directory: ""` and `mode="auto"` → returns banner string; project write skipped silently |
| REQ-CFG-PARSE | unit | `parseProjectStateMode` accepts off/auto/always, defaults to `auto`, throws `ConfigError` on unknown | call directly with each input |
| REQ-CFG-LOAD | unit | `loadConfig({ PILOT_PROJECT_STATE: "off" }).projectStateMode === "off"` | call `loadConfig` with synthetic env |
| REQ-CFG-MERGE | unit | stored `projectStateMode` flows through `mergeStoredSettings` unless shell env present | inject `shellEnv["PILOT_PROJECT_STATE"]="always"` and stored=`{projectStateMode:"off"}` → effective is `always` |
| REQ-CFG-RESTART | unit | `RESTART_REQUIRED_FIELDS` does NOT contain `projectStateMode` | direct assertion on the readonly array |
| REQ-CFG-VALIDATOR | unit | `validateSettingsPatch({ projectStateMode: "garbage" })` returns `{ ok: false }`; valid values pass | call `validateSettingsPatch` directly |
| REQ-CFG-SANITIZE | unit | `sanitize` strips invalid `projectStateMode` values | feed `{ projectStateMode: 123 }` → field absent in output |
| REQ-HTTP-PIN-409 | integration | PATCH `/settings` with `projectStateMode` while shell env pins `PILOT_PROJECT_STATE` → 409 `SHELL_ENV_PINNED` | construct `RouteDeps` with `shellEnv: { PILOT_PROJECT_STATE: "always" }`; invoke handler; assert `status === 409` and `error === "SHELL_ENV_PINNED"` |

Filesystem fakes: real tmp dirs only — no mock fs. The predicate's only I/O is `existsSync`, which is cheap and accurate against a real tmp dir created via `mkdtempSync(join(tmpdir(), "pilot-banner-"))`. Always `rmSync(dir, { recursive: true, force: true })` in `afterEach`.

Settings PATCH 409 simulation: pass `shellEnv: { PILOT_PROJECT_STATE: "always" }` into the `deps` object the handler reads — no need to mutate `process.env` (the snapshot is already a separate input per `index.ts`).

## Migration / Rollout

Non-breaking default change. `auto` is strictly more conservative than the previous always-create behavior. No data migration. No config migration (settings-store ignores unknown keys on load, so older configs without `projectStateMode` resolve to the default).

CHANGELOG entry (under the next release):

```
feat(state): add PILOT_PROJECT_STATE config (off | auto | always; default auto)
  - `auto` (new default) writes per-project state/banner only when `.opencode/` already exists
  - `off` disables per-project writes entirely
  - `always` preserves the legacy always-create behavior
  - Global ~/.opencode-pilot/ writes are unchanged
  - Settings UI: editable from the Connection tab; pinned (409) when set in shell env
  - Fixes #2 (`.opencode/` created in arbitrary workspaces)
```

Rollback: set `PILOT_PROJECT_STATE=always` to restore the prior behavior immediately, no redeploy.

## Non-Goals

- No automatic `.gitignore` injection into `.opencode/`.
- No rewrite of `clearState` semantics — it remains the unconditional dual-unlink with ENOENT swallowed.
- No change to the TUI read fallback chain `[project, global]`.
- No removal of legacy code paths beyond the predicate substitution.
