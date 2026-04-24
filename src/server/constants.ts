// ─── Shared constants ────────────────────────────────────────────────────────
// Single source of truth for magic numbers and version strings.

export const PILOT_VERSION = "1.17.0"
export const DEFAULT_PORT = 4097
// Default host: `0.0.0.0` so the dashboard is immediately reachable from LAN
// (phone, second laptop) without the user needing to discover the host
// setting. Every HTTP endpoint still requires a Bearer token, so this widens
// the network surface but NOT the auth surface — an attacker on the same
// network still needs the generated token (printed in the `/remote` banner
// and embedded in the QR code) to do anything. Users who want the stricter
// localhost-only bind can set `PILOT_HOST=127.0.0.1` in the .env or in the
// Settings modal's Connection tab.
export const DEFAULT_HOST = "0.0.0.0"
export const DEFAULT_PERMISSION_TIMEOUT_MS = 300_000
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000
export const BUN_SERVE_IDLE_TIMEOUT_SEC = 255

export const LOCALHOST_ADDRESSES = ["127.0.0.1", "localhost", "::1", "0.0.0.0"] as const
export const VAPID_DEFAULT_SUBJECT = "mailto:admin@opencode-pilot.local"
export const TUNNEL_START_TIMEOUT_MS = 20_000
export const TUNNEL_KILL_GRACE_MS = 400
export const TOAST_DURATION_MS = 5_000
export const TOAST_PROMOTION_DURATION_MS = 7_000
export const PROMOTION_POLL_INTERVAL_MS = 500
export const TELEGRAM_ERROR_MAX_CHARS = 500
export const TUNNEL_URL_PATTERNS = {
  cloudflared: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  ngrok: /https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app/,
} as const
export const HTTP_STATUS = {
  OK: 200, CREATED: 201, NO_CONTENT: 204,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, INTERNAL: 500, UNAVAILABLE: 503,
} as const

/** Maximum accepted request body size (1 MiB). Requests with a larger
 *  Content-Length header, or whose streamed body exceeds this, are rejected
 *  with 413 Payload Too Large. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576 // 1 MiB

/** Default project-state write mode: write per-project files only when
 *  `.opencode/` already exists (opt-in via `always`, disable via `off`). */
export const DEFAULT_PROJECT_STATE_MODE = "auto" as const
