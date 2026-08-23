import { describe, expect, test } from "bun:test"
import { createPermissionQueue } from "./queue"

describe("createPermissionQueue", () => {
  test("waitForResponse resolves when resolve() is called", async () => {
    const queue = createPermissionQueue(5_000)
    const promise = queue.waitForResponse("perm-1")
    queue.resolve("perm-1", "allow")
    const result = await promise
    expect(result).toEqual({ action: "allow" })
  })

  test("waitForResponse resolves with deny action", async () => {
    const queue = createPermissionQueue(5_000)
    const promise = queue.waitForResponse("perm-2")
    queue.resolve("perm-2", "deny")
    const result = await promise
    expect(result).toEqual({ action: "deny" })
  })

  test("waitForResponse resolves with null after timeout", async () => {
    const queue = createPermissionQueue(50) // 50ms timeout
    const result = await queue.waitForResponse("perm-timeout")
    expect(result).toBeNull()
  })

  test("pending() lists current waiters", () => {
    const queue = createPermissionQueue(5_000)
    expect(queue.pending()).toHaveLength(0)

    // Start two waiters but don't await — we just want to check pending
    queue.waitForResponse("perm-a")
    queue.waitForResponse("perm-b")

    const pending = queue.pending()
    expect(pending).toHaveLength(2)
    const ids = pending.map((p) => p.permissionID).sort()
    expect(ids).toEqual(["perm-a", "perm-b"])
  })

  test("pending() removes resolved entries", () => {
    const queue = createPermissionQueue(5_000)
    queue.waitForResponse("perm-c")
    queue.resolve("perm-c", "allow")
    expect(queue.pending()).toHaveLength(0)
  })

  test("pending() entries have resolved=false", () => {
    const queue = createPermissionQueue(5_000)
    queue.waitForResponse("perm-d")
    const [entry] = queue.pending()
    expect(entry.resolved).toBe(false)
    expect(typeof entry.createdAt).toBe("number")
  })

  test("duplicate IDs share one waiter instead of orphaning the first promise", async () => {
    const queue = createPermissionQueue(5_000)
    const first = queue.waitForResponse("duplicate", { title: "original" })
    const duplicate = queue.waitForResponse("duplicate", { title: "replacement" })
    expect(duplicate).toBe(first)
    expect(queue.pending()).toHaveLength(1)
    expect(queue.pending()[0]?.title).toBe("original")
    expect(queue.resolve("duplicate", "allow")).toBe(true)
    expect(await Promise.all([first, duplicate])).toEqual([{ action: "allow" }, { action: "allow" }])
  })

  test("resolve is exactly-once and stale resolutions cannot change the outcome", async () => {
    const queue = createPermissionQueue(5_000)
    const response = queue.waitForResponse("once")
    expect(queue.pending().map((item) => item.permissionID)).toContain("once")
    expect(queue.resolve("once", "deny")).toBe(true)
    expect(queue.resolve("once", "allow")).toBe(false)
    expect(queue.pending()).toEqual([])
    expect(await response).toEqual({ action: "deny" })
  })

  test("duplicate waiters expire together without leaving a queue entry", async () => {
    const queue = createPermissionQueue(5)
    const first = queue.waitForResponse("duplicate-timeout")
    const duplicate = queue.waitForResponse("duplicate-timeout")
    expect(await Promise.all([first, duplicate])).toEqual([null, null])
    expect(queue.pending()).toEqual([])
  })
})
