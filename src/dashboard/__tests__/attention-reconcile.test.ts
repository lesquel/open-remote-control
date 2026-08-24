import { describe, expect, test } from "bun:test"
import { createActivityStore } from "../components/activity-store.js"
import { attentionKey, reconcileAttentionSnapshots } from "../components/attention-reconcile.js"

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
}

describe("canonical attention reconciliation", () => {
  test("restores missed pending permission and question exactly once after reconnect", () => {
    const store = createActivityStore({ storage: memoryStorage(), now: () => 10 })
    const snapshot = {
      project: "/projects/a",
      permissions: [{ id: "permission-a", title: "Run command", sessionID: "session-a", pattern: "git status" }],
      questions: [{ id: "question-a", sessionID: "session-a", questions: [{ header: "Choose", question: "Continue?" }] }],
    }

    // The event may have been received before reconnect. The canonical pass
    // must reuse its stable project-scoped keys rather than creating copies.
    store.add({
      key: attentionKey("permission", "/projects/a", "permission-a"),
      kind: "permission", title: "Run command", project: "/projects/a", attention: true,
    })
    store.add({
      key: attentionKey("question", "/projects/a", "question-a"),
      kind: "question", title: "Choose", project: "/projects/a", attention: true,
    })

    reconcileAttentionSnapshots({ store, ...snapshot })
    reconcileAttentionSnapshots({ store, ...snapshot })

    expect(store.list()).toHaveLength(2)
    expect(store.counts().attention).toBe(2)
    expect(store.list().map(entry => entry.key)).toEqual([
      attentionKey("question", "/projects/a", "question-a"),
      attentionKey("permission", "/projects/a", "permission-a"),
    ])
  })

  test("resolves only stale attention from the refreshed project", () => {
    const store = createActivityStore({ storage: memoryStorage(), now: () => 10 })
    const staleA = attentionKey("permission", "/projects/a", "stale-a")
    const pendingB = attentionKey("permission", "/projects/b", "pending-b")
    store.add({ key: staleA, kind: "permission", title: "A", project: "/projects/a", attention: true })
    store.add({ key: pendingB, kind: "permission", title: "B", project: "/projects/b", attention: true })

    reconcileAttentionSnapshots({ store, project: "/projects/a", permissions: [], questions: [] })

    const byKey = new Map(store.list().map(entry => [entry.key, entry]))
    expect(byKey.get(staleA)?.resolved).toBe(true)
    expect(byKey.get(pendingB)?.resolved).toBe(false)
    expect(store.counts().attention).toBe(1)
  })
})
