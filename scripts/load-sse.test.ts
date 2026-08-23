import { describe, expect, test } from "bun:test"
import { parseSseLoadOptions, runSseLoad } from "./load-sse"

describe("SSE load harness", () => {
  test("parses bounded options without accepting a token argument", () => {
    expect(parseSseLoadOptions(
      ["--url", "http://localhost:5000/", "--clients", "10", "--duration-ms", "250"],
      { PILOT_TOKEN: "secret" },
    )).toEqual({
      url: "http://localhost:5000",
      token: "secret",
      clients: 10,
      durationMs: 250,
      connectTimeoutMs: 5_000,
    })
    expect(() => parseSseLoadOptions(["--token", "leak"], { PILOT_TOKEN: "secret" })).toThrow(
      "Unknown option",
    )
  })

  test("requires credentials from the environment", () => {
    expect(() => parseSseLoadOptions([], {})).toThrow("PILOT_TOKEN is required")
  })

  test("measures successful welcome frames and health count", async () => {
    let now = 100
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/health")) return Response.json({ sse_clients: 2 })
      now += 5
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"pilot.connected"}\n\n'))
        },
      }), { status: 200 })
    }) as typeof fetch

    const result = await runSseLoad({
      url: "http://localhost:4097",
      token: "secret",
      clients: 2,
      durationMs: 100,
      connectTimeoutMs: 500,
    }, {
      fetch: fakeFetch,
      sleep: async () => {},
      now: () => now,
    })

    expect(result.connectedClients).toBe(2)
    expect(result.failedClients).toBe(0)
    expect(result.serverReportedClients).toBe(2)
    expect(result.connectLatencyMs.max).toBeGreaterThanOrEqual(5)
  })
})
