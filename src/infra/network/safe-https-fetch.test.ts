import { describe, expect, test } from "bun:test"
import { buildPinnedRequestOptions, createSafeHttpsFetcher } from "./safe-https-fetch"

const bytes = new Uint8Array([1, 2, 3])

describe("createSafeHttpsFetcher", () => {
  test("resolves a public hostname and pins that address for the request", async () => {
    const calls: Array<{ host: string; address: string }> = []
    const fetchSafe = createSafeHttpsFetcher({
      resolver: async (host) => [{ address: host === "example.com" ? "93.184.216.34" : "1.1.1.1" }],
      requestHop: async ({ url, address }) => {
        calls.push({ host: url.hostname, address })
        return { ok: true, status: 200, body: bytes }
      },
    })

    expect(await fetchSafe("https://example.com/image.png", { timeoutMs: 1000, maxBytes: 20 })).toEqual({ ok: true, status: 200, body: bytes })
    expect(calls).toEqual([{ host: "example.com", address: "93.184.216.34" }])
  })

  test("rejects private and mixed DNS answers before opening a request", async () => {
    let requests = 0
    const requestHop = async () => {
      requests += 1
      return { ok: true as const, status: 200, body: bytes }
    }
    for (const answers of [
      [{ address: "127.0.0.1" }],
      [{ address: "93.184.216.34" }, { address: "10.0.0.1" }],
    ]) {
      const fetchSafe = createSafeHttpsFetcher({ resolver: async () => answers, requestHop })
      expect(await fetchSafe("https://example.com/file", { timeoutMs: 1000, maxBytes: 20 })).toMatchObject({ ok: false, reason: "forbidden" })
    }
    expect(requests).toBe(0)
  })

  test("revalidates every redirect and blocks a public-to-private hop", async () => {
    const requested: string[] = []
    const fetchSafe = createSafeHttpsFetcher({
      resolver: async (host) => [{ address: host === "private.example" ? "192.168.1.2" : "93.184.216.34" }],
      requestHop: async ({ url }) => {
        requested.push(url.href)
        return { ok: true, status: 302, location: "https://private.example/secret", body: new Uint8Array() }
      },
    })
    const result = await fetchSafe("https://public.example/file", { timeoutMs: 1000, maxBytes: 20 })
    expect(result).toMatchObject({ ok: false, reason: "forbidden" })
    expect(requested).toEqual(["https://public.example/file"])
  })

  test("follows relative redirects and enforces a redirect limit", async () => {
    const fetchSafe = createSafeHttpsFetcher({
      resolver: async () => [{ address: "93.184.216.34" }],
      requestHop: async ({ url }) => ({ ok: true, status: 302, location: `${url.pathname}/next`, body: new Uint8Array() }),
    })
    expect(await fetchSafe("https://example.com/file", { timeoutMs: 1000, maxBytes: 20, maxRedirects: 1 })).toMatchObject({ ok: false, reason: "redirect" })
  })

  test("uses one total deadline across DNS and redirects", async () => {
    let clock = 10
    const fetchSafe = createSafeHttpsFetcher({
      now: () => clock,
      resolver: async () => {
        clock = 20
        return [{ address: "93.184.216.34" }]
      },
      requestHop: async () => ({ ok: true, status: 200, body: bytes }),
    })
    expect(await fetchSafe("https://example.com/file", { timeoutMs: 5, maxBytes: 20 })).toMatchObject({ ok: false, reason: "timeout" })
  })

  test("returns on deadline when DNS resolution hangs", async () => {
    const fetchSafe = createSafeHttpsFetcher({ resolver: () => new Promise(() => undefined) })
    const result = await fetchSafe("https://example.com/file", { timeoutMs: 5, maxBytes: 20 })
    expect(result).toMatchObject({ ok: false, reason: "timeout" })
  })
})

describe("buildPinnedRequestOptions", () => {
  test("connects to the validated IP while retaining Host and TLS SNI", () => {
    expect(buildPinnedRequestOptions(new URL("https://cdn.example.com:8443/file?q=1"), "93.184.216.34")).toMatchObject({
      hostname: "93.184.216.34",
      port: "8443",
      path: "/file?q=1",
      servername: "cdn.example.com",
      rejectUnauthorized: true,
      headers: { Host: "cdn.example.com:8443", "Accept-Encoding": "identity" },
    })
  })
})
