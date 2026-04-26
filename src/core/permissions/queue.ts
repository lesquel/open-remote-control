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
  const waiters = new Map<
    string,
    {
      resolve: (value: { action: "allow" | "deny" } | null) => void
      createdAt: number
      timeoutId: ReturnType<typeof setTimeout>
      meta: PermissionMeta
    }
  >()

  function waitForResponse(
    permissionID: string,
    meta: PermissionMeta = {},
  ): Promise<{ action: "allow" | "deny" } | null> {
    return new Promise((resolvePromise) => {
      const timeoutId = setTimeout(() => {
        const waiter = waiters.get(permissionID)
        if (waiter) {
          waiters.delete(permissionID)
          waiter.resolve(null)
        }
      }, timeoutMs)
      waiters.set(permissionID, { resolve: resolvePromise, createdAt: Date.now(), timeoutId, meta })
    })
  }

  function resolve(permissionID: string, action: "allow" | "deny"): boolean {
    const waiter = waiters.get(permissionID)
    if (waiter) {
      clearTimeout(waiter.timeoutId)
      waiters.delete(permissionID)
      waiter.resolve({ action })
      return true
    }
    return false
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
