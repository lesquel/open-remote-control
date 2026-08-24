/**
 * Normalize both the legacy string status and OpenCode v2's
 * `{ type: "idle" | "busy" | "retry" }` discriminated union.
 */
export function normalizeSessionStatus(status) {
  if (typeof status === 'string' && status.trim()) return status.trim().toLowerCase()
  if (status && typeof status === 'object' && typeof status.type === 'string' && status.type.trim()) {
    return status.type.trim().toLowerCase()
  }
  return 'idle'
}

export function normalizeStatusMap(statuses) {
  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) return {}
  return Object.fromEntries(
    Object.entries(statuses).map(([sessionID, status]) => [sessionID, normalizeSessionStatus(status)]),
  )
}
