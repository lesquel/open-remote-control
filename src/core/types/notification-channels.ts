// ─── Notification channel dependency types (core) ─────────────────────────────
// Self-contained interface definitions for TelegramChannel, PushService, and
// PushSubscriptionJson — the channel dep types needed by transport/http/routes.ts.
//
// Lives in core/types/ so transport/ can import these types without creating a
// cross-sibling dependency on notifications/. No imports from notifications/ here —
// these are abstract contracts. The concrete implementations in
// notifications/channels/{telegram,push}/ satisfy these interfaces structurally.
//
// The composition root (server/index.ts) wires the real implementations to
// the RouteDeps slots typed by these interfaces.

// ─── Web Push ────────────────────────────────────────────────────────────────

export interface PushSubscriptionJson {
  endpoint: string
  expirationTime?: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

interface PushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

type VapidGenerateResult =
  | { ok: true; publicKey: string; privateKey: string }
  | { ok: false; error: string }

/** Full Web Push subsystem injected via RouteDeps. */
export interface PushService {
  isEnabled(): boolean
  addSubscription(sub: PushSubscriptionJson): { ok: true } | { ok: false; reason: string }
  removeSubscription(endpoint: string): void
  broadcast(payload: PushPayload): Promise<void>
  sendTo(endpoint: string, payload: PushPayload): Promise<boolean>
  count(): number
  generateVapid(): Promise<VapidGenerateResult>
}

// ─── Telegram ────────────────────────────────────────────────────────────────

/** Telegram channel injected via RouteDeps. */
export interface TelegramChannel {
  readonly name: 'telegram'
  enabled(): boolean
  sendMessage(text: string): Promise<void>
  sendPermissionRequest(permissionId: string, title: string, sessionId: string): Promise<void>
  sendStartup(dashboardUrl: string): Promise<void>
  sendSessionIdle(sessionId: string, title: string): Promise<void>
  sendSessionError(sessionId: string, title: string, error: string): Promise<void>
  testConnection(): Promise<{ ok: boolean; error?: string }>
  stop(): void
}
