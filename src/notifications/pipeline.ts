import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../core/events/types"
import type { EventBus } from "../core/events/bus"
import type { TelegramChannel } from "./channels/telegram/index"
import type { PushService } from "./channels/push/service"
import type { AuditLog } from "../core/audit/log"
import type { NotificationChannel } from "./ports"
import type { NotificationService } from "../core/types/notification-service"

// Re-export the NotificationService type from core/ so both notifications/ and
// integrations/ can reference it without a cross-sibling import.
export type { NotificationService } from "../core/types/notification-service"

// Re-export PushService so transport/ can reference the push dep type
// without importing directly from notifications/channels/push/service.
// This keeps the dependency rule: transport/ → notifications/ (pipeline only).
export type { PushService } from "./channels/push/service"
export type { PushSubscriptionJson } from "./channels/push/service"

// Re-export TelegramChannel so transport/ can reference the telegram dep type
// without importing directly from notifications/channels/telegram/index.
// Mirrors the PushService re-export pattern.
export type { TelegramChannel } from "./channels/telegram/index"

// Re-export createTelegramChannel and createPushService so test files and
// other consumers can import from the pipeline barrel instead of reaching
// into the channel sub-directories directly.
export { createTelegramChannel, createTelegramBot } from "./channels/telegram/index"
export { createPushService } from "./channels/push/service"

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

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { eventBus, telegram, audit, push, channels = [] } = deps

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

    // Fan-out to additional channels (e.g. future Slack, Discord, webhook channels).
    // Each channel decides independently whether it is enabled; disabled channels
    // are skipped. Failures are isolated — one failing channel does not prevent others.
    const channelEvent: import("./ports").NotificationEvent = {
      kind: "permission.pending",
      payload: { permissionID, title, sessionID, permissionType, pattern, metadata },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      ch.send(channelEvent).catch((err) =>
        audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
      )
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
    let title = "Untitled"
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      title = ((session.data as Record<string, unknown>)?.title as string) ?? "Untitled"
      await telegram.sendSessionIdle(sessionID, title)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_idle" })
    }
    // Fan-out to additional channels
    const channelEvent: import("./ports").NotificationEvent = {
      kind: "tool.completed",
      payload: { sessionID, title, kind: "session_idle" },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      ch.send(channelEvent).catch((err) =>
        audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
      )
    }
  }

  async function notifySessionError(
    client: PluginInput["client"],
    sessionID: string,
    error: string,
  ): Promise<void> {
    let title = "Untitled"
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      title = ((session.data as Record<string, unknown>)?.title as string) ?? "Untitled"
      await telegram.sendSessionError(sessionID, title, error)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_error" })
    }
    // Fan-out to additional channels
    const channelEvent: import("./ports").NotificationEvent = {
      kind: "session.error",
      payload: { sessionID, title, error },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      ch.send(channelEvent).catch((err) =>
        audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
      )
    }
  }

  async function flush(): Promise<void> {
    // No in-flight tracking currently — no-op placeholder.
    // Called during shutdown to drain any queued notifications before process exit.
  }

  return { emit, emitPilot, notifyPermissionPending, notifySessionIdle, notifySessionError, flush }
}
