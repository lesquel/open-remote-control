import { describe, expect, test } from "bun:test"
import { createPermissionResponder } from "../components/permission-response.js"

type Permission = { id?: string; permissionID?: string }

function deferred() {
  let resolve!: () => void
  let reject!: () => void
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function harness(initial: Permission[]) {
  let pending = initial
  const sends: Array<{ id: string; action: string }> = []
  const busy: boolean[] = []
  let refreshes = 0
  let renders = 0
  let errors = 0
  const response = deferred()
  const respond = createPermissionResponder({
    getPending: () => pending,
    setPending: (next: Permission[]) => { pending = next },
    send: (id: string, action: string) => {
      sends.push({ id, action })
      return response.promise
    },
    refresh: async () => { refreshes += 1 },
    render: () => { renders += 1 },
    setBusy: (value: boolean) => { busy.push(value) },
    onError: () => { errors += 1 },
  })
  return {
    respond,
    response,
    sends,
    busy,
    getPending: () => pending,
    setPending: (next: Permission[]) => { pending = next },
    stats: () => ({ refreshes, renders, errors }),
  }
}

describe("createPermissionResponder", () => {
  test("blocks double taps and keeps the visible item until the response succeeds", async () => {
    const h = harness([{ id: "first" }, { id: "second" }])
    const first = h.respond("allow")
    const duplicate = await h.respond("deny")

    expect(duplicate).toBe(false)
    expect(h.sends).toEqual([{ id: "first", action: "allow" }])
    expect(h.getPending()).toEqual([{ id: "first" }, { id: "second" }])
    expect(h.busy).toEqual([true])

    h.response.resolve()
    expect(await first).toBe(true)
    expect(h.getPending()).toEqual([{ id: "second" }])
    expect(h.busy).toEqual([true, false])
  })

  test("removes only the captured permission when SSE changes the queue mid-flight", async () => {
    const h = harness([{ id: "first" }, { id: "second" }])
    const request = h.respond("allow")
    h.setPending([{ id: "second" }, { id: "third" }])
    h.response.resolve()
    await request
    expect(h.getPending()).toEqual([{ id: "second" }, { id: "third" }])
  })

  test("retains and refreshes the queue after an ambiguous request failure", async () => {
    const h = harness([{ id: "first" }, { id: "second" }])
    const request = h.respond("deny")
    h.response.reject()
    expect(await request).toBe(false)
    expect(h.getPending()).toEqual([{ id: "first" }, { id: "second" }])
    expect(h.stats()).toEqual({ refreshes: 1, renders: 1, errors: 1 })
    expect(h.busy).toEqual([true, false])
  })

  test("refreshes instead of sending when the current item has no stable id", async () => {
    const h = harness([{}])
    expect(await h.respond("allow")).toBe(false)
    expect(h.sends).toEqual([])
    expect(h.stats().refreshes).toBe(1)
  })
})
