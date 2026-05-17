// ─── Server / composition-root constants ─────────────────────────────────────
// Only constants that are EXCLUSIVELY used here at the composition root,
// or that have a hard external reference (e.g. PILOT_VERSION is read by the
// asset-sanity test via readFileSync — do NOT move it).
//
// HTTP-transport constants (MAX_REQUEST_BODY_BYTES, HTTP_STATUS,
// BUN_SERVE_IDLE_TIMEOUT_SEC, LOCALHOST_ADDRESSES, VAPID_DEFAULT_SUBJECT,
// DEFAULT_PORT, DEFAULT_HOST) live in src/infra/http/constants.ts.
//
// Tunnel constants (TUNNEL_START_TIMEOUT_MS, TUNNEL_KILL_GRACE_MS,
// TUNNEL_URL_PATTERNS) live in src/infra/tunnel/constants.ts.
//
// Telegram constants (TELEGRAM_ERROR_MAX_CHARS) live in
// src/notifications/channels/telegram/constants.ts.
//
// Attachment proxy constants (ATTACHMENT_MAX_BYTES, MIME_SAFELIST) live in
// src/infra/http/constants.ts.

export const PILOT_VERSION = "1.21.0"
export const DEFAULT_PERMISSION_TIMEOUT_MS = 300_000
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000
export const TOAST_DURATION_MS = 5_000
export const TOAST_PROMOTION_DURATION_MS = 7_000
export const PROMOTION_POLL_INTERVAL_MS = 500

/** Default project-state write mode: write per-project files only when
 *  `.opencode/` already exists (opt-in via `always`, disable via `off`). */
export const DEFAULT_PROJECT_STATE_MODE = "auto" as const

/** Maximum safe value for PILOT_CODEX_PERMISSION_TIMEOUT_MS.
 *  Bun's idleTimeout cap is 255s. Any codex permission timeout ≥255s would
 *  cause Bun to close the long-polling connection before a structured deny
 *  response can be sent, so Codex would see a connection reset instead of JSON.
 *  We enforce ≤250s (5s safety margin) at config parse time. */
export const MAX_CODEX_PERMISSION_TIMEOUT_MS = 250_000

/** Default timeout (ms) for Codex permission requests via the hook bridge.
 *  Capped at 250 000ms — safely below Bun's 255s idleTimeout.
 *  Independently configurable via PILOT_CODEX_PERMISSION_TIMEOUT_MS. */
export const DEFAULT_CODEX_PERMISSION_TIMEOUT_MS = 250_000
