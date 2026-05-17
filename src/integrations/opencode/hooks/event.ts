import type { PluginInput } from "@opencode-ai/plugin"
import type { NotificationService } from "../../../core/types/notification-service"

/**
 * Handle all SDK events forwarded by OpenCode.
 * Emits each event onto the SSE bus and handles session lifecycle notifications.
 */
export function createEventHook(
  notifications: NotificationService,
  sessionBusyStart: Map<string, number>,
  client: PluginInput["client"],
  audit: { log: (action: string, details: Record<string, unknown>) => void },
) {
  return async function handleEvent({
    event,
  }: {
    event: { type: string; properties: Record<string, unknown> }
  }): Promise<void> {
    // Forward all events to SSE bus
    notifications.emit(event)
    audit.log("event", { type: event.type })

    const props = event.properties
    const sessionID = props?.sessionID as string | undefined

    if (event.type === "session.status") {
      const status = props?.status as Record<string, unknown> | undefined
      if (sessionID && status?.type === "busy") {
        sessionBusyStart.set(sessionID, Date.now())
      } else if (sessionID && status?.type === "idle") {
        const started = sessionBusyStart.get(sessionID)
        if (started !== undefined) {
          sessionBusyStart.delete(sessionID) // always clean on idle; threshold only gates notification
          if (Date.now() - started > 10_000) {
            await notifications.notifySessionIdle(client, sessionID)
          }
        }
      }
    }

    if (event.type === "session.error" && sessionID) {
      sessionBusyStart.delete(sessionID) // errored session is no longer busy; prevent stale-ID misfire
      const errorObj = props?.error as Record<string, unknown> | undefined
      const error =
        (errorObj?.data as Record<string, unknown>)?.message as string ||
        String(props?.error ?? "Unknown error")
      await notifications.notifySessionError(client, sessionID, error)
    }
  }
}
