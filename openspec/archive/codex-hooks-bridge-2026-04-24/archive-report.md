# Archive Report: codex-hooks-bridge

**Change Name**: codex-hooks-bridge
**Phase**: Phase 1 of Codex CLI support
**Date**: 2026-04-24
**Status**: CLOSED (Phase 1 complete, all tasks verified)
**GitHub Issue**: #4 (https://github.com/lesquel/open-remote-control/issues/4)

---

## Executive Summary

Phase 1 of Codex CLI support is complete: HTTP bridge `POST /codex/hooks/:event` with 6 events, dual permission-queue, hookToken auth, and 300s safe-fail timeout. All 57 tasks completed, 347 tests passing, typecheck clean. Security fix for hookToken leak in PATCH /settings (CRITICAL-01) applied post-verify.

---

## Feature Contract

### Endpoints (6 events)
- `POST /codex/hooks/SessionStart` → 204 + `pilot.session.started` event
- `POST /codex/hooks/UserPromptSubmit` → 204 + `pilot.prompt.received` event
- `POST /codex/hooks/PreToolUse` → 204 + `pilot.tool.started` event (input omitted for security)
- `POST /codex/hooks/PostToolUse` → 204 + `pilot.tool.completed` event (with ok flag)
- `POST /codex/hooks/Stop` → 204 + `pilot.session.stopped` event
- `POST /codex/hooks/PermissionRequest` → 200 + Codex JSON shape (allow/deny/timeout-deny)

### Configuration
- `PILOT_HOOK_TOKEN` — optional, non-rotating, falls back to main token
- `PILOT_CODEX_PERMISSION_TIMEOUT_MS` — defaults to 300s, independent of dashboard permission timeout
- `hookToken` settable via `PATCH /settings` (shell-env-pinned support)

### Security
- hookToken never leaked in HTTP response bodies (`GET /settings` + `PATCH /settings`)
- Tool input intentionally omitted from `pilot.tool.started` (may contain secrets)
- Auth via `validateToken()` accepts hookToken (if set) OR main token
- 401 on missing/invalid Bearer token

### Permission Flow
- Fire-and-forget events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop): validate → emit PilotEvent → 204
- Blocking event (PermissionRequest): validate → enqueue in separate `codexPermissionQueue` → await resolution → return Codex JSON (200) or timeout-deny (200) on 300s expiry
- `POST /permissions/:id` resolves items from BOTH queues (main + codex)
- `GET /permissions` lists items from BOTH queues

### Audit
- All hook invocations logged: event, sessionId, result (semantic: success/timeout/denied/allowed/validation_error/auth_error/not_found), clientIp, timestamp
- Tool input not logged (security)

---

## Implementation Summary

### New Files (7)
```
src/server/types.test.ts
src/server/http/codex-validators.ts
src/server/http/codex-validators.test.ts
src/server/http/codex-handlers.ts
src/server/http/codex-handlers.test.ts
docs/CODEX-INTEGRATION.md
openspec/changes/codex-hooks-bridge/state.yaml
```

### Modified Files (14)
```
src/server/types.ts
src/server/constants.ts
src/server/config.ts
src/server/config.test.ts
src/server/services/settings-store.ts
src/server/http/routes.ts
src/server/http/handlers.ts
src/server/http/handlers.test.ts
src/server/http/validators.ts
src/server/http/validators.test.ts
src/server/http/settings.test.ts
src/server/index.ts
CLAUDE.md
CHANGELOG.md
```

**Total**: 21 files (7 new, 14 modified).

---

## Testing & Quality

| Metric | Result |
|--------|--------|
| Task Completion | 57/57 (100%) |
| Test Pass Rate | 347 pass, 0 fail |
| Type Check | Clean (bunx tsc --noEmit: 0 errors) |
| Coverage | Not measured (not required by spec) |

---

## Verify Phase Findings

### CRITICAL (Fixed)
- **CRITICAL-01: patchSettings leaks hookToken** — Fixed via `sanitizeSettingsResponse()` helper extracted and applied to both `getSettings` AND `patchSettings` paths. Test added: 3 RED→GREEN scenarios in `settings.test.ts`.

### WARNINGs (Resolved)
1. **WARNING-01: Missing config fallback test** — Test added: `PILOT_PERMISSION_TIMEOUT=300000` → `codexPermissionTimeoutMs === 300000`. Branch covered.
2. **WARNING-02: Spec says input included, implementation omits** — Spec updated (REQ-FIR-03) to document that `input` (tool_input) is intentionally omitted for security. Rationale: tool args may contain secrets.
3. **WARNING-03: Audit result naming mismatch** — Changed HTTP-code-style ("204", "401", etc.) to semantic labels (success/timeout/denied/allowed/validation_error/auth_error/not_found). Tests updated: 7 RED→GREEN assertions.
4. **WARNING-04: Timeout missing reason field** — Added `reason: "timeout"` to `pilot.permission.resolved` on timeout path. Test added: 1 RED→GREEN scenario.
5. **WARNING-05: tool.completed missing ok field** — Added `ok: boolean` (mapped from Codex `success` field, defaults true). Also fixed OpenCode tool hook. Test added: 1 RED→GREEN scenario.

### Out-of-Scope
- **SUGGESTION-01**: `docs/PITCH-FULL.md` modified (Spanish tech deep-dive) — unrelated to codex-hooks-bridge. Not a blocker.

---

## Post-Verify Implementation Changes

All fixes applied in strict RED→GREEN TDD order (6 post-verify batches):

1. **Batch 1 (CRITICAL-01)**: Extracted `sanitizeSettingsResponse()` helper, added test suite.
2. **Batch 2 (WARNING-01)**: Added fallback test case (result same, branch now asserted).
3. **Batch 3 (WARNING-03/04/05)**: Audit result naming, timeout reason, tool ok field — 7 RED→GREEN tests, updated event schemas.
4. **Batch 4 (WARNING-02)**: Spec updated, docs clarified (no code changes needed).
5. **Batch 5**: Full test suite re-run: 347 pass, 0 fail.
6. **Batch 6**: Type check clean, all artifacts in sync.

---

## Carry-Forward Items (Phase 2)

| Item | Description | Scope |
|------|-------------|-------|
| **app-server adapter** | Codex JSON-RPC adapter for sessions list, prompt injection, full parity with Codex desktop client | Deferred |
| **localhost-guard enforcement** | Auto-enforce `127.0.0.1` on `/codex/hooks/*` (currently docs-only warning) | Deferred |
| **timing-safe comparison** | Replace `===` with `timingSafeEqual()` in `validateToken()` (pre-existing pattern, not codex-specific) | Pre-existing, deferred |
| **live Codex integration tests** | CI-runnable Codex binary integration tests (currently manual pre-release only) | Deferred |
| **blocking PreToolUse** | Promote PreToolUse to blocking event for pilot-side veto (deferred design decision) | Future |

---

## Artifact References

| Artifact | Topic Key | ID |
|----------|-----------|-----|
| Proposal | `sdd/codex-hooks-bridge/proposal` | #3337 |
| Spec (v1) | `sdd/codex-hooks-bridge/spec` | #3338 |
| Design | `sdd/codex-hooks-bridge/design` | #3339 |
| Tasks | `sdd/codex-hooks-bridge/tasks` | #3340 |
| Apply-Progress | `sdd/codex-hooks-bridge/apply-progress` | #3341 |
| Verify-Report | `sdd/codex-hooks-bridge/verify-report` | #3342 |
| Archive-Report | `sdd/codex-hooks-bridge/archive-report` | (this) |

---

## Engagement History

| Date | Phase | Status |
|------|-------|--------|
| 2026-04-24 | Explore | Complete |
| 2026-04-24 | Propose | Complete |
| 2026-04-24 | Spec | Complete (v1, no delta) |
| 2026-04-24 | Design | Complete |
| 2026-04-24 | Tasks | Complete (57 tasks, 12 phases) |
| 2026-04-24 | Apply | Complete (57/57, 6 post-verify fixes) |
| 2026-04-24 | Verify | Complete (1 CRITICAL fixed, 5 WARNINGs resolved) |
| 2026-04-24 | Archive | Complete |

---

## Sign-Off

**Change**: codex-hooks-bridge (Phase 1)
**Completed by**: SDD Archive Executor
**Date**: 2026-04-24
**Quality Gate**: PASS (all requirements met, all findings addressed, 347/347 tests green, typecheck clean)
**Next Phase**: Phase 2 items deferred per design. No blockers for Phase 1 closure.
