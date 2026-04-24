// ─── Codex Hook Bridge Handlers ──────────────────────────────────────────────
// Handles POST /codex/hooks/:event — dispatch table pattern.
// Auth: validates hookToken (if set) OR main token.
// Fire-and-forget events emit PilotEvent + audit + return 204.
// PermissionRequest blocks until resolved/timeout, returns Codex JSON + 200.

import { randomUUID } from "node:crypto"
import type { RouteContext } from "./routes"
import { validateToken } from "./auth"
import { getIP } from "./auth"
import { json, jsonError } from "./json"
import { CORS_HEADERS } from "./cors"
import { readBoundedText } from "./server"
import { MAX_REQUEST_BODY_BYTES } from "../constants"
import {
  validateSessionStart,
  validateUserPromptSubmit,
  validatePreToolUse,
  validatePostToolUse,
  validatePermissionRequest,
  validateStop,
} from "./codex-validators"
import type {
  CodexHookEvent,
  CodexPermissionResponse,
} from "../types"

// ─── Auth helper ─────────────────────────────────────────────────────────────

/**
 * Validate a request token for Codex hook endpoints.
 * Accepts EITHER the hookToken (if configured and non-empty) OR the main token.
 * When hookToken is unset/empty, falls back to main token only.
 */
export function validateCodexToken(
  req: Request,
  hookToken: string | undefined,
  mainToken: string,
): boolean {
  if (hookToken && hookToken.length > 0) {
    // Accept either hookToken OR main token
    return validateToken(req, hookToken) || validateToken(req, mainToken)
  }
  // No hookToken configured — require main token
  return validateToken(req, mainToken)
}

// ─── Dispatch table type ──────────────────────────────────────────────────────

type HookHandler = (ctx: RouteContext, body: unknown) => Promise<Response>

// ─── SessionStart ─────────────────────────────────────────────────────────────

async function handleSessionStart(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validateSessionStart(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "SessionStart",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id, cwd, model, permission_mode, turn_id } = validation.data

  deps.eventBus.emit({
    type: "pilot.session.started",
    properties: {
      sessionID: session_id,
      cwd,
      model,
      permissionMode: permission_mode,
      ...(turn_id !== undefined ? { turnID: turn_id } : {}),
    },
  })

  deps.audit.log("codex.hook", {
    event: "SessionStart",
    sessionId: session_id,
    result: "success",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ─── UserPromptSubmit ─────────────────────────────────────────────────────────

async function handleUserPromptSubmit(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validateUserPromptSubmit(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "UserPromptSubmit",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id, turn_id, prompt } = validation.data

  deps.eventBus.emit({
    type: "pilot.prompt.received",
    properties: { sessionID: session_id, turnID: turn_id, prompt },
  })

  deps.audit.log("codex.hook", {
    event: "UserPromptSubmit",
    sessionId: session_id,
    turnId: turn_id,
    result: "success",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ─── PreToolUse ───────────────────────────────────────────────────────────────

async function handlePreToolUse(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validatePreToolUse(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "PreToolUse",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id, tool_use_id, tool_name } = validation.data

  deps.eventBus.emit({
    type: "pilot.tool.started",
    properties: {
      sessionID: session_id,
      callID: tool_use_id,
      tool: tool_name,
      // Note: tool_input NOT emitted (may contain secrets) — only tool_name
    },
  })

  deps.audit.log("codex.hook", {
    event: "PreToolUse",
    sessionId: session_id,
    toolName: tool_name,
    // tool_input deliberately excluded from audit (may contain secrets)
    result: "success",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ─── PostToolUse ──────────────────────────────────────────────────────────────

async function handlePostToolUse(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validatePostToolUse(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "PostToolUse",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id, tool_use_id, tool_name, tool_response, success } = validation.data

  // Build a bounded preview title — never stringify an unbounded value
  let title: string
  if (typeof tool_response === "string") {
    title = tool_response.slice(0, 200)
  } else if (tool_response === null || tool_response === undefined) {
    title = ""
  } else if (typeof tool_response === "object" && !Array.isArray(tool_response)) {
    try {
      const keys = Object.keys(tool_response as Record<string, unknown>).slice(0, 10).join(",")
      title = `{${keys}}`.slice(0, 200)
    } catch {
      title = "[object]"
    }
  } else {
    try {
      title = String(tool_response).slice(0, 200)
    } catch {
      title = "[value]"
    }
  }

  // Map Codex `success` field to `ok`; default to true when omitted (tool ran to completion)
  const ok = success !== undefined ? success : true

  deps.eventBus.emit({
    type: "pilot.tool.completed",
    properties: {
      sessionID: session_id,
      callID: tool_use_id,
      tool: tool_name,
      title,
      ok,
    },
  })

  deps.audit.log("codex.hook", {
    event: "PostToolUse",
    sessionId: session_id,
    toolName: tool_name,
    result: "success",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ─── PermissionRequest ────────────────────────────────────────────────────────

async function handlePermissionRequest(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validatePermissionRequest(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "PermissionRequest",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id, turn_id, tool_name } = validation.data

  const permissionID = randomUUID()

  // Emit pending event so SSE clients (dashboard/Telegram) can show the request
  deps.eventBus.emit({
    type: "pilot.permission.pending",
    properties: {
      permissionID,
      title: `Codex: ${tool_name}`,
      sessionID: session_id,
      permissionType: "codex-tool",
      metadata: { tool_name, source: "codex-hook" },
    },
  })

  // Block until resolved, timeout, or client disconnect
  // Note: turn_id is intentionally excluded from metadata — not rendered by the UI
  const onAbort = () => {
    deps.codexPermissionQueue.resolve(permissionID, "deny")
    deps.audit.log("codex.hook", {
      event: "PermissionRequest",
      permissionID,
      sessionId: session_id,
      toolName: tool_name,
      result: "client_disconnected",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    deps.eventBus.emit({
      type: "pilot.permission.resolved",
      properties: { permissionID, action: "deny", source: "remote", reason: "client_disconnected" },
    })
  }
  req.signal.addEventListener("abort", onAbort, { once: true })

  let result: { action: "allow" | "deny" } | null = null
  try {
    result = await deps.codexPermissionQueue.waitForResponse(permissionID, {
      title: `Codex: ${tool_name}`,
      sessionID: session_id,
      type: "codex-tool",
      metadata: { tool_name },
    })
  } finally {
    req.signal.removeEventListener("abort", onAbort)
  }

  // If the signal was aborted the queue entry was already cleaned up by onAbort.
  // Return early to avoid double-emitting resolved events.
  if (req.signal.aborted) {
    return new Response(null, { status: 499, headers: CORS_HEADERS })
  }

  if (result === null) {
    // Timeout → deny
    const timeoutMs = deps.config.codexPermissionTimeoutMs
    const decision = {
      behavior: "deny" as const,
      message: `Permission request timed out after ${timeoutMs}ms`,
    }

    deps.eventBus.emit({
      type: "pilot.permission.resolved",
      properties: { permissionID, action: "deny", source: "remote", reason: "timeout" },
    })

    deps.audit.log("codex.hook", {
      event: "PermissionRequest",
      permissionID,
      sessionId: session_id,
      toolName: tool_name,
      result: "timeout",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })

    const response: CodexPermissionResponse = {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision,
      },
    }
    return json(response, 200, CORS_HEADERS)
  }

  // Resolved
  const { action } = result
  const decision = action === "allow"
    ? { behavior: "allow" as const }
    : { behavior: "deny" as const, message: "Permission denied by operator" }

  deps.eventBus.emit({
    type: "pilot.permission.resolved",
    properties: { permissionID, action, source: "remote" },
  })

  deps.audit.log("codex.hook", {
    event: "PermissionRequest",
    permissionID,
    sessionId: session_id,
    toolName: tool_name,
    result: action === "allow" ? "allowed" : "denied",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  const response: CodexPermissionResponse = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision,
    },
  }
  return json(response, 200, CORS_HEADERS)
}

// ─── Stop ─────────────────────────────────────────────────────────────────────

async function handleStop(ctx: RouteContext, body: unknown): Promise<Response> {
  const { deps, req } = ctx
  const validation = validateStop(body)
  if (!validation.ok) {
    deps.audit.log("codex.hook", {
      event: "Stop",
      sessionId: null,
      result: "validation_error",
      clientIp: getIP(req),
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400, CORS_HEADERS)
  }
  const { session_id } = validation.data

  deps.eventBus.emit({
    type: "pilot.session.stopped",
    properties: { sessionID: session_id },
  })

  deps.audit.log("codex.hook", {
    event: "Stop",
    sessionId: session_id,
    result: "success",
    clientIp: getIP(req),
    ts: new Date().toISOString(),
  })

  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

export const CODEX_DISPATCH: Record<CodexHookEvent, HookHandler> = {
  SessionStart: handleSessionStart,
  UserPromptSubmit: handleUserPromptSubmit,
  PreToolUse: handlePreToolUse,
  PostToolUse: handlePostToolUse,
  PermissionRequest: handlePermissionRequest,
  Stop: handleStop,
}

// ─── Main dispatch entry point ────────────────────────────────────────────────

/**
 * Handle POST /codex/hooks/:event.
 * Auth is validated here (not in routes.ts — auth: "none").
 */
export async function dispatchCodexHook(ctx: RouteContext): Promise<Response> {
  const { req, params, deps } = ctx
  const event = params.event ?? ""
  const clientIp = getIP(req)

  // Auth check: hookToken (if set) OR main token
  const isAuthorized = validateCodexToken(req, deps.config.hookToken, deps.token)
  if (!isAuthorized) {
    // Truncate event before validation to prevent injection via unvalidated path
    deps.audit.log("codex.hook", {
      event: event.slice(0, 40),
      sessionId: null,
      result: "auth_error",
      clientIp,
      ts: new Date().toISOString(),
    })
    return jsonError("UNAUTHORIZED", "Unauthorized", 401, CORS_HEADERS)
  }

  // Route lookup
  const handler = CODEX_DISPATCH[event as CodexHookEvent]
  if (!handler) {
    // Truncate event before validation to prevent injection via unvalidated path
    deps.audit.log("codex.hook", {
      event: event.slice(0, 40),
      sessionId: null,
      result: "not_found",
      clientIp,
      ts: new Date().toISOString(),
    })
    return jsonError("UNKNOWN_HOOK_EVENT", `Unknown hook event: "${event.slice(0, 40)}"`, 404, CORS_HEADERS)
  }

  // Read body with a hard byte cap — enforces 1 MiB even on chunked requests
  // that omit Content-Length (which bypasses the upstream checkBodySize guard).
  const rawText = await readBoundedText(req, MAX_REQUEST_BODY_BYTES)
  if (rawText === null) {
    deps.audit.log("codex.hook", {
      event: event.slice(0, 40),
      sessionId: null,
      result: "too_large",
      clientIp,
      ts: new Date().toISOString(),
    })
    return jsonError("PAYLOAD_TOO_LARGE", `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit`, 413, CORS_HEADERS)
  }

  // Parse JSON body
  let body: unknown
  try {
    body = JSON.parse(rawText)
  } catch {
    deps.audit.log("codex.hook", {
      event,
      sessionId: null,
      result: "validation_error",
      clientIp,
      ts: new Date().toISOString(),
    })
    return jsonError("INVALID_JSON", "Failed to parse JSON body", 400, CORS_HEADERS)
  }

  return handler(ctx, body)
}
