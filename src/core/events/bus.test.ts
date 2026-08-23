import { describe, expect, test } from "bun:test"
import { createEventBus } from "./bus"

const event = {
  type: "test.event",
  properties: { value: 1 },
}

describe("createEventBus SSE lifecycle", () => {
  test("removes a browser client when its reader is cancelled", async () => {
    const bus = createEventBus()
    const reader = bus.createSSEResponse().body?.getReader()
    expect(bus.clientCount()).toBe(1)
    await reader?.cancel()
    expect(bus.clientCount()).toBe(0)
  })

  test("disconnects a slow client instead of growing its queue without bound", () => {
    const bus = createEventBus()
    bus.createSSEResponse()
    expect(bus.clientCount()).toBe(1)
    for (let index = 0; index < 64; index += 1) bus.emit(event)
    expect(bus.clientCount()).toBe(0)
  })

  test("closeAll deterministically removes every client", () => {
    const bus = createEventBus()
    bus.createSSEResponse()
    bus.createSSEResponse()
    expect(bus.clientCount()).toBe(2)
    bus.closeAll()
    expect(bus.clientCount()).toBe(0)
  })
})
