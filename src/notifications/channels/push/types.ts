// ─── Web Push types ───────────────────────────────────────────────────────────

export interface PushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface PushSubscriptionJson {
  endpoint: string
  expirationTime?: number | null
  keys: PushSubscriptionKeys
}

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}
