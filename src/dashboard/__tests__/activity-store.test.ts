import { describe, expect, test } from "bun:test"
import { createActivityStore } from "../components/activity-store.js"

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
}

describe("local activity store", () => {
  test("deduplicates stable events and resolves attention exactly once", () => {
    const store = createActivityStore({ storage: memoryStorage(), now: () => 10 })
    store.add({ key: "permission:p1", kind: "permission", title: "Allow", attention: true })
    store.add({ key: "permission:p1", kind: "permission", title: "duplicate", attention: true })
    expect(store.list()).toHaveLength(1)
    expect(store.counts()).toEqual({ unread: 1, attention: 1 })
    expect(store.resolve("permission:p1")).toBe(true)
    expect(store.resolve("permission:p1")).toBe(false)
    expect(store.counts().attention).toBe(0)
  })

  test("bounds history and truncates stored text", () => {
    let now = 0
    const store = createActivityStore({ storage: memoryStorage(), now: () => now++ })
    for (let index = 0; index < 120; index++) store.add({ key: `e:${index}`, title: "x".repeat(500) })
    expect(store.list()).toHaveLength(100)
    expect(store.list()[0].title).toHaveLength(200)
  })

  test("recovers from corrupt persisted JSON", () => {
    const storage = { getItem: () => "{bad", setItem: () => {} }
    expect(createActivityStore({ storage }).list()).toEqual([])
  })

  test("clears recent history without dropping unresolved attention", () => {
    const store = createActivityStore({ storage: memoryStorage(), now: () => 10 })
    store.add({ key: "permission:p1", kind: "permission", title: "Allow", attention: true })
    store.add({ key: "completed:s1", kind: "completed", title: "Finished" })
    store.clearRecent()
    expect(store.list().map(entry => entry.key)).toEqual(["permission:p1"])
  })
})
