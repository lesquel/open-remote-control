export interface PermissionMeta {
  title?: string
  sessionID?: string
  type?: string
  pattern?: string
  metadata?: Record<string, unknown>
}

export interface PendingPermission {
  permissionID: string
  createdAt: number
  resolved: boolean
  title?: string
  sessionID?: string
  type?: string
  pattern?: string
  metadata?: Record<string, unknown>
}

export interface PermissionQueue {
  waitForResponse(
    permissionID: string,
    meta?: PermissionMeta,
  ): Promise<{ action: "allow" | "deny" } | null>
  /** Returns true when a waiter was found and resolved; false when the ID was unknown. */
  resolve(permissionID: string, action: "allow" | "deny"): boolean
  pending(): PendingPermission[]
}

export function createPermissionQueue(timeoutMs: number): PermissionQueue {
  type Response = { action: "allow" | "deny" } | null
  interface Waiter {
    resolve: (value: Response) => void
    promise: Promise<Response>
    createdAt: number
    timeoutId: ReturnType<typeof setTimeout>
    meta: PermissionMeta
  }
  const waiters = new Map<string, Waiter>()

  function settle(permissionID: string, waiter: Waiter, value: Response): boolean {
    if (waiters.get(permissionID) !== waiter) return false
    clearTimeout(waiter.timeoutId)
    waiters.delete(permissionID)
    waiter.resolve(value)
    return true
  }

  function waitForResponse(
    permissionID: string,
    meta: PermissionMeta = {},
  ): Promise<{ action: "allow" | "deny" } | null> {
    const existing = waiters.get(permissionID)
    if (existing) return existing.promise

    let resolvePromise: (value: Response) => void = () => undefined
    const promise = new Promise<Response>((resolve) => { resolvePromise = resolve })
    let waiter: Waiter
    const timeoutId = setTimeout(() => settle(permissionID, waiter, null), timeoutMs)
    waiter = { resolve: resolvePromise, promise, createdAt: Date.now(), timeoutId, meta }
    waiters.set(permissionID, waiter)
    return promise
  }

  function resolve(permissionID: string, action: "allow" | "deny"): boolean {
    const waiter = waiters.get(permissionID)
    return waiter ? settle(permissionID, waiter, { action }) : false
  }

  function pending(): PendingPermission[] {
    return Array.from(waiters.entries()).map(([id, w]) => ({
      permissionID: id,
      createdAt: w.createdAt,
      resolved: false,
      ...w.meta,
    }))
  }

  return { waitForResponse, resolve, pending }
}
