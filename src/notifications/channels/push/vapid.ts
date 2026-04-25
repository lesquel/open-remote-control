// ─── VAPID key generation ─────────────────────────────────────────────────────
// Wraps the web-push generateVAPIDKeys function.
// Private to the push subsystem — used by service.ts and the generateVapidKeys
// handler (via injection through the composition root).

import type { Logger } from '../../../infra/logger/index'

type WebPushModule = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(sub: unknown, payload: string): Promise<unknown>
  generateVAPIDKeys?(): { publicKey: string; privateKey: string }
}

// Module-level cache so multiple callers share the same promise
let webPushPromise: Promise<WebPushModule | null> | null = null

/**
 * Lazily load the web-push module. Returns null if the module is unavailable
 * (web-push is an optional dep). Module-level cache prevents redundant loads.
 */
export async function loadWebPush(logger: Logger): Promise<WebPushModule | null> {
  if (webPushPromise) return webPushPromise
  webPushPromise = (async () => {
    try {
      const mod = (await import('web-push')) as unknown as
        | WebPushModule
        | { default: WebPushModule }
      return 'default' in (mod as Record<string, unknown>) &&
        typeof (mod as { default: WebPushModule }).default === 'object'
        ? (mod as { default: WebPushModule }).default
        : (mod as WebPushModule)
    } catch (err) {
      logger.warn('web-push module not available', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  })()
  return webPushPromise
}

export type VapidGenerateResult =
  | { ok: true; publicKey: string; privateKey: string }
  | { ok: false; error: string }

/**
 * Generate a fresh VAPID key pair using the web-push module.
 * Does NOT persist the keys — the caller is responsible for that.
 */
export async function generateVapidKeys(logger: Logger): Promise<VapidGenerateResult> {
  const wp = await loadWebPush(logger)
  if (!wp) {
    return { ok: false, error: 'web-push module not installed' }
  }
  if (typeof wp.generateVAPIDKeys !== 'function') {
    return { ok: false, error: 'web-push module does not expose generateVAPIDKeys' }
  }
  try {
    const { publicKey, privateKey } = wp.generateVAPIDKeys()
    return { ok: true, publicKey, privateKey }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
