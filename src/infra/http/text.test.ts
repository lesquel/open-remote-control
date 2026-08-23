import { describe, expect, test } from "bun:test"
import { readBoundedBytes, readBoundedText } from "./text"

function streamedRequest(chunks: Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Request("https://example.com", { method: "POST", body })
}

describe("bounded request readers", () => {
  test("reads a chunked body at the exact byte limit", async () => {
    const result = await readBoundedBytes(streamedRequest([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ]), 4)
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  test("rejects as soon as chunked bytes exceed the limit", async () => {
    const result = await readBoundedBytes(streamedRequest([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4, 5]),
    ]), 4)
    expect(result).toBeNull()
  })

  test("decodes bounded UTF-8 across chunk boundaries", async () => {
    const encoded = new TextEncoder().encode("hello 🌎")
    const result = await readBoundedText(streamedRequest([
      encoded.slice(0, 7),
      encoded.slice(7),
    ]), encoded.byteLength)
    expect(result).toBe("hello 🌎")
  })
})
