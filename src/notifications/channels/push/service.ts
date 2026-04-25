// ─── Web Push service ────────────────────────────────────────────────────────
// Wraps web-push's sendNotification for broadcasting to all subscribed clients.
// Dead subscriptions (HTTP 404/410) are removed automatically.

import type { Config } from "../../../server/config"
import type { AuditLog } from "../../../core/audit/log"
import type { Logger } from "../../../infra/logger/index"
import { createCircuitBreaker } from "../../../infra/circuit-breaker/index"

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

export interface PushService {
  isEnabled(): boolean
  /**
   * Add a Web Push subscription. Returns `{ ok: true }` on success.
   * Returns `{ ok: false; reason }` if the subscription object is malformed or
   * the endpoint fails SSRF-guard validation (non-HTTPS, localhost, private IP).
   */
  addSubscription(sub: PushSubscriptionJson): { ok: true } | { ok: false; reason: string }
  removeSubscription(endpoint: string): void
  broadcast(payload: PushPayload): Promise<void>
  sendTo(endpoint: string, payload: PushPayload): Promise<boolean>
  count(): number
}

function isValidSubscription(v: unknown): v is PushSubscriptionJson {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.endpoint !== "string" || o.endpoint.length === 0) return false
  const keys = o.keys
  if (!keys || typeof keys !== "object") return false
  const k = keys as Record<string, unknown>
  return typeof k.p256dh === "string" && typeof k.auth === "string"
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
    return { ok: false, reason: "invalid URL" }
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "endpoint must use https:" }
  }
  const host = url.hostname.toLowerCase()
  // Loopback / unspecified
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    return { ok: false, reason: "localhost endpoints are not allowed" }
  }
  // RFC 1918 private ranges (IPv4)
  if (/^10\./.test(host)) return { ok: false, reason: "private IP range not allowed" }
  if (/^192\.168\./.test(host)) return { ok: false, reason: "private IP range not allowed" }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { ok: false, reason: "private IP range not allowed" }
  // Link-local (IPv4)
  if (/^169\.254\./.test(host)) return { ok: false, reason: "link-local address not allowed" }
  // Unique-local / link-local (IPv6)
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return { ok: false, reason: "private IPv6 range not allowed" }
  }
  return { ok: true }
}

export interface PushDeps {
  config: Config
  audit: AuditLog
  logger: Logger
}

// web-push is loaded lazily so the plugin still boots if the dep is missing.
// This mirrors how telegram is tolerated when config is absent.
type WebPushModule = typeof import("web-push")
let webPushPromise: Promise<WebPushModule | null> | null = null

async function loadWebPush(logger: Logger): Promise<WebPushModule | null> {
  if (webPushPromise) return webPushPromise
  webPushPromise = (async () => {
    try {
      const mod = (await import("web-push")) as unknown as
        | WebPushModule
        | { default: WebPushModule }
      // Some bundlers wrap CJS into { default: ... }
      return "default" in (mod as Record<string, unknown>) &&
        typeof (mod as { default: WebPushModule }).default === "object"
        ? (mod as { default: WebPushModule }).default
        : (mod as WebPushModule)
    } catch (err) {
      logger.warn("web-push module not available", {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  })()
  return webPushPromise
}

export function createPushService(deps: PushDeps): PushService {
  const { config, audit, logger } = deps

  const subscriptions = new Map<string, PushSubscriptionJson>()
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
        logger.warn("VAPID config invalid", {
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
      return { ok: false, reason: "invalid subscription shape" }
    }
    const endpointCheck = validateEndpoint(sub.endpoint)
    if (!endpointCheck.ok) {
      audit.log("push.subscribe_rejected", { endpoint: sub.endpoint, reason: endpointCheck.reason })
      logger.warn("push: rejected subscription endpoint (SSRF guard)", {
        endpoint: sub.endpoint,
        reason: endpointCheck.reason,
      })
      return endpointCheck
    }
    subscriptions.set(sub.endpoint, sub)
    audit.log("push.subscribed", { endpoint: sub.endpoint })
    return { ok: true }
  }

  function removeSubscription(endpoint: string): void {
    if (subscriptions.delete(endpoint)) {
      audit.log("push.unsubscribed", { endpoint })
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
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : 0
      if (status === 404 || status === 410) {
        subscriptions.delete(sub.endpoint)
        audit.log("push.subscription_expired", { endpoint: sub.endpoint, status })
        return false
      }
      audit.log("push.send_failed", {
        endpoint: sub.endpoint,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  async function broadcast(payload: PushPayload): Promise<void> {
    if (!isEnabled() || subscriptions.size === 0) return
    const wp = await ensureConfigured()
    if (!wp) return

    const snapshot = Array.from(subscriptions.values())
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
    return subscriptions.size
  }

  return { isEnabled, addSubscription, removeSubscription, broadcast, sendTo, count }
}
