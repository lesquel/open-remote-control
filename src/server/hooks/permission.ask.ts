import type { Permission } from "@opencode-ai/sdk"
import type { NotificationService } from "../services/notifications"
import type { PermissionQueue } from "../services/permission-queue"

export interface PermissionOutput {
  status?: "allow" | "deny" | "ask"
}

/**
 * Intercepts permission requests and routes them to remote clients.
 * If no remote clients are connected, falls through to TUI (default behavior).
 * Times out after permissionTimeoutMs and falls back to TUI.
 */
export function createPermissionAskHook(
  notifications: NotificationService,
  permissionQueue: PermissionQueue,
  audit: { log: (action: string, details: Record<string, unknown>) => void },
): (input: Permission, output: PermissionOutput) => Promise<void> {
  return async function handlePermissionAsk(
    input: Permission,
    output: PermissionOutput,
  ): Promise<void> {
    await notifications.notifyPermissionPending(
      input.id,
      input.title,
      input.sessionID,
      input.type,
      input.pattern,
      input.metadata,
    )

    // Wait for remote response (will timeout and return null if no response)
    const result = await permissionQueue.waitForResponse(input.id)

    if (result) {
      output.status = result.action
      audit.log("permission.resolved", {
        permissionID: input.id,
        action: result.action,
        source: "remote",
      })
    }
    // If null (timeout), output.status stays "ask" — falls back to TUI
  }
}
