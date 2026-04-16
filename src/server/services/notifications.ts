import type { PluginInput } from "@opencode-ai/plugin"
import type { BusEvent, PilotEvent } from "../types"
import type { EventBus } from "./event-bus"
import type { TelegramBot } from "./telegram"
import type { AuditLog } from "./audit"

export interface NotificationService {
  /** Emit any bus event to all connected SSE clients. */
  emit(event: BusEvent): void
  /** Emit a typed PilotEvent and record it in the audit log. */
  emitPilot(event: PilotEvent): void
  /** Full pipeline: SSE + Telegram + audit for permission pending. */
  notifyPermissionPending(
    permissionID: string,
    title: string,
    sessionID: string,
    permissionType: string,
    pattern?: string | string[],
    metadata?: Record<string, unknown>,
  ): Promise<void>
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
  ): Promise<void> {
    telegram.sendPermissionRequest(permissionID, title, sessionID).catch(() => {})

    if (!eventBus.hasClients()) return

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

  async function notifySessionIdle(
    client: PluginInput["client"],
    sessionID: string,
  ): Promise<void> {
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      const title =
        ((session.data as Record<string, unknown>)?.title as string) ?? "Untitled"
      await telegram.sendSessionIdle(sessionID, title)
    } catch {}
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
    } catch {}
  }

  return { emit, emitPilot, notifyPermissionPending, notifySessionIdle, notifySessionError }
}
