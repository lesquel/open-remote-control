export interface PermissionMeta {
  /** Immutable identity of the agent that owns this request (for example, opencode or codex). */
  integrationID?: string
  /** Canonical project identity. Pilot currently uses the canonical directory for this value. */
  projectID?: string
  /** Canonical project directory supplied by the integration, never by the dashboard. */
  directory?: string
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
  integrationID?: string
  projectID?: string
  directory?: string
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
  /**
   * Resolve a request once. A complete context selects an exact request; a
   * legacy ID-only call is accepted only when that ID maps to exactly one waiter.
   */
  resolve(permissionID: string, action: "allow" | "deny", context?: PermissionContext): boolean
  pending(): PendingPermission[]
}

export interface PermissionContext {
  integrationID: string
  projectID: string
  directory: string
  sessionID: string
}

export function createPermissionQueue(timeoutMs: number): PermissionQueue {
  type Response = { action: "allow" | "deny" } | null
  interface Waiter {
    permissionID: string
    resolve: (value: Response) => void
    promise: Promise<Response>
    createdAt: number
    timeoutId: ReturnType<typeof setTimeout>
    meta: PermissionMeta
  }
  const waiters = new Map<string, Waiter>()

  function keyFor(permissionID: string, meta: PermissionMeta): string {
    if (
      meta.integrationID &&
      meta.projectID &&
      meta.directory &&
      meta.sessionID
    ) {
      return JSON.stringify([
        "context",
        meta.integrationID,
        meta.projectID,
        meta.directory,
        meta.sessionID,
        permissionID,
      ])
    }
    return `legacy\u0000${permissionID}`
  }

  function settle(key: string, waiter: Waiter, value: Response): boolean {
    if (waiters.get(key) !== waiter) return false
    clearTimeout(waiter.timeoutId)
    waiters.delete(key)
    waiter.resolve(value)
    return true
  }

  function waitForResponse(
    permissionID: string,
    meta: PermissionMeta = {},
  ): Promise<{ action: "allow" | "deny" } | null> {
    const key = keyFor(permissionID, meta)
    const existing = waiters.get(key)
    if (existing) return existing.promise

    let resolvePromise: (value: Response) => void = () => undefined
    const promise = new Promise<Response>((resolve) => { resolvePromise = resolve })
    let waiter: Waiter
    const timeoutId = setTimeout(() => settle(key, waiter, null), timeoutMs)
    waiter = { permissionID, resolve: resolvePromise, promise, createdAt: Date.now(), timeoutId, meta }
    waiters.set(key, waiter)
    return promise
  }

  function resolve(permissionID: string, action: "allow" | "deny", context?: PermissionContext): boolean {
    const matches = context
      ? [[keyFor(permissionID, context), waiters.get(keyFor(permissionID, context))] as const]
      : [...waiters.entries()].filter(([, waiter]) => permissionID === waiter.permissionID)
    if (matches.length !== 1) return false
    const [key, waiter] = matches[0]
    return waiter ? settle(key, waiter, { action }) : false
  }

  function pending(): PendingPermission[] {
    return Array.from(waiters.values()).map((w) => ({
      permissionID: w.permissionID,
      createdAt: w.createdAt,
      resolved: false,
      ...w.meta,
    }))
  }

  return { waitForResponse, resolve, pending }
}
