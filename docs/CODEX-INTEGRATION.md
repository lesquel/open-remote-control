# Codex CLI Hook Bridge

OpenCode Pilot can receive lifecycle events from the [Codex CLI](https://github.com/openai/codex) via HTTP hooks. This lets you monitor Codex sessions, receive prompts, and approve/deny tool-use permissions remotely — the same way you already do for OpenCode sessions.

## Quick Start

1. Set `PILOT_HOOK_TOKEN` to a strong secret (optional but recommended for dedicated hook auth).
2. Configure Codex hooks to POST to your pilot instance URL.
3. Approve/deny permission requests from the dashboard or via `POST /permissions/:id`.

---

## Endpoint Reference

| Event | Method | Path | Response |
|-------|--------|------|----------|
| SessionStart | POST | `/codex/hooks/SessionStart` | 204 No Content |
| UserPromptSubmit | POST | `/codex/hooks/UserPromptSubmit` | 204 No Content |
| PreToolUse | POST | `/codex/hooks/PreToolUse` | 204 No Content |
| PostToolUse | POST | `/codex/hooks/PostToolUse` | 204 No Content |
| PermissionRequest | POST | `/codex/hooks/PermissionRequest` | 200 JSON (blocks until resolved or timeout) |
| Stop | POST | `/codex/hooks/Stop` | 204 No Content |

All endpoints require a Bearer token in the `Authorization` header.

---

## Authentication

Requests to `/codex/hooks/*` are accepted if the Bearer token matches EITHER:
- `PILOT_HOOK_TOKEN` (if set and non-empty), OR
- The main pilot token (`PILOT_TOKEN`)

This lets you generate a dedicated token for Codex hooks without exposing your dashboard token in hook scripts.

---

## Payload Examples

### SessionStart

```json
{
  "session_id": "abc-123",
  "cwd": "/workspace/myproject",
  "model": "o4-mini",
  "permission_mode": "default"
}
```

### UserPromptSubmit

```json
{
  "session_id": "abc-123",
  "turn_id": "turn-001",
  "prompt": "Write a function that sorts a list"
}
```

### PreToolUse

```json
{
  "session_id": "abc-123",
  "turn_id": "turn-001",
  "tool_use_id": "toolu_01",
  "tool_name": "bash",
  "tool_input": { "command": "ls -la" }
}
```

### PostToolUse

```json
{
  "session_id": "abc-123",
  "turn_id": "turn-001",
  "tool_use_id": "toolu_01",
  "tool_name": "bash",
  "tool_response": "file1.ts\nfile2.ts\n"
}
```

### PermissionRequest

```json
{
  "session_id": "abc-123",
  "turn_id": "turn-001",
  "tool_name": "bash",
  "tool_input": { "command": "rm -rf /tmp/build" }
}
```

**Response** (200, blocks until resolved):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

Or denied:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "deny", "message": "Permission denied by operator" }
  }
}
```

Timeout (after `PILOT_CODEX_PERMISSION_TIMEOUT_MS` ms):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "deny", "message": "Permission request timed out after 300000ms" }
  }
}
```

### Stop

```json
{
  "session_id": "abc-123",
  "stop_hook_active": false
}
```

---

## Codex Configuration (`config.toml`)

```toml
[hooks]
  [[hooks.PreToolUse]]
    name = "opencode-pilot"
    command = [
      "curl", "-s", "-X", "POST",
      "http://127.0.0.1:4097/codex/hooks/PreToolUse",
      "-H", "Authorization: Bearer $PILOT_HOOK_TOKEN",
      "-H", "Content-Type: application/json",
      "-d", "@-"
    ]

  [[hooks.PermissionRequest]]
    name = "opencode-pilot"
    command = [
      "curl", "-s", "-X", "POST",
      "http://127.0.0.1:4097/codex/hooks/PermissionRequest",
      "-H", "Authorization: Bearer $PILOT_HOOK_TOKEN",
      "-H", "Content-Type: application/json",
      "-d", "@-"
    ]
```

---

## Permission Flow

```
Codex CLI
  └── POST /codex/hooks/PermissionRequest
                    │
      Auth check (hookToken || main)
                    │
      Emit pilot.permission.pending (SSE → dashboard / Telegram)
                    │
      Wait for POST /permissions/:id (allow | deny)
              │                    │
          allow                  deny           (timeout → deny)
              │                    │
      Emit pilot.permission.resolved
                    │
      HTTP 200 { hookSpecificOutput: { decision: { behavior } } }
                    │
      Codex receives allow/deny and proceeds
```

---

## Configuration Reference

| Env Var | Default | Description |
|---------|---------|-------------|
| `PILOT_HOOK_TOKEN` | (unset) | Dedicated bearer token for hook endpoints. When set, accepts this token OR the main token. |
| `PILOT_CODEX_PERMISSION_TIMEOUT_MS` | 250000 | How long (ms) to wait for a permission decision before auto-denying. Falls back to `PILOT_PERMISSION_TIMEOUT` if set. **Maximum: 250000ms.** Values above this are rejected at startup with a ConfigError. |

> **Constraint**: `PILOT_CODEX_PERMISSION_TIMEOUT_MS` must be ≤ 250000ms (250s). Bun's `idleTimeout` cap is 255s — setting a longer value would cause Bun to close the long-polling connection before a structured deny response can be sent, leaving Codex to see a connection reset instead of `{ behavior: "deny" }` JSON.

---

## Tunnel Warning

If you're using Codex on a remote machine and opencode-pilot is running locally, you need a tunnel:

```bash
PILOT_TUNNEL=cloudflared bun run src/server/index.ts
```

Then configure your Codex hooks to use the tunnel URL instead of `http://127.0.0.1:4097`.

**Do not expose the pilot without a token.** Every hook endpoint requires a Bearer token — set `PILOT_HOOK_TOKEN` or `PILOT_TOKEN` in your Codex environment.

---

## Events Emitted (SSE)

| Codex Event | PilotEvent |
|-------------|------------|
| SessionStart | `pilot.session.started` |
| UserPromptSubmit | `pilot.prompt.received` |
| PreToolUse | `pilot.tool.started` |
| PostToolUse | `pilot.tool.completed` |
| PermissionRequest (pending) | `pilot.permission.pending` |
| PermissionRequest (resolved) | `pilot.permission.resolved` |
| Stop | `pilot.session.stopped` |

### Security: Tool Input Not Forwarded

The `tool_input` field from `PreToolUse` payloads is **NOT** forwarded to SSE consumers (dashboard, Telegram) or included in the `pilot.tool.started` event. This is by design — tool arguments may contain credentials, API keys, or other secrets passed as command arguments. Only `toolName` and `callID` are emitted. If you need the full tool input for debugging, read it directly from your Codex session logs.
