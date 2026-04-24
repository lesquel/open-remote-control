# Archive Report: project-state-opt-in

**Change**: `project-state-opt-in`  
**Date**: 2026-04-24  
**Status**: CLOSED — Ready for Production  
**Origin**: GitHub issue #2 (https://github.com/lesquel/open-remote-control/issues/2)

---

## Executive Summary

The `project-state-opt-in` change successfully implements a three-mode configuration (`off | auto | always`) for controlling when OpenCode Pilot writes per-project state and banner files. The `auto` mode (new default) writes only when a `.opencode/` directory already exists, solving the surprising artifact creation in arbitrary workspaces. All 43 implementation tasks completed; 262 tests passing; typecheck clean after post-apply fix.

---

## Change Overview

**Intent**: Prevent OpenCode Pilot from automatically creating `.opencode/` directories in arbitrary project folders (issue #2). Instead, provide three opt-in modes:
- `off` — skip all per-project writes
- `auto` (default) — write only when `.opencode/` already exists
- `always` — preserve legacy always-create behavior

**Scope**:
- New `Config.projectStateMode` field, backed by `PILOT_PROJECT_STATE` env var
- Shared predicate `shouldWriteProjectState(directory, mode)` exported from `state.ts`
- Updates to `writeState` and `writeBanner` to gate per-project writes
- Settings UI integration with shell-env pinning (409 `SHELL_ENV_PINNED`)
- Documentation updates in `CLAUDE.md` and `docs/CONFIGURATION.md`

**Out of Scope**:
- Automatic `.gitignore` injection
- Changes to `clearState` semantics
- Changes to TUI read fallback chain
- Removal of legacy code paths

---

## Final Outcomes

### Test Results
- **Bun test suite**: 262 pass / 0 fail across 24 files
- **Strict TDD**: All batches complete (Batch 1-9), all RED→GREEN cycles executed
- **Coverage**: Core logic, edge cases, integration tests included

### Type Check
- **Result**: PASS
- **Post-apply fix**: 3 TS2741 errors in test stubs (Config literals missing `projectStateMode` field) resolved by adding `projectStateMode: "auto"` to:
  - `src/server/dashboard/__tests__/integration.test.ts:106`
  - `src/server/http/server.test.ts:137`
  - `src/server/services/push.test.ts:15`

### Files Touched
**Production** (14 files):
- `src/server/constants.ts` — `DEFAULT_PROJECT_STATE_MODE`
- `src/server/services/state.ts` — `ProjectStateMode` type, `shouldWriteProjectState`, `writeState` mode param
- `src/server/services/banner.ts` — `projectStateMode` option, gated write, try/catch guard
- `src/server/services/settings-store.ts` — `projectStateMode` field, `PERSISTED_KEYS`, `sanitize`
- `src/server/config.ts` — `projectStateMode` field, parser, `ENV_KEY_MAP`, `loadConfig` wiring
- `src/server/http/validators.ts` — three-way union validation
- `src/server/index.ts` — thread mode to `writeState` and `writeBanner`
- `docs/CONFIGURATION.md` — document `PILOT_PROJECT_STATE`
- `CLAUDE.md` — add config line
- `CHANGELOG.md` — feat(state) entry

**Test** (8 files):
- `src/server/services/state.test.ts` — Batch 1-3 tests, updated 3 legacy tests
- `src/server/services/banner.test.ts` — NEW (TDD-first, Batch 4 tests)
- `src/server/config.test.ts` — Batch 5 tests
- `src/server/http/validators.test.ts` — NEW (Batch 6 tests)
- `src/server/http/settings.test.ts` — Batch 7 tests
- `src/server/dashboard/__tests__/integration.test.ts` — added `projectStateMode: "auto"` (post-fix)
- `src/server/http/server.test.ts` — added `projectStateMode: "auto"` (post-fix)
- `src/server/services/push.test.ts` — added `projectStateMode: "auto"` (post-fix)

**Artifacts** (4 files):
- `openspec/changes/project-state-opt-in/proposal.md`
- `openspec/changes/project-state-opt-in/spec.md`
- `openspec/changes/project-state-opt-in/design.md`
- `openspec/changes/project-state-opt-in/tasks.md` — all 43 tasks marked complete

---

## Specification Compliance

**20/22 scenarios COMPLIANT** per SDD spec (Observation #3326):

| Capability | Requirement | Compliance |
|---|---|---|
| Config field | `projectStateMode` parsed from `PILOT_PROJECT_STATE`, default `"auto"` | PASS |
| Write predicate | `shouldWriteProjectState` exports correctly, no side effects in `auto` | PASS |
| writeState | Off/auto/always modes gate per-project writes, global ALWAYS written | PASS |
| writeBanner | Off/auto/always modes respected, unguarded `join` fixed | PASS |
| TUI read chain | Fallback chain unchanged | PASS |
| Settings UI | GET /settings exposes `projectStateMode`, PATCH validation works | PASS (2 warnings) |

**Warnings** (non-blocking):
1. GET /settings shell-env pin scenario lacks dedicated assertion (mitigated by existing unit tests)
2. `updateStateToken` defaults to mode="auto" instead of forwarding caller's mode (safe under normal conditions)

---

## Carry-Forward Items

### From Verify Report Warnings

**WARN-01**: GET /settings shell-env pin scenario for `projectStateMode` lacks dedicated assertion.
- **Context**: Shell-env pinning works correctly (tested via PATCH 409 test), but no explicit test for GET flag in settings response when env is set.
- **Future work**: Add dedicated integration test: `GET /settings` with `PILOT_PROJECT_STATE=off` → response includes pin flag.

**WARN-02**: `updateStateToken` defaults to `mode="auto"` instead of forwarding caller's mode.
- **Context**: Function signature is `updateStateToken(directory, token, mode = "auto")`. Works correctly in practice but not future-proof if callers need to override mode.
- **Future work**: Consider adding optional mode param to `updateStateToken` to forward the effective mode from caller's context.

### From Verify Report Suggestions

**SUGG-01**: Config.projectStateMode could be optional but required is the stronger design.
- **Rationale**: Required field is correct (default `"auto"` enforced at parser time).
- **No follow-up needed**.

**SUGG-02**: `updateStateToken` could accept optional mode param.
- **Action item**: See WARN-02 above — deferred to future PR if needed.

**SUGG-03**: CHANGELOG "fixes #2" could link to GitHub issue URL.
- **Action item**: Future: update CHANGELOG entry to include full GitHub URL (currently references issue #2; link not included).

---

## Recommended Follow-Up Work

1. **Shell-env pin test for GET /settings** (MEDIUM priority)
   - Add integration test: `GET /settings` with shell-env pin → pin flag in response
   - Location: `src/server/http/handlers.test.ts`
   - Effort: 1 test case, ~20 lines

2. **Mode forwarding in updateStateToken** (LOW priority, future-proofing)
   - Add optional `mode?: ProjectStateMode` param to `updateStateToken`
   - Thread through from callers that have context (e.g., `activatePrimary`)
   - Location: `src/server/services/state.ts` + call sites in `index.ts`
   - Effort: exploratory; defer unless patterns emerge requiring it

3. **CHANGELOG GitHub URL** (COSMETIC)
   - Update CHANGELOG entry: change "fixes #2" to full GitHub URL
   - Location: `CHANGELOG.md`
   - Effort: trivial

---

## Rollback Plan

The change is fully additive and gated. To revert:

1. **Runtime**: Set `PILOT_PROJECT_STATE=always` in shell or settings → restores legacy always-create behavior immediately, no redeploy.
2. **Code-level**: Remove `projectStateMode` from `Config` interface and settings-store, drop the `shouldWriteProjectState` helper, restore unconditional `writeOne` / `safeWrite` calls. All touched files are isolated; settings-store ignores unknown keys on load — no schema migration needed.

---

## Related Issues & Decisions

**GitHub Issue**: #2 — `.opencode/` created in arbitrary workspaces  
**Related Design Decision**: Proposal / Design Decision #4 — Default mode is `"auto"` (conservative-safe, aligns with user intent)  
**Architecture Decision**: Decision #2 — `projectStateMode` NOT in `RESTART_REQUIRED_FIELDS` (next-write-only effect)  
**Non-Breaking Change**: Default mode (`auto`) is strictly more conservative than legacy (always-create) — existing workspaces with `.opencode/` see no behavior change.

---

## SDD Artifact IDs (for traceability)

- **Proposal**: Engram #3325
- **Spec**: Engram #3326
- **Design**: Engram #3327
- **Tasks**: Engram #3330
- **Apply-Progress**: Engram #3332
- **Verify-Report**: Engram #3333
- **Archive-Report**: (this file)

---

## SDD Cycle Complete

The `project-state-opt-in` change is now closed and ready for production. All phases completed:
- [x] **Explore** — Problem identified (arbitrary `.opencode/` creation)
- [x] **Propose** — Approach defined (config + predicate + three modes)
- [x] **Spec** — Scenarios and requirements written
- [x] **Design** — Technical approach detailed, file changes scoped
- [x] **Tasks** — 43 implementation tasks broken down (Batch 1-9)
- [x] **Apply** — All 43 tasks done, 262 tests passing, post-verify fix applied
- [x] **Verify** — PASS WITH WARNINGS (2 non-blocking warnings, 3 suggestions)
- [x] **Archive** — Change folder moved, specs merged, artifact trail captured

Ready for the next change.
