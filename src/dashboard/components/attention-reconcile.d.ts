import type { ActivityEntry, createActivityStore } from "./activity-store.js"

type AttentionStore = ReturnType<typeof createActivityStore>

export function attentionKey(kind: "permission" | "question", project: string | null | undefined, id: string): string
export function reconcileAttentionSnapshots(input: {
  store: AttentionStore
  project: string | null | undefined
  permissions?: Array<Record<string, unknown>>
  questions?: Array<Record<string, unknown>>
}): Set<string>
