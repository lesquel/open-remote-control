import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../core/events/types"
import type { EventBus } from "../core/events/bus"
import type { TelegramBot } from "./channels/telegram/index"
import type { PushService } from "./channels/push/service"
import type { AuditLog } from "../core/audit/log"

export interface NotificationService {
  /** Emit any bus event to all connected SSE clients. */
  emit(event: BusEvent): void
  /** Emit a typed PilotEvent and record it in the audit log. */
  emitPilot(event: PilotEvent): void
  /**
   * Full pipeline: SSE + Telegram + Web Push for permission pending.
   * Returns `true` if at least one interactive channel was reachable
   * (Telegram enabled, Web Push enabled with subscribers, or SSE clients connected).
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
  /** Telegram notification when a session goes idle after work. */
  notifySessionIdle(
    client: PluginInput["client"],
    sessionID: string,
  ): Promise<void>
  /** Telegram notification for session errors. */
  notifySessionError(
    client: PluginInput["client"],
    sessionID: string,
    error: string,
  ): Promise<void>
}

export function createNotificationService(
  eventBus: EventBus,
  telegram: TelegramBot,
  audit: AuditLog,
  push: PushService,
): NotificationService {
  function emit(event: BusEvent): void {
    eventBus.emit(event)
  }

  function emitPilot(event: PilotEvent): void {
    eventBus.emit(event)
    audit.log("event.pilot", { type: event.type })
  }

  async function notifyPermissionPending(
    permissionID: string,
    title: string,
    sessionID: string,
    permissionType: string,
    pattern?: string | string[],
    metadata: Record<string, unknown> = {},
  ): Promise<boolean> {
    const telegramReachable = telegram.enabled
    const pushReachable = push.isEnabled() && push.count() > 0
    const sseReachable = eventBus.hasClients()

    telegram
      .sendPermissionRequest(permissionID, title, sessionID)
      .catch((err) => audit.log("telegram.send_failed", { error: String(err) }))

    if (push.isEnabled()) {
      push
        .broadcast({
          title: "Permission request",
          body: title,
          data: {
            kind: "permission",
            id: permissionID,
            sessionID,
            url: "/",
          },
        })
        .catch((err) => audit.log("push.send_failed", { error: String(err) }))
    }

    if (sseReachable) {
      audit.log("permission.requested", { permissionType, title, sessionID })

      const event: PilotEvent = {
        type: "pilot.permission.pending",
        properties: {
          permissionID,
          title,
          sessionID,
          permissionType,
          pattern,
          metadata,
        },
      }
      eventBus.emit(event)
    }

    return telegramReachable || pushReachable || sseReachable
  }

  async function notifySessionIdle(
    client: PluginInput["client"],
    sessionID: string,
  ): Promise<void> {
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      const title =
        ((session.data as Record<string, unknown>)?.title as string) ?? "Untitled"
      await telegram.sendSessionIdle(sessionID, title)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_idle" })
    }
  }

  async function notifySessionError(
    client: PluginInput["client"],
    sessionID: string,
    error: string,
  ): Promise<void> {
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      const title =
        ((session.data as Record<string, unknown>)?.title as string) ?? "Untitled"
      await telegram.sendSessionError(sessionID, title, error)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_error" })
    }
  }

  return { emit, emitPilot, notifyPermissionPending, notifySessionIdle, notifySessionError }
}
