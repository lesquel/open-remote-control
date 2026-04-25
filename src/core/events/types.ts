// ─── Shared domain types ───────────────────────────────────────────────────

// ─── Codex hook types ────────────────────────────────────────────────────────

export type CodexHookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "Stop"

export type CodexPermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "dontAsk"
  | "bypassPermissions"

/** Payload sent by Codex for the SessionStart hook event (snake_case from Codex schema). */
export type CodexSessionStartPayload = {
  session_id: string
  cwd: string
  model: string
  permission_mode: CodexPermissionMode
  turn_id?: string
}

/** Payload sent by Codex for the UserPromptSubmit hook event. */
export type CodexUserPromptSubmitPayload = {
  session_id: string
  turn_id: string
  prompt: string
}

/** Payload sent by Codex for the PreToolUse hook event. */
export type CodexPreToolUsePayload = {
  session_id: string
  turn_id: string
  tool_use_id: string
  tool_name: string
  tool_input: unknown
}

/** Payload sent by Codex for the PostToolUse hook event. */
export type CodexPostToolUsePayload = {
  session_id: string
  turn_id: string
  tool_use_id: string
  tool_name: string
  tool_response: unknown
  /** Whether the tool execution succeeded. Codex may omit this field. */
  success?: boolean
}

/** Payload sent by Codex for the PermissionRequest hook event. */
export type CodexPermissionRequestPayload = {
  session_id: string
  turn_id: string
  tool_name: string
  tool_input: unknown
}

/** Payload sent by Codex for the Stop hook event. */
export type CodexStopPayload = {
  session_id: string
  stop_hook_active: boolean
  last_assistant_message?: string
}

/** Codex hook decision result — returned as JSON stdout for PermissionRequest. */
export type CodexHookDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string }

/** Full JSON response shape for PermissionRequest (stdout → Codex). */
export type CodexPermissionResponse = {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest"
    decision: CodexHookDecision
  }
}

// ─── PilotEvent ──────────────────────────────────────────────────────────────

/**
 * All first-party events emitted by the pilot onto the SSE bus.
 * External SDK events flow through as BusEvent.
 */
export type PilotEvent =
  | { type: "pilot.connected"; properties: { timestamp: number } }
  | {
      type: "pilot.permission.pending"
      properties: {
        permissionID: string
        title: string
        sessionID: string
        permissionType: string
        pattern?: string | string[]
        metadata: Record<string, unknown>
      }
    }
  | {
      type: "pilot.permission.resolved"
      properties: {
        permissionID: string
        action: "allow" | "deny"
        source: "remote" | "telegram" | "tui"
        /** Set to "timeout" when the permission was auto-denied due to timeout. */
        reason?: "timeout"
      }
    }
  | {
      type: "pilot.tool.started"
      properties: { tool: string; sessionID: string; callID: string }
    }
  | {
      type: "pilot.tool.completed"
      properties: { tool: string; sessionID: string; callID: string; title: string; ok: boolean }
    }
  | {
      type: "pilot.subagent.spawned"
      properties: {
        sessionID: string
        callID: string
        tool: string
        description?: string
      }
    }
  | { type: "pilot.client.connected"; properties: { ip: string; timestamp: number } }
  | { type: "pilot.client.disconnected"; properties: { timestamp: number } }
  | {
      type: "pilot.token.rotated"
      properties: { timestamp: number; connectUrl?: string }
    }
  | {
      type: "pilot.error"
      properties: {
        kind: "uncaughtException" | "unhandledRejection"
        message: string
        timestamp: number
      }
    }
  | {
      type: "pilot.session.started"
      properties: {
        sessionID: string
        cwd: string
        model: string
        permissionMode: CodexPermissionMode
        turnID?: string
      }
    }
  | {
      type: "pilot.prompt.received"
      properties: {
        sessionID: string
        turnID: string
        prompt: string
      }
    }
  | {
      type: "pilot.session.stopped"
      properties: {
        sessionID: string
        reason?: string
      }
    }

/** SDK events or any untyped passthrough */
export interface SdkEvent {
  type: string
  properties: Record<string, unknown>
}

/** Everything that can flow over the bus */
export type BusEvent = PilotEvent | SdkEvent
