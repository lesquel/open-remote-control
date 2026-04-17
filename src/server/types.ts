// ─── Shared domain types ───────────────────────────────────────────────────

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
      }
    }
  | {
      type: "pilot.tool.started"
      properties: { tool: string; sessionID: string; callID: string }
    }
  | {
      type: "pilot.tool.completed"
      properties: { tool: string; sessionID: string; callID: string; title: string }
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

/** SDK events or any untyped passthrough */
export interface SdkEvent {
  type: string
  properties: Record<string, unknown>
}

/** Everything that can flow over the bus */
export type BusEvent = PilotEvent | SdkEvent

// ─── Error base ────────────────────────────────────────────────────────────

export class PilotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 500,
  ) {
    super(message)
    this.name = "PilotError"
  }
}
