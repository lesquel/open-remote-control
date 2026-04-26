// ─── Tunnel provider types ────────────────────────────────────────────────────
// Source of truth for the TunnelProvider union — lives in infra/ so tunnel/
// internals and any other infra module can reference it without importing from
// server/ (the composition root).

export type TunnelProvider = "off" | "cloudflared" | "ngrok"
