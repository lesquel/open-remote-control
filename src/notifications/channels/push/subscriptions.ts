import { readFileSync } from "node:fs"
import { stateFile } from "../../../infra/paths/index"
import { writePrivateFile } from "../../../infra/fs/private-file"
import type { PushSubscriptionJson } from './types'

const SUBSCRIPTION_STORE_VERSION = 1

interface PersistedSubscriptions {
  version: typeof SUBSCRIPTION_STORE_VERSION
  subscriptions: PushSubscriptionJson[]
}

export interface SubscriptionStore {
  add(sub: PushSubscriptionJson): void
  remove(endpoint: string): boolean
  get(endpoint: string): PushSubscriptionJson | undefined
  all(): PushSubscriptionJson[]
  count(): number
}

interface SubscriptionStoreOptions {
  filePath?: string
  accept?: (subscription: PushSubscriptionJson) => boolean
  onLoadError?: (error: Error) => void
}

interface LoadedSubscriptions {
  map: Map<string, PushSubscriptionJson>
  writable: boolean
}

function isSubscription(value: unknown): value is PushSubscriptionJson {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length === 0) return false
  if (!candidate.keys || typeof candidate.keys !== "object") return false
  const keys = candidate.keys as Record<string, unknown>
  return typeof keys.p256dh === "string" && typeof keys.auth === "string"
}

function loadSubscriptions(
  filePath: string,
  accept: (subscription: PushSubscriptionJson) => boolean,
  onLoadError: ((error: Error) => void) | undefined,
): LoadedSubscriptions {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object") throw new Error("Push subscription state must be an object")
    const state = parsed as Record<string, unknown>
    if (state.version !== SUBSCRIPTION_STORE_VERSION) {
      onLoadError?.(new Error("Unsupported push subscription state version"))
      return { map: new Map(), writable: false }
    }
    if (!Array.isArray(state.subscriptions)) {
      throw new Error("Push subscription state is missing subscriptions")
    }
    const entries = state.subscriptions.filter(
      (subscription): subscription is PushSubscriptionJson =>
        isSubscription(subscription) && accept(subscription),
    )
    return {
      map: new Map(entries.map((subscription) => [subscription.endpoint, subscription])),
      writable: true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { map: new Map(), writable: true }
    }
    onLoadError?.(error instanceof Error ? error : new Error(String(error)))
    return { map: new Map(), writable: true }
  }
}

export function createSubscriptionStore(options: SubscriptionStoreOptions = {}): SubscriptionStore {
  const filePath = options.filePath ?? stateFile("push-subscriptions.json")
  const loaded = loadSubscriptions(filePath, options.accept ?? (() => true), options.onLoadError)
  let map = loaded.map

  function persist(candidate: Map<string, PushSubscriptionJson>): void {
    if (!loaded.writable) {
      throw new Error("Refusing to overwrite a newer push subscription state version")
    }
    const state: PersistedSubscriptions = {
      version: SUBSCRIPTION_STORE_VERSION,
      subscriptions: Array.from(candidate.values()),
    }
    writePrivateFile(filePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  function add(sub: PushSubscriptionJson): void {
    const candidate = new Map(map)
    candidate.set(sub.endpoint, sub)
    persist(candidate)
    map = candidate
  }

  function remove(endpoint: string): boolean {
    if (!map.has(endpoint)) return false
    const candidate = new Map(map)
    candidate.delete(endpoint)
    persist(candidate)
    map = candidate
    return true
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
