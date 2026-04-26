# Spec: codex-hooks-bridge (Phase 1 — Codex CLI support)

**Version**: 1.0 (Final, phase 1 complete)
**Date**: 2026-04-24
**GitHub Issue**: #4 (https://github.com/lesquel/open-remote-control/issues/4)
**Related**: Proposal #3337, Design #3339, Apply-Progress #3341, Verify-Report #3342

---

## Overview

Ship observation + permission-approval for Codex via its hook-script mechanism. Bridge Codex hooks into pilot's existing event bus and permission queue. Reuse existing infra — no new transport, no adapter rewrite.

---

## Feature Scope

### In Scope (Phase 1)
- `POST /codex/hooks/:event` — single parameterized endpoint, dispatch table per event.
- Per-event validators matching Codex `schema.rs` (snake_case).
- Env vars: `PILOT_HOOK_TOKEN` (non-rotating, falls back to main token) + `PILOT_CODEX_PERMISSION_TIMEOUT_MS` (defaults to `PILOT_PERMISSION_TIMEOUT`, 300s).
- Permission queue integration for blocking `PermissionRequest`.
- 3 new PilotEvent types: `pilot.session.started`, `pilot.prompt.received`, `pilot.session.stopped`. Reuse existing `pilot.tool.*` and `pilot.permission.*`.
- `docs/CODEX-INTEGRATION.md` with `config.toml` using `$PILOT_HOOK_TOKEN` env substitution.
- HTTP fixture tests (6 events + timeout + auth rejection).

### Out of Scope (Phase 2+)
- Codex session list, prompt injection, `codex app-server` adapter.
- Auto-enforced localhost guard on `/codex/hooks/*` (docs warning only).
- Live Codex binary in CI (manual pre-release).

---

## Requirements (REQ-* format)

### Route & Transport (REQ-RTE)

**REQ-RTE-01**: Accept `POST /codex/hooks/:event` where `:event` is one of `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`. Unknown events return HTTP 404 with error `UNKNOWN_HOOK_EVENT`.

**REQ-RTE-02**: Authenticate via Bearer token in Authorization header. Accept `PILOT_HOOK_TOKEN` (if set and non-empty) with preference over main token. Reject requests with missing/invalid token (HTTP 401).

**REQ-RTE-03**: Validate JSON payload according to per-event schema (Codex `schema.rs` shape). Return HTTP 400 with semantic error on invalid JSON, missing required field, or wrong type. Errors use `{ ok: false; error: string }` format.

### Fire-and-Forget Events (REQ-FIR)

**REQ-FIR-01**: `SessionStart` event → validate payload → emit `pilot.session.started` event (fields: `sessionId`, `cwd`, `model`, `permissionMode`, `turnId?`) → audit → HTTP 204 No Content.

**REQ-FIR-02**: `UserPromptSubmit` event → validate payload → emit `pilot.prompt.received` event (fields: `sessionId`, `turnId`, `prompt`) → audit → HTTP 204 No Content.

**REQ-FIR-03**: `PreToolUse` event → validate payload → emit `pilot.tool.started` event (fields: `sessionId`, `toolName`, `callID`; **note: `input` (tool_input) is intentionally omitted for security** — tool args may contain secrets) → audit → HTTP 204 No Content.

**REQ-FIR-04**: `PostToolUse` event → validate payload → emit `pilot.tool.completed` event (fields: `sessionId`, `callId`, `tool` (from tool_name), `title` (truncated preview of output), `ok` (boolean from success field, defaults true)) → audit → HTTP 204 No Content.

**REQ-FIR-05**: `Stop` event → validate payload → emit `pilot.session.stopped` event (fields: `sessionId`, `reason?`) → audit → HTTP 204 No Content.

### Blocking Event (REQ-PRM)

**REQ-PRM-01**: `PermissionRequest` event → validate payload → enqueue item with `randomUUID()` as permission ID → emit `pilot.permission.pending` event → block until resolved or timeout.

**REQ-PRM-02**: If permission is approved (resolved via `POST /permissions/:id` with `{ action: "allow" }`), emit `pilot.permission.resolved` with `action: "allow"` → return HTTP 200 with Codex JSON shape: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }`.

**REQ-PRM-03**: If permission is denied (resolved via `POST /permissions/:id` with `{ action: "deny" }`), emit `pilot.permission.resolved` with `action: "deny"` → return HTTP 200 with Codex JSON shape: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "..." } } }`.

**REQ-PRM-04**: If permission request times out after `PILOT_CODEX_PERMISSION_TIMEOUT_MS` (default 300s), emit `pilot.permission.resolved` with `action: "deny"` and `reason: "timeout"` → return HTTP 200 with Codex JSON shape: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Permission request timed out after Xms" } } }`. Pilot timeout < Codex 600s hook timeout → safe-fail.

### Configuration (REQ-CFG)

**REQ-CFG-01**: Parse `PILOT_HOOK_TOKEN` env var into config (optional, non-rotating). If set and non-empty, use it for auth precedence. If unset, fall back to main token. Support dynamic update via `PATCH /settings` with `{ hookToken: "..." }` or `{ hookToken: null }` (clear). Enforce shell-env-pin: if `PILOT_HOOK_TOKEN` is set in env, reject PATCH attempt with HTTP 409 `SHELL_ENV_PINNED`.

**REQ-CFG-02**: Parse `PILOT_CODEX_PERMISSION_TIMEOUT_MS` env var into config (optional). Validate as positive integer, raise `ConfigError` on invalid value (e.g., non-numeric, negative). Fall back to `PILOT_PERMISSION_TIMEOUT` if set, else `300_000` (300s). Independent timeout from main permission queue (allows Codex to have different SLA than dashboard UI).

**REQ-CFG-03**: The raw `hookToken` value MUST NOT appear in any HTTP response body. `GET /settings` exposes `hookTokenConfigured: boolean` only (true if set and non-empty, false otherwise). `PATCH /settings` response must also redact raw token. Existing redaction via `redactSecret()` pattern applies.

### Audit (REQ-AUD)

**REQ-AUD-01**: Log all hook invocations with structure: `{ event, sessionId, result, clientIp, timestamp }`. Semantic result values: `"success"` (204), `"allowed"` (200 PermissionRequest approve), `"denied"` (200 PermissionRequest deny), `"timeout"` (200 PermissionRequest timeout), `"validation_error"` (400), `"auth_error"` (401), `"not_found"` (404). Do NOT log tool input (may contain secrets); log tool_name only.

### Documentation (REQ-DOC)

**REQ-DOC-01**: Create `docs/CODEX-INTEGRATION.md` with:
- Endpoint table (all 6 events, HTTP method, path, response code/shape).
- Payload examples for each event in JSON (snake_case).
- `config.toml` snippet showing `$PILOT_HOOK_TOKEN` env substitution.
- Tunnel warning: "Phase 1 uses hook token over cleartext HTTP. Do NOT expose `/codex/hooks/*` to untrusted networks. Phase 2 will enforce localhost-only."
- Permission flow diagram.
- Security note: Tool input intentionally omitted from `pilot.tool.started` event.

---

## Event Payload Schemas

### SessionStart (fire-and-forget)
```json
{
  "session_id": "abc-123",
  "cwd": "/home/user/project",
  "model": "claude-opus",
  "permission_mode": "default",
  "turn_id": 42
}
```
**Emit**: `pilot.session.started { sessionId, cwd, model, permissionMode, turnId }`

### UserPromptSubmit (fire-and-forget)
```json
{
  "session_id": "abc-123",
  "turn_id": 42,
  "prompt": "Fix the TypeScript errors"
}
```
**Emit**: `pilot.prompt.received { sessionId, turnId, prompt }`

### PreToolUse (fire-and-forget)
```json
{
  "session_id": "abc-123",
  "turn_id": 42,
  "tool_name": "bash",
  "tool_use_id": "call-456"
}
```
**Emit**: `pilot.tool.started { sessionId, toolName, callID }`
**Note**: `tool_input` deliberately NOT emitted (security — may contain secrets).

### PostToolUse (fire-and-forget)
```json
{
  "session_id": "abc-123",
  "turn_id": 42,
  "tool_name": "bash",
  "tool_use_id": "call-456",
  "tool_response": "output here...",
  "success": true
}
```
**Emit**: `pilot.tool.completed { sessionId, callID, tool, title, ok }`
**Note**: `tool_response` is truncated to `title` (preview); `success` field is optional (defaults true).

### Stop (fire-and-forget)
```json
{
  "session_id": "abc-123",
  "stop_hook_active": true,
  "last_assistant_message": "Done"
}
```
**Emit**: `pilot.session.stopped { sessionId, reason? }`

### PermissionRequest (blocking)
```json
{
  "session_id": "abc-123",
  "turn_id": 42,
  "tool_name": "bash",
  "tool_use_id": "call-456",
  "tool_input": "rm -rf /",
  "permission_mode": "default"
}
```
**Enqueue**: `pilot.permission.pending { id, sessionId, toolName, ... }`
**Resolve (allow)**: HTTP 200
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```
**Resolve (deny)**: HTTP 200
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "User denied permission"
    }
  }
}
```
**Timeout (deny)**: HTTP 200
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Permission request timed out after 300000ms"
    }
  }
}
```

---

## Configuration Defaults

| Env Var | Type | Default | Required |
|---------|------|---------|----------|
| `PILOT_HOOK_TOKEN` | string | (unset) | No — falls back to main token |
| `PILOT_CODEX_PERMISSION_TIMEOUT_MS` | integer | 300_000 (300s) | No — can fall back to `PILOT_PERMISSION_TIMEOUT` |

---

## Testing Strategy (Strict TDD)

- **Unit**: Per-event validators (6 events × 3 test cases = 18 tests).
- **Unit**: `CODEX_DISPATCH` exhaustiveness (keys match `CodexHookEvent` union).
- **Unit**: Auth precedence (hookToken set/unset, main token fallback).
- **Integration**: 6 HTTP fixtures (happy path).
- **Integration**: PermissionRequest allow/deny/timeout via queue resolution.
- **Integration**: Timeout clean-up (no queue leaks).
- **Integration**: 404 (unknown event), 401 (auth), 400 (payload validation).
- **Audit**: All result values logged correctly (semantic names).
- **Settings**: hookToken persisted, redacted in GET/PATCH responses, shell-env-pinned.

**Total**: 57 tasks across 12 phases, RED → GREEN → REFACTOR per batch.

---

## Success Criteria (Phase 1 Complete)

- [ ] All 6 fire-and-forget events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) → 204 + PilotEvent
- [ ] PermissionRequest → 200 + Codex JSON (allow/deny/timeout-deny)
- [ ] Auth via hookToken OR main token (precedence order)
- [ ] Permission timeout → safe-fail deny after 300s
- [ ] `PILOT_HOOK_TOKEN` + `PILOT_CODEX_PERMISSION_TIMEOUT_MS` env parsing + validation
- [ ] `GET /settings` never leaks raw hookToken; `PATCH /settings` also redacted
- [ ] Shell-env-pin support for hookToken
- [ ] Audit log all invocations with semantic result values
- [ ] Documentation complete (`docs/CODEX-INTEGRATION.md`, `CLAUDE.md`, `CHANGELOG.md`)
- [ ] 347 tests passing, typecheck clean, no regressions

✅ **All criteria met as of 2026-04-24.**

---

## Non-Goals (Phase 2)

- Session list, prompt injection, app-server adapter
- Localhost-enforced guard (docs warning Phase 1; enforce Phase 2)
- Live Codex binary in CI
- Blocking PreToolUse (deferred design decision)
- Timing-safe token comparison (pre-existing scope, not codex-specific)

---

## Rollback

Revert PR. Additive — no migrations, no breaking changes. Env vars optional. Users with `codex_hooks = true` see hook failures until re-deploy; opencode flows unaffected.

---

## Dependencies

None. `eventBus`, `permission-queue`, `validateToken`, `jsonError` all exist.

---

## Open Questions Resolved

- ✅ Expose `hookTokenConfigured: boolean` in `/settings`? **YES** — implemented.
- ✅ Echo `hookEventName` in 204 body for debugging vs strict `No Content`? **STRICT** — no body, HTTP 204.
- ✅ `input` (tool_input) in `pilot.tool.started`? **NO** — omitted for security. Spec updated.
- ✅ Timing-safe token comparison? **Deferred** — pre-existing pattern, separate PR scope.
- ✅ Audit result naming? **Semantic** — success/timeout/denied/allowed/validation_error/auth_error/not_found.
- ✅ Phase 2 blocking PreToolUse? **Confirmed deferred** — design decision, separate phase.

---

## Revisions

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-04-24 | Initial spec draft |
| 1.0 | 2026-04-24 | Final (applied post-verify fixes: REQ-FIR-03 input omission documented, REQ-PRM-04 reason field, REQ-FIR-04 ok field) |

---

## Archive

This spec was archived as Phase 1 complete on 2026-04-24. Carry-forward items (Phase 2) are tracked in `openspec/archive/codex-hooks-bridge-2026-04-24/archive-report.md`.
