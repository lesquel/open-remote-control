// ─── HTTP plumbing constants ──────────────────────────────────────────────────
// Lives in infra/http/ so transport/, integrations/, and notifications/ can
// reference these values without importing from server/ (the composition root).

/** Maximum accepted request body size (1 MiB). Requests with a larger
 *  Content-Length header, or whose streamed body exceeds this, are rejected
 *  with 413 Payload Too Large. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576 // 1 MiB

export const HTTP_STATUS = {
  OK: 200, CREATED: 201, NO_CONTENT: 204,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, INTERNAL: 500, UNAVAILABLE: 503,
} as const

/** Bun's hard idle-timeout ceiling in seconds.
 *  Values above this cause Bun to close long-polling connections before a
 *  structured response can be sent. */
export const BUN_SERVE_IDLE_TIMEOUT_SEC = 255

/** Addresses considered localhost/loopback for host validation. */
export const LOCALHOST_ADDRESSES = ["127.0.0.1", "localhost", "::1", "0.0.0.0"] as const

/** Default VAPID subject used when the user has not configured one. */
export const VAPID_DEFAULT_SUBJECT = "mailto:admin@opencode-pilot.local"

/** Default HTTP port the server listens on. */
export const DEFAULT_PORT = 4097

/** Default HTTP host — 0.0.0.0 so the dashboard is immediately reachable from
 *  LAN (phone, second laptop) without the user needing to set PILOT_HOST.
 *  Every endpoint still requires a Bearer token. */
export const DEFAULT_HOST = "0.0.0.0"
