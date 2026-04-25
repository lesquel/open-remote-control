// ─── Web Push service (full subsystem) ───────────────────────────────────────
// createPushService is the full subsystem entry point: it bundles VAPID
// configuration, subscription management, and the NotificationChannel surface.
//
// Wiring:
//   - The composition root creates push once via createPushService.
//   - push.channel is passed to createNotificationService as a NotificationChannel.
//   - The HTTP server receives push as a dep so the settings handler can call
//     push.addSubscription() and push.removeSubscription() etc. — no direct
//     import from notifications/channels/push/ inside transport/.
//
// See docs/REFACTOR-2026-04-architecture.md "Web Push subsystem (special case)"
// for the full dependency-rule rationale.

import type { Config } from '../../../server/config'
import type { AuditLog } from '../../../core/audit/log'
import type { Logger } from '../../../infra/logger/index'
import { createCircuitBreaker } from '../../../infra/circuit-breaker/index'
import type { NotificationChannel, NotificationResult } from '../../ports'
import { createSubscriptionStore } from './subscriptions'
import { loadWebPush, generateVapidKeys as generateVapidKeysUtil } from './vapid'
import type { VapidGenerateResult } from './vapid'
import type { PushSubscriptionJson, PushPayload } from './types'

// Re-export types so callers that previously imported from service.ts still work
export type { PushSubscriptionJson, PushPayload }
export type { PushSubscriptionKeys } from './types'
export type { VapidGenerateResult } from './vapid'

export interface PushService {
  /** The NotificationChannel slice — passed to the notification pipeline. */
  readonly channel: NotificationChannel
  isEnabled(): boolean
  /**
   * Add a Web Push subscription. Returns `{ ok: true }` on success.
   * Returns `{ ok: false; reason }` if the subscription is malformed or
   * fails SSRF-guard validation.
   */
  addSubscription(sub: PushSubscriptionJson): { ok: true } | { ok: false; reason: string }
  removeSubscription(endpoint: string): void
  broadcast(payload: PushPayload): Promise<void>
  sendTo(endpoint: string, payload: PushPayload): Promise<boolean>
  count(): number
  /**
   * Generate a fresh VAPID key pair. Does NOT persist the keys.
   * Delegates to vapid.ts — handler calls this via injection instead of
   * reimplementing web-push loading inline (avoids duplication).
   */
  generateVapid(): Promise<VapidGenerateResult>
}

function isValidSubscription(v: unknown): v is PushSubscriptionJson {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.endpoint !== 'string' || o.endpoint.length === 0) return false
  const keys = o.keys
  if (!keys || typeof keys !== 'object') return false
  const k = keys as Record<string, unknown>
  return typeof k.p256dh === 'string' && typeof k.auth === 'string'
}

/**
 * Validate a Web Push endpoint URL against SSRF vectors.
 *
 * Push endpoints MUST use HTTPS and MUST NOT resolve to localhost, link-local,
 * or RFC 1918 private ranges. An attacker registering a subscription with an
 * endpoint pointing at an internal service would turn the server into an SSRF
 * proxy — each broadcast call would make an outgoing POST to that URL.
 */
export function validateEndpoint(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'endpoint must use https:' }
  }
  const host = url.hostname.toLowerCase()
  // Loopback / unspecified
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    return { ok: false, reason: 'localhost endpoints are not allowed' }
  }
  // RFC 1918 private ranges (IPv4)
  if (/^10\./.test(host)) return { ok: false, reason: 'private IP range not allowed' }
  if (/^192\.168\./.test(host)) return { ok: false, reason: 'private IP range not allowed' }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { ok: false, reason: 'private IP range not allowed' }
  // Link-local (IPv4)
  if (/^169\.254\./.test(host)) return { ok: false, reason: 'link-local address not allowed' }
  // Unique-local / link-local (IPv6)
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return { ok: false, reason: 'private IPv6 range not allowed' }
  }
  return { ok: true }
}

export interface PushDeps {
  config: Config
  audit: AuditLog
  logger: Logger
}

type WebPushModule = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(sub: unknown, payload: string): Promise<unknown>
}

export function createPushService(deps: PushDeps): PushService {
  const { config, audit, logger } = deps

  const subscriptions = createSubscriptionStore()
  const breaker = createCircuitBreaker({ maxFailures: 5, resetMs: 60_000 })

  let configured = false
  const vapid = config.vapid

  async function ensureConfigured(): Promise<WebPushModule | null> {
    const wp = await loadWebPush(logger)
    if (!wp || !vapid) return null
    if (!configured) {
      try {
        wp.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
        configured = true
      } catch (err) {
        logger.warn('VAPID config invalid', {
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }
    return wp
  }

  function isEnabled(): boolean {
    return vapid !== null
  }

  function addSubscription(sub: PushSubscriptionJson): { ok: true } | { ok: false; reason: string } {
    if (!isValidSubscription(sub)) {
      return { ok: false, reason: 'invalid subscription shape' }
    }
    const endpointCheck = validateEndpoint(sub.endpoint)
    if (!endpointCheck.ok) {
      audit.log('push.subscribe_rejected', { endpoint: sub.endpoint, reason: endpointCheck.reason })
      logger.warn('push: rejected subscription endpoint (SSRF guard)', {
        endpoint: sub.endpoint,
        reason: endpointCheck.reason,
      })
      return endpointCheck
    }
    subscriptions.add(sub)
    audit.log('push.subscribed', { endpoint: sub.endpoint })
    return { ok: true }
  }

  function removeSubscription(endpoint: string): void {
    if (subscriptions.remove(endpoint)) {
      audit.log('push.unsubscribed', { endpoint })
    }
  }

  async function sendOne(
    wp: WebPushModule,
    sub: PushSubscriptionJson,
    payload: PushPayload,
  ): Promise<boolean> {
    try {
      await breaker.run(() =>
        wp.sendNotification(sub, JSON.stringify(payload)),
      )
      return true
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : 0
      if (status === 404 || status === 410) {
        subscriptions.remove(sub.endpoint)
        audit.log('push.subscription_expired', { endpoint: sub.endpoint, status })
        return false
      }
      audit.log('push.send_failed', {
        endpoint: sub.endpoint,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  async function broadcast(payload: PushPayload): Promise<void> {
    if (!isEnabled() || subscriptions.count() === 0) return
    const wp = await ensureConfigured()
    if (!wp) return

    const snapshot = subscriptions.all()
    await Promise.all(snapshot.map((sub) => sendOne(wp, sub, payload)))
  }

  async function sendTo(endpoint: string, payload: PushPayload): Promise<boolean> {
    if (!isEnabled()) return false
    const wp = await ensureConfigured()
    if (!wp) return false
    const sub = subscriptions.get(endpoint)
    if (!sub) return false
    return sendOne(wp, sub, payload)
  }

  function count(): number {
    return subscriptions.count()
  }

  // The NotificationChannel slice — used by the notification pipeline
  const channel: NotificationChannel = {
    name: 'push',
    enabled: isEnabled,
    async send(event): Promise<NotificationResult> {
      if (!isEnabled()) {
        return { ok: false, error: 'web push not configured', retriable: false }
      }
      if (subscriptions.count() === 0) {
        return { ok: false, error: 'no push subscribers', retriable: false }
      }
      const payload: PushPayload = {
        title: String(event.payload.title ?? 'OpenCode Pilot'),
        body: String(event.payload.body ?? event.kind),
        data: event.payload,
      }
      try {
        await broadcast(payload)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        }
      }
    },
  }

  async function generateVapid(): Promise<VapidGenerateResult> {
    return generateVapidKeysUtil(logger)
  }

  return { channel, isEnabled, addSubscription, removeSubscription, broadcast, sendTo, count, generateVapid }
}
