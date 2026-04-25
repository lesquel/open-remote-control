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
})
