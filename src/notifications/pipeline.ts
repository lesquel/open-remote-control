import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../core/events/types"
import type { EventBus } from "../core/events/bus"
import type { TelegramChannel } from "./channels/telegram/index"
import type { PushService } from "./channels/push/service"
import type { AuditLog } from "../core/audit/log"
import type { NotificationChannel, NotificationEvent } from "./ports"
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
export { createTelegramChannel } from "./channels/telegram/index"
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

/**
 * Maximum ms flush() will wait for in-flight fire-and-forget dispatches.
 * 5 s is generous enough for any real channel (HTTP + Telegram RTT) while
 * ensuring shutdown can't hang indefinitely on a wedged/slow channel.
 * The value is exported so server/index.ts can document it and tests can
 * override it via the second parameter of createNotificationService.
 */
export const FLUSH_TIMEOUT_MS = 5_000

export interface NotificationServiceOptions {
  /**
   * Override the flush timeout for testing.
   * Defaults to FLUSH_TIMEOUT_MS (5 000 ms).
   */
  flushTimeoutMs?: number
}

export function createNotificationService(
  deps: NotificationServiceDeps,
  options: NotificationServiceOptions = {},
): NotificationService {
  const { eventBus, telegram, audit, push, channels = [] } = deps
  const flushTimeoutMs = options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS

  // ─── In-flight tracking ───────────────────────────────────────────────────
  // Keeps a live set of every fire-and-forget dispatch currently outstanding.
  // We ONLY track the post-.catch() promise (already-caught, never rejects) so
  // flush() can await them without risking an unhandled rejection.
  const inFlight = new Set<Promise<unknown>>()

  function track<T>(p: Promise<T>): void {
    inFlight.add(p)
    p.finally(() => inFlight.delete(p))
  }

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

    // Fire-and-forget — keep the existing .catch(audit) intact;
    // track the non-rejecting post-.catch() promise so flush() can drain it.
    track(
      telegram
        .sendPermissionRequest(permissionID, title, sessionID)
        .catch((err) => audit.log("telegram.send_failed", { error: String(err) })),
    )

    if (push.isEnabled()) {
      track(
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
          .catch((err) => audit.log("push.send_failed", { error: String(err) })),
      )
    }

    // Fan-out to additional channels (e.g. future Slack, Discord, webhook channels).
    // Each channel decides independently whether it is enabled; disabled channels
    // are skipped. Failures are isolated — one failing channel does not prevent others.
    const channelEvent: NotificationEvent = {
      kind: "permission.pending",
      payload: { permissionID, title, sessionID, permissionType, pattern, metadata },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      track(
        ch.send(channelEvent).catch((err) =>
          audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
        ),
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
      // telegram.sendSessionIdle is await-ed inside the try/catch — NOT fire-and-forget;
      // leave it as-is.
      await telegram.sendSessionIdle(sessionID, title)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_idle" })
    }
    // Fan-out to additional channels — fire-and-forget; track each dispatch.
    const channelEvent: NotificationEvent = {
      kind: "session.idle",
      payload: { sessionID, title },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      track(
        ch.send(channelEvent).catch((err) =>
          audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
        ),
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
      // telegram.sendSessionError is await-ed inside the try/catch — NOT fire-and-forget;
      // leave it as-is.
      await telegram.sendSessionError(sessionID, title, error)
    } catch (err) {
      audit.log("telegram.send_failed", { error: String(err), kind: "session_error" })
    }
    // Fan-out to additional channels — fire-and-forget; track each dispatch.
    const channelEvent: NotificationEvent = {
      kind: "session.error",
      payload: { sessionID, title, error },
    }
    for (const ch of channels) {
      if (!ch.enabled()) continue
      track(
        ch.send(channelEvent).catch((err) =>
          audit.log("channel.send_failed", { channel: ch.name, error: String(err) }),
        ),
      )
    }
  }

  async function flush(): Promise<void> {
    // Fast path: nothing to wait for.
    if (inFlight.size === 0) return

    // Snapshot the current set so additions after flush() starts don't extend
    // the wait indefinitely (new dispatches would need a subsequent flush).
    const snapshot = [...inFlight]

    let timer: ReturnType<typeof setTimeout> | undefined

    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        // Drop is observable — never silent (AGENTS.md §3 "No silent failures").
        const stillPending = snapshot.filter(p => inFlight.has(p)).length
        audit.log("notifications.flush_timeout", { pending: stillPending })
        resolve()
      }, flushTimeoutMs)
    })

    // Race: drain wins if all dispatches settle within the bound; timeout wins
    // and audits the drop if any channel is still wedged after flushTimeoutMs.
    await Promise.race([Promise.allSettled(snapshot), timeout])

    // Always clear the timer — no leaked handles whether we drained or timed out.
    clearTimeout(timer)
  }

  return { emit, emitPilot, notifyPermissionPending, notifySessionIdle, notifySessionError, flush }
}
