// ─── User-facing strings ─────────────────────────────────────────────────────
// Centralised home for the most visible error messages shown to end users.
// Import MSG and reference by key — keeps wording consistent and makes
// copy-edits a single-file change.

export const MSG = {
  WEB_PUSH_NOT_CONFIGURED:
    "Web Push not configured. Open Settings > Plugin configuration > 'Generate VAPID keys' and Save. Restart OpenCode to apply.",
  TELEGRAM_NOT_CONFIGURED:
    "Telegram notifications disabled. Set PILOT_TELEGRAM_TOKEN and PILOT_TELEGRAM_CHAT_ID — see docs/CONFIGURATION.md.",
  GLOB_DISABLED:
    "File search is disabled. Enable it in Settings > Plugin configuration > 'Enable file glob search' (requires restart).",
  TUNNEL_DISABLED:
    "Tunnel is off. Set PILOT_TUNNEL=cloudflared (or ngrok) and restart OpenCode to enable remote access.",
  UNAUTHORIZED_BANNER:
    "Unauthorized. Run /remote in OpenCode to get a fresh dashboard URL.",
  INVALID_PORT: (raw: string) => `Invalid PILOT_PORT: "${raw}". Must be 1–65535.`,
  INVALID_TUNNEL: (raw: string) =>
    `Invalid PILOT_TUNNEL value "${raw}". Must be one of: off, cloudflared, ngrok.`,
} as const
