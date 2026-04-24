// ─── Codex hook event validators ─────────────────────────────────────────────
// One validate<Event> function per Codex hook event type.
// No external deps — manual type guards.
// Each returns { ok: true; data: T } | { ok: false; error: string }.
// Fields match Codex schema.rs (snake_case).

import type {
  CodexSessionStartPayload,
  CodexUserPromptSubmitPayload,
  CodexPreToolUsePayload,
  CodexPostToolUsePayload,
  CodexPermissionRequestPayload,
  CodexStopPayload,
} from "../types"

type ValidateResult<T> = { ok: true; data: T } | { ok: false; error: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function requireString(b: Record<string, unknown>, key: string): string | null {
  const v = b[key]
  if (typeof v !== "string" || v.length === 0) return null
  return v
}

// ─── SessionStart ─────────────────────────────────────────────────────────────

export function validateSessionStart(body: unknown): ValidateResult<CodexSessionStartPayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const cwd = requireString(body, "cwd")
  if (cwd === null) return { ok: false, error: "cwd is required and must be a non-empty string" }

  const model = body.model
  if (typeof model !== "string" || model.length === 0) return { ok: false, error: "model is required and must be a non-empty string" }

  const permission_mode = body.permission_mode
  const validModes = ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
  if (typeof permission_mode !== "string" || !validModes.includes(permission_mode)) {
    return { ok: false, error: `permission_mode must be one of: ${validModes.join(", ")}` }
  }

  const turn_id = body.turn_id !== undefined
    ? (typeof body.turn_id === "string" ? body.turn_id : null)
    : undefined
  if (turn_id === null) return { ok: false, error: "turn_id must be a string when provided" }

  return {
    ok: true,
    data: {
      session_id,
      cwd,
      model,
      permission_mode: permission_mode as CodexSessionStartPayload["permission_mode"],
      ...(turn_id !== undefined ? { turn_id } : {}),
    },
  }
}

// ─── UserPromptSubmit ─────────────────────────────────────────────────────────

export function validateUserPromptSubmit(body: unknown): ValidateResult<CodexUserPromptSubmitPayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const turn_id = requireString(body, "turn_id")
  if (turn_id === null) return { ok: false, error: "turn_id is required and must be a non-empty string" }

  const prompt = body.prompt
  if (typeof prompt !== "string") return { ok: false, error: "prompt is required and must be a string" }
  if (prompt.length === 0) return { ok: false, error: "prompt must not be empty" }

  return { ok: true, data: { session_id, turn_id, prompt } }
}

// ─── PreToolUse ───────────────────────────────────────────────────────────────

export function validatePreToolUse(body: unknown): ValidateResult<CodexPreToolUsePayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const turn_id = requireString(body, "turn_id")
  if (turn_id === null) return { ok: false, error: "turn_id is required and must be a non-empty string" }

  const tool_use_id = requireString(body, "tool_use_id")
  if (tool_use_id === null) return { ok: false, error: "tool_use_id is required and must be a non-empty string" }

  const tool_name = requireString(body, "tool_name")
  if (tool_name === null) return { ok: false, error: "tool_name is required and must be a non-empty string" }

  if (!("tool_input" in body)) return { ok: false, error: "tool_input is required" }
  const tool_input: unknown = body.tool_input

  return { ok: true, data: { session_id, turn_id, tool_use_id, tool_name, tool_input } }
}

// ─── PostToolUse ──────────────────────────────────────────────────────────────

export function validatePostToolUse(body: unknown): ValidateResult<CodexPostToolUsePayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const turn_id = requireString(body, "turn_id")
  if (turn_id === null) return { ok: false, error: "turn_id is required and must be a non-empty string" }

  const tool_use_id = requireString(body, "tool_use_id")
  if (tool_use_id === null) return { ok: false, error: "tool_use_id is required and must be a non-empty string" }

  const tool_name = requireString(body, "tool_name")
  if (tool_name === null) return { ok: false, error: "tool_name is required and must be a non-empty string" }

  // tool_response can be any value (including undefined/null — Codex may omit it on errors)
  const tool_response = body.tool_response !== undefined ? body.tool_response : null

  // success is optional — map from Codex PostToolUse schema; omitted = undefined
  const success = typeof body.success === "boolean" ? body.success : undefined

  return { ok: true, data: { session_id, turn_id, tool_use_id, tool_name, tool_response, success } }
}

// ─── PermissionRequest ────────────────────────────────────────────────────────

export function validatePermissionRequest(body: unknown): ValidateResult<CodexPermissionRequestPayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const turn_id = requireString(body, "turn_id")
  if (turn_id === null) return { ok: false, error: "turn_id is required and must be a non-empty string" }

  const tool_name = requireString(body, "tool_name")
  if (tool_name === null) return { ok: false, error: "tool_name is required and must be a non-empty string" }

  if (!("tool_input" in body)) return { ok: false, error: "tool_input is required" }
  const tool_input: unknown = body.tool_input

  return { ok: true, data: { session_id, turn_id, tool_name, tool_input } }
}

// ─── Stop ─────────────────────────────────────────────────────────────────────

export function validateStop(body: unknown): ValidateResult<CodexStopPayload> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" }

  const session_id = requireString(body, "session_id")
  if (session_id === null) return { ok: false, error: "session_id is required and must be a non-empty string" }

  const stop_hook_active = body.stop_hook_active
  if (typeof stop_hook_active !== "boolean") {
    return { ok: false, error: "stop_hook_active is required and must be a boolean" }
  }

  const last_assistant_message = body.last_assistant_message !== undefined
    ? (typeof body.last_assistant_message === "string" ? body.last_assistant_message : null)
    : undefined
  if (last_assistant_message === null) {
    return { ok: false, error: "last_assistant_message must be a string when provided" }
  }

  return {
    ok: true,
    data: {
      session_id,
      stop_hook_active,
      ...(last_assistant_message !== undefined ? { last_assistant_message } : {}),
    },
  }
}
