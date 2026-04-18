import type { TelegramConfig } from "../config"
import type { PermissionQueue } from "./permission-queue"
import type { Logger } from "../util/logger"
import { createCircuitBreaker } from "../util/circuit-breaker"

/** Default fetch timeout for all Telegram API calls. */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000

function getTelegramFetchTimeoutMs(): number {
  const raw = process.env.PILOT_FETCH_TIMEOUT_MS
  if (!raw) return DEFAULT_FETCH_TIMEOUT_MS
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FETCH_TIMEOUT_MS
}

export interface TelegramBot {
  enabled: boolean
  sendMessage(text: string): Promise<void>
  sendPermissionRequest(permissionId: string, title: string, sessionId: string): Promise<void>
  sendStartup(dashboardUrl: string): Promise<void>
  sendSessionIdle(sessionId: string, title: string): Promise<void>
  sendSessionError(sessionId: string, title: string, error: string): Promise<void>
  /** One-shot getMe check — useful for startup verification. */
  testConnection(): Promise<{ ok: boolean; error?: string }>
  stop(): void
}

interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export function createTelegramBot(
  config: TelegramConfig | null,
  permissionQueue: PermissionQueue,
  logger?: Logger,
): TelegramBot {
  if (!config || !config.token || !config.chatId) {
    return {
      enabled: false,
      sendMessage: async () => {},
      sendPermissionRequest: async () => {},
      sendStartup: async () => {},
      sendSessionIdle: async () => {},
      sendSessionError: async () => {},
      testConnection: async () => ({ ok: false, error: "not configured" }),
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
      `❌ Session error\n\n<b>${escapeHtml(title)}</b>\n\n<code>${escapeHtml(error.slice(0, 500))}</code>`,
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
      permissionQueue.resolve(permissionId, action as "allow" | "deny")

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

  return {
    enabled: true,
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
