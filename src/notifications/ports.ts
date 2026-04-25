// ─── Notification port ────────────────────────────────────────────────────────
// The contract honored by every outbound notification channel (Telegram, Web
// Push, and any future channel — Slack, Discord, email, webhook).
//
// `NotificationChannel` is one of two explicit ports in the architecture. See
// docs/REFACTOR-2026-04-architecture.md §Ports for design rationale.

export interface NotificationChannel {
  readonly name: string
  readonly enabled: () => boolean
  readonly send: (event: NotificationEvent) => Promise<NotificationResult>
}

export type NotificationEvent = {
  kind:
    | 'permission.pending'
    | 'permission.resolved'
    | 'tool.completed'
    | 'session.error'
  payload: Record<string, unknown>
}

export type NotificationResult =
  | { ok: true }
  | { ok: false; error: string; retriable: boolean }
