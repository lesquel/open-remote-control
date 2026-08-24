export type ActivityEntry = { id: string; key: string; kind: string; title: string; detail: string; sessionID: string; project: string; createdAt: number; attention: boolean; resolved: boolean; read: boolean }
export function createActivityStore(options?: { storage?: Pick<Storage, "getItem" | "setItem">; now?: () => number }): {
  list(): ActivityEntry[]
  add(input: Partial<ActivityEntry>): ActivityEntry
  resolve(key: string): boolean
  reconcileAttention(project: string | null | undefined, activeKeys: Set<string>): boolean
  markAllRead(): void
  clearRecent(): void
  counts(): { unread: number; attention: number }
  subscribe(listener: (entries: ActivityEntry[]) => void): () => void
}
export function getActivityStore(): ReturnType<typeof createActivityStore>
