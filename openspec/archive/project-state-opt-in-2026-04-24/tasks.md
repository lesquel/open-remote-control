# Tasks: project-state-opt-in

## Status: COMPLETE (43/43 tasks done + post-verify fix)

All tasks implemented and tested. See apply-progress for detailed execution log.

## Batch 1 — Constant + `ProjectStateMode` type

- [x] 1.1 (RED) Add test to `src/server/services/state.test.ts` asserting `ProjectStateMode` accepts `"off" | "auto" | "always"` (compile-time type check via `satisfies`)
- [x] 1.2 Add `DEFAULT_PROJECT_STATE_MODE = "auto" as const` to `src/server/constants.ts`
- [x] 1.3 (GREEN) Export `type ProjectStateMode = "off" | "auto" | "always"` from `src/server/services/state.ts`
- [x] 1.4 Run `bun test src/server/services/state.test.ts` — Batch 1 must be green

## Batch 2 — `shouldWriteProjectState` helper

- [x] 2.1 (RED) Add `describe("shouldWriteProjectState")` block to `src/server/services/state.test.ts` with four table-driven tests: `off` returns false, `always` returns true, `auto` + no dir returns false (and dir NOT created), `auto` + pre-existing dir returns true
- [x] 2.2 (RED) Add edge-case test: empty-string directory with mode `"auto"` returns false
- [x] 2.3 (GREEN) Implement `export function shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean` in `src/server/services/state.ts` (uses `existsSync(join(directory, ".opencode"))`)
- [x] 2.4 Run `bun test src/server/services/state.test.ts` — Batch 2 must be green

## Batch 3 — `writeState` mode param

- [x] 3.1 (RED) Add `describe("writeState — mode param")` to `src/server/services/state.test.ts` covering: `mode="off"` writes global only (no `.opencode/` created); `mode="auto"` + no dir → no project write, no dir; `mode="auto"` + pre-existing `.opencode/` → project write; `mode="always"` + no dir → creates dir and project file
- [x] 3.2 (RED) Add test: `clearState` does not throw after `writeState(dir, state, "off")` (regression guard for Decision 1)
- [x] 3.3 (GREEN) Extend `writeState(directory, state, mode: ProjectStateMode = "auto")` in `src/server/services/state.ts` to gate per-project writes through `shouldWriteProjectState`; global path unchanged
- [x] 3.4 Run `bun test src/server/services/state.test.ts` — Batch 3 must be green

## Batch 4 — Create `banner.test.ts`

- [x] 4.1 (RED) Create `src/server/services/banner.test.ts` with test: `writeBanner` with `mode="off"` writes global banner and does NOT create `<dir>/.opencode/`
- [x] 4.2 (RED) Add test: `writeBanner` with `mode="always"` writes per-project `pilot-banner.txt` even when `.opencode/` did not previously exist
- [x] 4.3 (RED) Add test: `writeBanner` with `mode="auto"` + no existing `.opencode/` skips per-project write; global is still written
- [x] 4.4 (RED) Add test: `writeBanner` with `mode="auto"` + pre-existing `.opencode/` writes per-project banner
- [x] 4.5 (RED) Add test: `writeBanner` with `directory: ""` and `mode="auto"` does NOT throw (regression for unguarded `join` bug)
- [x] 4.6 (GREEN) Add `projectStateMode?: ProjectStateMode` to `BannerOptions` in `src/server/services/banner.ts`
- [x] 4.7 (GREEN) Gate per-project `safeWrite` in `writeBanner` through `shouldWriteProjectState`; wrap in try/catch consistent with `safeWrite` pattern (fixes unguarded `join`)
- [x] 4.8 Run `bun test src/server/services/banner.test.ts` — Batch 4 must be green

## Batch 5 — Config parsing

- [x] 5.1 (RED) Add `describe("parseProjectStateMode")` to `src/server/config.test.ts`: accepts `"off"` / `"auto"` / `"always"`, returns `"auto"` when undefined, throws `ConfigError` on `"invalid"` (error message names `PILOT_PROJECT_STATE` and lists valid values)
- [x] 5.2 (RED) Add test: `loadConfig({ PILOT_PROJECT_STATE: "off" }).projectStateMode === "off"`
- [x] 5.3 (RED) Add test: `loadConfig({}).projectStateMode === "auto"` (default)
- [x] 5.4 (RED) Add test: `RESTART_REQUIRED_FIELDS` does NOT include `"projectStateMode"` (Decision 2)
- [x] 5.5 (GREEN) Add `projectStateMode: ProjectStateMode` to `Config` interface in `src/server/config.ts`
- [x] 5.6 (GREEN) Add `function parseProjectStateMode(raw: string | undefined): ProjectStateMode` in `src/server/config.ts` (mirrors `parseTunnelProvider` pattern)
- [x] 5.7 (GREEN) Wire `projectStateMode` into `loadConfig` (call `parseProjectStateMode(env.PILOT_PROJECT_STATE)`)
- [x] 5.8 (GREEN) Add `projectStateMode: "PILOT_PROJECT_STATE"` to `ENV_KEY_MAP` in `src/server/config.ts`
- [x] 5.9 (GREEN) Add `projectStateMode?: "off" | "auto" | "always"` to `PilotSettings` in `src/server/services/settings-store.ts`; append `"projectStateMode"` to `PERSISTED_KEYS`
- [x] 5.10 (GREEN) Extend `sanitize` in `src/server/services/settings-store.ts` to validate `projectStateMode` (mirrors `tunnel` pattern; strips non-union values)
- [x] 5.11 (GREEN) Add `projectStateMode` to `mergeStoredSettings` path — already handled by `ENV_KEY_MAP` loop; verify `stringifySetting` passes string through unchanged
- [x] 5.12 (GREEN) Add `projectStateMode: config.projectStateMode` to `projectConfigToSettings` return in `src/server/config.ts`
- [x] 5.13 Run `bun test src/server/config.test.ts src/server/services/settings-store.test.ts` — Batch 5 must be green

## Batch 6 — Validator

- [x] 6.1 (RED) Add test in `src/server/http/validators.ts`-adjacent test (create `src/server/http/validators.test.ts` if absent) covering: `validateSettingsPatch({ projectStateMode: "always" })` returns ok; `{ projectStateMode: "sometimes" }` returns error naming `projectStateMode`; `{ projectStateMode: 123 }` returns error
- [x] 6.2 (GREEN) Add `projectStateMode` branch to `validateSettingsPatch` in `src/server/http/validators.ts` (three-way union check, mirrors `tunnel` block)
- [x] 6.3 Run `bun test src/server/http/` — Batch 6 must be green

## Batch 7 — HTTP integration (settings pin + patch)

- [x] 7.1 (RED) Add integration test in `src/server/http/handlers.test.ts` (or create if absent): `PATCH /settings` with `shellEnv: { PILOT_PROJECT_STATE: "always" }` → 409 `SHELL_ENV_PINNED`
- [x] 7.2 (RED) Add test: `PATCH /settings { projectStateMode: "always" }` with no shell pin → 200; subsequent effective config reflects new value
- [x] 7.3 (RED) Add test: `GET /settings` response includes `projectStateMode` key with effective value
- [x] 7.4 (GREEN) Verify `resolveSources` in `src/server/config.ts` covers `projectStateMode` — it iterates `ENV_KEY_MAP` so no code change needed; confirm with the test
- [x] 7.5 Run `bun test src/server/http/` — Batch 7 must be green

## Batch 8 — Wire `index.ts`

- [x] 8.1 (GREEN) Pass `config.projectStateMode` to `writeState(ctx.directory, state, config.projectStateMode)` in `src/server/index.ts` (`activatePrimary` call site)
- [x] 8.2 (GREEN) Pass `projectStateMode: config.projectStateMode` in `writeBanner({ ..., projectStateMode: config.projectStateMode })` in `src/server/index.ts`
- [x] 8.3 Run `bun test` (full suite) — all batches must remain green

## Batch 9 — Docs

- [x] 9.1 Add `PILOT_PROJECT_STATE` entry to `docs/CONFIGURATION.md`: valid values, semantics per value, default, migration note for existing workspaces
- [x] 9.2 Update `CLAUDE.md` Config section: add `PILOT_PROJECT_STATE (default: auto)` line with one-line description
- [x] 9.3 Add `feat(state): add PILOT_PROJECT_STATE (off | auto | always; default auto)` entry to `CHANGELOG.md` with non-breaking note and fix-#2 reference
- [x] 9.4 Run `bun test` (full suite) — must stay green after docs changes (no production code touched)
