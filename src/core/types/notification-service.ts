// ─── NotificationService port (core) ──────────────────────────────────────────
// Type-only definition of the NotificationService contract.
// Lives in core/ so integrations/ can import it without creating a cross-sibling
// dependency on notifications/.
//
// The implementation of this interface is in notifications/pipeline.ts.

import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../events/types"

export interface NotificationService {
  /** Emit any bus event to all connected SSE clients. */
  emit(event: BusEvent): void
  /** Emit a typed PilotEvent and record it in the audit log. */
  emitPilot(event: PilotEvent): void
  /**
   * Full pipeline: SSE + channels for permission pending.
   * Returns `true` if at least one interactive channel was reachable.
   * Returns `false` when no channel can reach a human — caller should skip waitForResponse.
   */
  notifyPermissionPending(
    permissionID: string,
    title: string,
    sessionID: string,
    permissionType: string,
    pattern?: string | string[],
    metadata?: Record<string, unknown>,
  ): Promise<boolean>
  /** Notification when a session goes idle after work. */
  notifySessionIdle(
    client: PluginInput["client"],
    sessionID: string,
  ): Promise<void>
  /** Notification for session errors. */
  notifySessionError(
    client: PluginInput["client"],
    sessionID: string,
    error: string,
  ): Promise<void>
  /** Flush any in-flight notifications. Called during shutdown. */
  flush(): Promise<void>
}
