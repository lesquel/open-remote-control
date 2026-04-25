// ─── Subscription store ───────────────────────────────────────────────────────
// Maintains an in-memory map of active push subscriptions.
// Private to the push subsystem — only used by service.ts.

import type { PushSubscriptionJson } from './types'

export interface SubscriptionStore {
  add(sub: PushSubscriptionJson): void
  remove(endpoint: string): boolean
  get(endpoint: string): PushSubscriptionJson | undefined
  all(): PushSubscriptionJson[]
  count(): number
}

export function createSubscriptionStore(): SubscriptionStore {
  const map = new Map<string, PushSubscriptionJson>()

  function add(sub: PushSubscriptionJson): void {
    map.set(sub.endpoint, sub)
  }

  function remove(endpoint: string): boolean {
    return map.delete(endpoint)
  }

  function get(endpoint: string): PushSubscriptionJson | undefined {
    return map.get(endpoint)
  }

  function all(): PushSubscriptionJson[] {
    return Array.from(map.values())
  }

  function count(): number {
    return map.size
  }

  return { add, remove, get, all, count }
}
