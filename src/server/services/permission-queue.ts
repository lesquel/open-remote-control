export interface PendingPermission {
  permissionID: string
  createdAt: number
  resolved: boolean
}

export interface PermissionQueue {
  waitForResponse(permissionID: string): Promise<{ action: "allow" | "deny" } | null>
  resolve(permissionID: string, action: "allow" | "deny"): void
  pending(): PendingPermission[]
}

export function createPermissionQueue(timeoutMs: number): PermissionQueue {
  const waiters = new Map<
    string,
    { resolve: (value: { action: "allow" | "deny" } | null) => void; createdAt: number }
  >()

  function waitForResponse(
    permissionID: string,
  ): Promise<{ action: "allow" | "deny" } | null> {
    return new Promise((resolvePromise) => {
      waiters.set(permissionID, { resolve: resolvePromise, createdAt: Date.now() })

      setTimeout(() => {
        const waiter = waiters.get(permissionID)
        if (waiter) {
          waiters.delete(permissionID)
          waiter.resolve(null)
        }
      }, timeoutMs)
    })
  }

  function resolve(permissionID: string, action: "allow" | "deny"): void {
    const waiter = waiters.get(permissionID)
    if (waiter) {
      waiters.delete(permissionID)
      waiter.resolve({ action })
    }
  }

  function pending(): PendingPermission[] {
    return Array.from(waiters.entries()).map(([id, w]) => ({
      permissionID: id,
      createdAt: w.createdAt,
      resolved: false,
    }))
  }

  return { waitForResponse, resolve, pending }
}
