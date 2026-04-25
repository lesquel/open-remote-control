import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../core/events/types"
import type { EventBus } from "../core/events/bus"
import type { TelegramChannel } from "./channels/telegram/index"
import type { PushService } from "./channels/push/service"
import type { AuditLog } from "../core/audit/log"
import type { NotificationChannel } from "./ports"

// Re-export PushService so transport/ can reference the push dep type
// without importing directly from notifications/channels/push/service.
// This keeps the dependency rule: transport/ → notifications/ (pipeline only).
export type { PushService } from "./channels/push/service"
export type { PushSubscriptionJson } from "./channels/push/service"

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
}

export interface NotificationServiceDeps {
  eventBus: EventBus
  /**
   * The telegram channel — kept separate for direct method access
   * (sendPermissionRequest, sendStartup, sendSessionIdle, sendSessionError).
   * These methods go beyond the NotificationChannel port and are needed
   * by the composition root and the HTTP handlers (via RouteDeps.telegram).
   */
  telegram: TelegramChannel
  audit: AuditLog
  /**
   * The push service — kept separate so the pipeline can call
   * push.broadcast() with a PushPayload and check push.count().
   */
  push: PushService
  /**
   * Additional notification channels beyond telegram and push.
   * Pipeline iterates these for each event (future: Slack, Discord, etc.).
   */
  channels?: NotificationChannel[]
}

export function createNotificationService(
  eventBus: EventBus,
  telegram: TelegramChannel,
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
    const telegramReachable = telegram.enabled()
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
