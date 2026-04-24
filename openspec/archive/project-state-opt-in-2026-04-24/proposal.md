# Proposal: project-state-opt-in

## Intent

OpenCode Pilot currently writes `pilot-state.json` and `pilot-banner.txt` into `<project>/.opencode/` on every primary activation, creating that directory if it doesn't exist (`safeMkdir` runs `mkdirSync(..., { recursive: true })`). This produces surprising artifacts in arbitrary workspaces — any folder OpenCode boots in gets a `.opencode/` directory it never asked for (issue #2). We need an opt-in model so per-project writes happen only when the user clearly wants them, while keeping the global state path as the always-on fallback the TUI already relies on.

## Scope

### In Scope
- New config field `projectStateMode: "off" | "auto" | "always"` (default `"auto"`) backed by env var `PILOT_PROJECT_STATE`.
- Shared predicate `shouldWriteProjectState(directory, mode)` exported from `state.ts`, consumed by both `writeState` and `writeBanner`.
- Threading the mode through `activatePrimary` → `writeState` / `writeBanner` via parameter (no module-level globals).
- Settings UI wiring via `services/settings-store.ts` (`PERSISTED_KEYS`, `sanitize`) + validator entry in `http/validators.ts`.
- Shell-env pinning via `ENV_KEY_MAP.projectStateMode = "PILOT_PROJECT_STATE"` (existing 409 `SHELL_ENV_PINNED` machinery applies for free).
- Guard `writeBanner`'s currently-unguarded `join(directory, ".opencode", ...)` with the same predicate.
- Docs update: `CLAUDE.md` config table + `docs/CONFIGURATION.md`.

### Out of Scope
- Automatic `.gitignore` injection into `.opencode/`.
- Changes to `clearState` semantics (still attempts unlink on both paths; ENOENT swallowed).
- Changes to the TUI read fallback chain `[project, global]`.
- Removal of any legacy code path beyond what the predicate replaces.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `state-persistence`: write predicate becomes mode-driven; per-project writes are now opt-in (`auto` requires existing `.opencode/`, `off` skips entirely, `always` preserves current always-create behavior). Global writes unchanged.
- `settings-store`: adds `projectStateMode` field with three-way union validation (mirrors `tunnel`).

## Approach

Approach **C** from exploration — config-pipeline + shared helper.

- `Config.projectStateMode: ProjectStateMode` parsed by `parseProjectStateMode(raw)` (mirrors `parseTunnelProvider`); `DEFAULT_PROJECT_STATE_MODE = "auto"` in `constants.ts`.
- Helper signature: `shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean` — returns `false` for `off`, `true` for `always`, and `existsSync(join(directory, ".opencode"))` for `auto` (never creates the directory in `auto`).
- `writeState(directory, state, mode = "auto")` and `writeBanner({ directory, ..., projectStateMode = "auto" })` short-circuit the per-project branch when the predicate returns `false`. Default values keep existing call sites and tests compiling.
- `activatePrimary` reads `config.projectStateMode` once and passes it to both writers.
- Settings UI / shell-env pinning come for free once `PERSISTED_KEYS`, `sanitize`, `ENV_KEY_MAP`, and `validateSettingsPatch` include the field.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/server/config.ts` | Modified | Add field, parser, env-key map entry, merge/source/loader updates |
| `src/server/constants.ts` | Modified | Add `DEFAULT_PROJECT_STATE_MODE` |
| `src/server/services/state.ts` | Modified | Add `shouldWriteProjectState`, accept `mode` param in `writeState` |
| `src/server/services/banner.ts` | Modified | Accept `projectStateMode`, gate per-project write through helper, fix unguarded `join` |
| `src/server/services/settings-store.ts` | Modified | Add field to `PilotSettings`, `PERSISTED_KEYS`, `sanitize` |
| `src/server/http/validators.ts` | Modified | Validate three-way union on PATCH |
| `src/server/index.ts` | Modified | Thread `config.projectStateMode` into `writeState` / `writeBanner` |
| `src/server/services/state.test.ts` | Modified | Cover off/auto-no-dir/auto-with-dir/always |
| `src/server/services/banner.test.ts` | New | TDD-first; same matrix as state |
| `CLAUDE.md`, `docs/CONFIGURATION.md` | Modified | Document the new flag |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing tests call `writeState(dir, state)` without mode | High | Default `mode = "auto"` in signature → existing call sites compile and behave correctly when `.opencode/` exists in the test fixture |
| Migration surprise: users expecting auto-create no longer get it | Low | `auto` is conservative-safe (writes when dir already exists); only fresh workspaces stop getting `.opencode/` created — desired outcome |
| `banner.ts` has no test file → TDD requires creating it | Medium | Create `banner.test.ts` first per strict-TDD mode |
| `RESTART_REQUIRED_FIELDS` misclassification | Low | Field affects next write only — explicitly NOT restart-required; verified during spec |
| Unwritable existing `.opencode/` in `auto` mode | Low | `writeOne` already returns `{ok: false}` and caller logs `warn` — no behavior change |

## Rollback Plan

The change is additive and gated. To revert:
1. Set `PILOT_PROJECT_STATE=always` (env or settings) → restores legacy always-create behavior immediately, no redeploy.
2. Code-level revert: remove `projectStateMode` from `Config` / settings-store, drop the helper, restore unconditional `writeOne` / `safeWrite` calls. All touched files are isolated; no schema migration needed (settings-store entries are additive — unknown keys ignored on load).

## Dependencies

None — pure internal change. No new packages, no SDK version bump.

## Success Criteria

- [x] `PILOT_PROJECT_STATE=off` → no `<project>/.opencode/pilot-state.json` and no `pilot-banner.txt` after `activatePrimary`; directory not created.
- [x] `PILOT_PROJECT_STATE=auto` (default) + `.opencode/` absent → no per-project files written, directory NOT created.
- [x] `PILOT_PROJECT_STATE=auto` + `.opencode/` present → both per-project files written.
- [x] `PILOT_PROJECT_STATE=always` → both per-project files written, directory created if missing (legacy behavior preserved).
- [x] PATCH `/settings` with `projectStateMode` while `PILOT_PROJECT_STATE` is set in shell env returns 409 `SHELL_ENV_PINNED`.
- [x] Global `~/.opencode-pilot/pilot-state.json` write happens in all three modes.
- [x] TUI continues to read global state as fallback when per-project file is absent.
- [x] `clearState` does not throw when called after a skipped per-project write.

## Open Questions (RESOLVED)

1. Should `clearState` short-circuit the per-project unlink when `mode !== "always"`, or keep its current swallow-ENOENT behavior? **Resolved**: Keep swallow — semantically identical, less plumbing.
2. Confirm `RESTART_REQUIRED_FIELDS` should NOT include `projectStateMode`. **Resolved**: Confirmed — next-write-only effect, runtime safe.
3. Should the helper live in `state.ts` or new `services/project-state-mode.ts` module? **Resolved**: `state.ts` — keep co-located until third caller appears.
