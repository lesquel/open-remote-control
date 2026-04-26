// ─── Telegram channel constants ───────────────────────────────────────────────
// Telegram-specific limits and configuration — lives next to the channel that
// uses them so they do not need to live in server/ (the composition root).

/** Maximum number of characters included in a Telegram error message.
 *  Telegram messages have a 4096-char limit; we truncate error strings to this
 *  value to leave headroom for the surrounding HTML template. */
export const TELEGRAM_ERROR_MAX_CHARS = 500
