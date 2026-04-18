// ─── Web Push service ────────────────────────────────────────────────────────
// Wraps web-push's sendNotification for broadcasting to all subscribed clients.
// Dead subscriptions (HTTP 404/410) are removed automatically.

import type { Config } from "../config"
import type { AuditLog } from "./audit"
import type { Logger } from "../util/logger"
import { createCircuitBreaker } from "../util/circuit-breaker"

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
  addSubscription(sub: PushSubscriptionJson): void
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

  function addSubscription(sub: PushSubscriptionJson): void {
    if (!isValidSubscription(sub)) return
    subscriptions.set(sub.endpoint, sub)
    audit.log("push.subscribed", { endpoint: sub.endpoint })
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
