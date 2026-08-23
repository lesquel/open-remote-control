import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync } from "node:fs"
import { createSubscriptionStore } from "./subscriptions"

const SUB_A = {
  endpoint: "https://push.example.com/endpoint/a",
  keys: { p256dh: "p256dh-a", auth: "auth-a" },
}

const SUB_B = {
  endpoint: "https://push.example.com/endpoint/b",
  keys: { p256dh: "p256dh-b", auth: "auth-b" },
}

function tempStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), "pilot-push-store-")), "subscriptions.json")
}

describe("subscription store persistence", () => {
  test("survives service recreation with a versioned private file", () => {
    const filePath = tempStorePath()
    const first = createSubscriptionStore({ filePath })
    first.add(SUB_A)
    first.add(SUB_B)

    const stored = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>
    expect(stored.version).toBe(1)
    expect(Array.isArray(stored.subscriptions)).toBe(true)
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(filePath)).mode & 0o777).toBe(0o700)
    }

    const reloaded = createSubscriptionStore({ filePath })
    expect(reloaded.all()).toEqual([SUB_A, SUB_B])
  })

  test("persists replacement and removal atomically", () => {
    const filePath = tempStorePath()
    const store = createSubscriptionStore({ filePath })
    const replacement = { ...SUB_A, keys: { p256dh: "new", auth: "new-auth" } }

    store.add(SUB_A)
    store.add(replacement)
    expect(store.count()).toBe(1)
    expect(store.get(SUB_A.endpoint)).toEqual(replacement)

    expect(store.remove(SUB_A.endpoint)).toBe(true)
    expect(createSubscriptionStore({ filePath }).count()).toBe(0)
    expect(readdirSync(dirname(filePath)).some((name) => name.endsWith(".tmp"))).toBe(false)
  })

  test("recovers from corrupt or unsupported state without throwing", () => {
    const filePath = tempStorePath()
    writeFileSync(filePath, "{not-json", { mode: 0o666 })
    const errors: string[] = []
    const corrupt = createSubscriptionStore({
      filePath,
      onLoadError: (error) => errors.push(error.message),
    })
    expect(corrupt.count()).toBe(0)
    expect(errors).toHaveLength(1)

    writeFileSync(filePath, JSON.stringify({ version: 99, subscriptions: [SUB_A] }))
    const unsupported = createSubscriptionStore({ filePath })
    expect(unsupported.count()).toBe(0)
    expect(() => unsupported.add(SUB_A)).toThrow(/newer push subscription state version/)
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      version: 99,
      subscriptions: [SUB_A],
    })
  })

  test("filters malformed persisted entries", () => {
    const filePath = tempStorePath()
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      subscriptions: [SUB_A, null, { endpoint: "bad" }, SUB_B],
    }))

    const store = createSubscriptionStore({ filePath })
    expect(store.all()).toEqual([SUB_A, SUB_B])
  })

  test("does not change memory when persistence fails", () => {
    const filePath = tempStorePath()
    const store = createSubscriptionStore({ filePath })
    store.add(SUB_A)
    // Force a deterministic rename failure by making the destination a directory.
    const blockedPath = join(dirname(filePath), "blocked")
    const blocked = createSubscriptionStore({ filePath: blockedPath })
    mkdirSync(blockedPath)
    expect(() => blocked.add(SUB_B)).toThrow()
    expect(blocked.count()).toBe(0)
  })
})
