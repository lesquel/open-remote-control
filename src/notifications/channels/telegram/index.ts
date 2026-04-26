import type { TelegramConfig } from "../../../core/types/config"
import type { PermissionQueue } from "../../../core/permissions/queue"
import type { Logger } from "../../../infra/logger/index"
import { createCircuitBreaker } from "../../../infra/circuit-breaker/index"
import { TELEGRAM_ERROR_MAX_CHARS } from "./constants"
import type { NotificationChannel, NotificationResult } from "../../ports"

/** Default fetch timeout for all Telegram API calls. */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000

function getTelegramFetchTimeoutMs(): number {
  const raw = process.env.PILOT_FETCH_TIMEOUT_MS
  if (!raw) return DEFAULT_FETCH_TIMEOUT_MS
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FETCH_TIMEOUT_MS
}

/**
 * Extended Telegram channel — satisfies NotificationChannel and also exposes
 * the bot-specific methods needed by the composition root and HTTP handlers.
 *
 * Supersedes the old TelegramBot interface (removed in Commit 3).
 * The `enabled` property is now a function to match NotificationChannel.
 */
export interface TelegramChannel extends NotificationChannel {
  readonly name: 'telegram'
  /** Returns true when the bot is configured with a token and chat ID. */
  enabled(): boolean
  send(event: import('../../ports').NotificationEvent): Promise<NotificationResult>
  sendMessage(text: string): Promise<void>
  sendPermissionRequest(permissionId: string, title: string, sessionId: string): Promise<void>
  sendStartup(dashboardUrl: string): Promise<void>
  sendSessionIdle(sessionId: string, title: string): Promise<void>
  sendSessionError(sessionId: string, title: string, error: string): Promise<void>
  /** One-shot getMe check — useful for startup verification. */
  testConnection(): Promise<{ ok: boolean; error?: string }>
  stop(): void
}

/**
 * @deprecated Use TelegramChannel instead. Kept for test compatibility.
 */
export type TelegramBot = TelegramChannel

interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export function createTelegramChannel(
  config: TelegramConfig | null,
  permissionQueue: PermissionQueue,
  codexPermissionQueue: PermissionQueue,
  logger?: Logger,
): TelegramChannel {
  if (!config || !config.token || !config.chatId) {
    return {
      name: 'telegram',
      enabled: () => false,
      send: async () => ({ ok: false, error: 'not configured', retriable: false }),
      sendMessage: async () => {},
      sendPermissionRequest: async () => {},
      sendStartup: async () => {},
      sendSessionIdle: async () => {},
      sendSessionError: async () => {},
      testConnection: async () => ({ ok: false, error: 'not configured' }),
      stop: () => {},
    }
  }

  const cfg = config
  const base = `https://api.telegram.org/bot${cfg.token}`
  let polling = true
  let offset = 0

  // Circuit breaker: open after 5 consecutive failures, retry after 60s
  const breaker = createCircuitBreaker({ maxFailures: 5, resetMs: 60_000 })

  async function rawFetch<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      getTelegramFetchTimeoutMs(),
    )
    try {
      const res = await fetch(`${base}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const json = (await res.json()) as { ok: boolean; result: T; description?: string }
      if (!json.ok) throw new Error(`Telegram API error: ${json.description ?? "unknown"}`)
      return json.result
    } finally {
      clearTimeout(timer)
    }
  }

  async function api<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      return await breaker.run(() => rawFetch<T>(method, body))
    } catch {
      // Circuit open or fetch error — silent fail, caller decides
      return null
    }
  }

  async function sendMessage(
    text: string,
    replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] },
  ): Promise<void> {
    await api("sendMessage", {
      chat_id: cfg.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
  }

  async function sendPermissionRequest(
    permissionId: string,
    title: string,
    sessionId: string,
  ): Promise<void> {
    const shortId = permissionId.slice(0, 12)
    const text = [
      `🔐 <b>Permission Request</b>`,
      ``,
      `<b>${escapeHtml(title)}</b>`,
      ``,
      `Session: <code>${sessionId.slice(0, 12)}…</code>`,
      `Permission ID: <code>${shortId}</code>`,
    ].join("\n")

    await sendMessage(text, {
      inline_keyboard: [
        [
          { text: "✅ Allow", callback_data: `allow:${permissionId}` },
          { text: "❌ Deny", callback_data: `deny:${permissionId}` },
        ],
      ],
    })
  }

  async function sendStartup(dashboardUrl: string): Promise<void> {
    await sendMessage(
      `🎮 <b>OpenCode Pilot Started</b>\n\nDashboard: <a href="${dashboardUrl}">Open</a>`,
    )
  }

  async function sendSessionIdle(sessionId: string, title: string): Promise<void> {
    await sendMessage(
      `✅ Session idle\n\n<b>${escapeHtml(title)}</b>\n<code>${sessionId.slice(0, 12)}…</code>`,
    )
  }

  async function sendSessionError(
    sessionId: string,
    title: string,
    error: string,
  ): Promise<void> {
    await sendMessage(
      `❌ Session error\n\n<b>${escapeHtml(title)}</b>\n\n<code>${escapeHtml(error.slice(0, TELEGRAM_ERROR_MAX_CHARS))}</code>`,
    )
  }

  // Exponential backoff: 5s → 10s → 30s → 60s (max), resets on success.
  const BACKOFF_STEPS = [5_000, 10_000, 30_000, 60_000]
  let backoffIdx = 0

  async function pollLoop(): Promise<void> {
    while (polling) {
      try {
        const updates = await rawFetch<Array<Record<string, unknown>>>("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["callback_query"],
        })

        // Success — reset backoff
        backoffIdx = 0

        for (const update of updates) {
          offset = (update.update_id as number) + 1
          if (update.callback_query) {
            await handleCallbackQuery(update.callback_query as Record<string, unknown>)
          }
        }
      } catch (err) {
        const delay = BACKOFF_STEPS[Math.min(backoffIdx, BACKOFF_STEPS.length - 1)]!
        if (logger) {
          logger.warn("Telegram polling failed", {
            error: err instanceof Error ? err.message : String(err),
            retryInMs: delay,
          })
        }
        backoffIdx = Math.min(backoffIdx + 1, BACKOFF_STEPS.length - 1)
        await sleep(delay)
      }
    }
  }

  async function handleCallbackQuery(cq: Record<string, unknown>): Promise<void> {
    const data = cq.data as string
    const colonIndex = data.indexOf(":")
    if (colonIndex === -1) return

    const action = data.slice(0, colonIndex)
    const permissionId = data.slice(colonIndex + 1)

    if ((action === "allow" || action === "deny") && permissionId) {
      const resolved =
        permissionQueue.resolve(permissionId, action as "allow" | "deny") ||
        codexPermissionQueue.resolve(permissionId, action as "allow" | "deny")

      if (!resolved) {
        // Stale callback — permission already resolved or expired
        await api("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: "⚠️ Permission expired or already resolved",
        })

        const message = cq.message as Record<string, unknown>
        if (message) {
          const chat = message.chat as Record<string, unknown>
          await api("editMessageText", {
            chat_id: chat.id,
            message_id: message.message_id,
            text: `${message.text}\n\n<b>⚠️ EXPIRED</b>`,
            parse_mode: "HTML",
          })
        }
        return
      }

      await api("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: action === "allow" ? "✅ Allowed" : "❌ Denied",
      })

      const message = cq.message as Record<string, unknown>
      if (message) {
        const chat = message.chat as Record<string, unknown>
        await api("editMessageText", {
          chat_id: chat.id,
          message_id: message.message_id,
          text: `${message.text}\n\n<b>${action === "allow" ? "✅ ALLOWED" : "❌ DENIED"}</b>`,
          parse_mode: "HTML",
        })
      }
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(
      /[&<>"']/g,
      (c) =>
        (
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }) as Record<string, string>
        )[c] ?? c,
    )
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  async function testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await rawFetch("getMe", {})
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Startup self-check — logs the result but never crashes
  testConnection()
    .then((r) => {
      if (!logger) return
      if (r.ok) {
        logger.info("Telegram bot connected")
      } else {
        logger.warn("Telegram bot connection failed", { error: r.error ?? "unknown" })
      }
    })
    .catch(() => {})

  // Start polling (fire and forget)
  pollLoop()

  async function send(event: import('../../ports').NotificationEvent): Promise<NotificationResult> {
    try {
      switch (event.kind) {
        case 'permission.pending': {
          const permissionID = String(event.payload.permissionID ?? '')
          const title = String(event.payload.title ?? '')
          const sessionID = String(event.payload.sessionID ?? '')
          await sendPermissionRequest(permissionID, title, sessionID)
          break
        }
        case 'session.error': {
          const sessionID = String(event.payload.sessionID ?? '')
          const title = String(event.payload.title ?? '')
          const error = String(event.payload.error ?? 'Unknown error')
          await sendSessionError(sessionID, title, error)
          break
        }
        case 'tool.completed':
        case 'permission.resolved':
        default:
          // These event kinds are handled via SSE; Telegram has no action for them
          break
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        retriable: true,
      }
    }
  }

  return {
    name: 'telegram',
    enabled: () => true,
    send,
    sendMessage: (text: string) => sendMessage(text),
    sendPermissionRequest,
    sendStartup,
    sendSessionIdle,
    sendSessionError,
    testConnection,
    stop: () => {
      polling = false
    },
  }
}

