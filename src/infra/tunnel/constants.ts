// ─── Tunnel-related constants ─────────────────────────────────────────────────
// Lives in infra/tunnel/ so tunnel/index.ts does not need to reach up to
// server/constants (the composition root).

/** Milliseconds to wait for a tunnel process to output its public URL. */
export const TUNNEL_START_TIMEOUT_MS = 20_000

/** Milliseconds to wait between SIGTERM and SIGKILL when stopping a tunnel. */
export const TUNNEL_KILL_GRACE_MS = 400

/** Regex patterns for extracting the public URL from tunnel process output. */
export const TUNNEL_URL_PATTERNS = {
  cloudflared: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  ngrok: /https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app/,
} as const
