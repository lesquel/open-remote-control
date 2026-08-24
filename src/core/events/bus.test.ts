import { describe, expect, test } from "bun:test"
import { createEventBus } from "./bus"

const event = {
  type: "test.event",
  properties: { value: 1 },
}

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read()
  return result.value ? new TextDecoder().decode(result.value) : ""
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

  test("closes only the streams bound to a revoked device", async () => {
    const bus = createEventBus()
    const revokedReader = bus.createSSEResponse({}, null, "device:revoked").body!.getReader()
    const unaffectedReader = bus.createSSEResponse({}, null, "device:unaffected").body!.getReader()

    // Consume the initial welcome, proxy-flush padding, and ready marker so a
    // later read proves a post-revocation event was not retained in the stream.
    await readText(revokedReader)
    await readText(revokedReader)
    await readText(revokedReader)
    await readText(unaffectedReader)
    await readText(unaffectedReader)
    await readText(unaffectedReader)
    expect(bus.clientCount()).toBe(2)

    bus.closeClientTag("device:revoked")
    expect(bus.clientCount()).toBe(1)
    bus.emit({ type: "sensitive.event", properties: { secret: "must-not-arrive" } })

    const revokedResult = await revokedReader.read()
    expect(revokedResult.done).toBe(true)
    expect(await readText(unaffectedReader)).toContain('"type":"sensitive.event"')
    await unaffectedReader.cancel()
  })

  test("assigns stable event IDs and replays only missed events", async () => {
    const bus = createEventBus()
    const firstReader = bus.createSSEResponse().body!.getReader()
    await readText(firstReader)
    await readText(firstReader)
    await readText(firstReader)

    bus.emit({ type: "event.one", properties: { value: 1 } })
    const first = await readText(firstReader)
    const firstId = first.match(/^id: (.+)$/m)?.[1]
    expect(firstId).toBeTruthy()

    bus.emit({ type: "event.two", properties: { value: 2 } })
    await readText(firstReader)
    bus.emit({ type: "event.three", properties: { value: 3 } })
    await readText(firstReader)
    await firstReader.cancel()

    const replayReader = bus.createSSEResponse({}, firstId).body!.getReader()
    const second = await readText(replayReader)
    const third = await readText(replayReader)
    const welcome = await readText(replayReader)

    expect(second).toContain('"type":"event.two"')
    expect(third).toContain('"type":"event.three"')
    expect(welcome).toContain('"status":"replayed"')
    expect(welcome).toContain('"count":2')
    await replayReader.cancel()
  })

  test("reports a host generation change instead of replaying foreign IDs", async () => {
    const bus = createEventBus()
    const reader = bus.createSSEResponse({}, "old-host:42").body!.getReader()
    const welcome = await readText(reader)

    expect(welcome).toContain('"type":"pilot.connected"')
    expect(welcome).toContain('"status":"generation_changed"')
    await reader.cancel()
  })

  test("falls back to snapshots when the requested event is outside the replay window", async () => {
    const bus = createEventBus()
    const firstReader = bus.createSSEResponse().body!.getReader()
    await readText(firstReader)
    await readText(firstReader)
    await readText(firstReader)
    bus.emit({ type: "event.start", properties: {} })
    const first = await readText(firstReader)
    const firstId = first.match(/^id: (.+)$/m)?.[1]
    await firstReader.cancel()

    for (let index = 0; index < 25; index += 1) {
      bus.emit({ type: "event.bulk", properties: { index } })
    }

    const replayReader = bus.createSSEResponse({}, firstId).body!.getReader()
    const welcome = await readText(replayReader)
    expect(welcome).toContain('"status":"unavailable"')
    await replayReader.cancel()
  })
})
