import { describe, expect, test } from "bun:test"
import {
  applyBrowserResponseHeaders,
  validateBrowserBoundary,
  type BrowserBoundaryOptions,
} from "./browser-security"

const options: BrowserBoundaryOptions = {
  host: "127.0.0.1",
  port: 4096,
  tunnelUrl: "https://pilot.example.test",
  allowedOrigins: ["https://lesquel.github.io"],
}

function request(host: string, origin?: string): Request {
  const headers = new Headers({ host })
  if (origin !== undefined) headers.set("origin", origin)
  return new Request("http://127.0.0.1:4096/status", { headers })
}

describe("validateBrowserBoundary", () => {
  test("allows loopback, configured-port requests from non-browser clients", () => {
    expect(validateBrowserBoundary(request("127.0.0.1:4096"), options)).toEqual({
      ok: true,
      origin: null,
    })
  })

  test("allows the active tunnel authority", () => {
    expect(
      validateBrowserBoundary(request("pilot.example.test", "https://pilot.example.test"), options),
    ).toEqual({ ok: true, origin: "https://pilot.example.test" })
  })

  test("allows an explicitly configured reverse-proxy hostname", () => {
    const reverseProxyOptions = { ...options, allowedHosts: ["pilot.home.example"] }
    expect(
      validateBrowserBoundary(request("pilot.home.example", "https://pilot.home.example"), reverseProxyOptions),
    ).toEqual({ ok: true, origin: "https://pilot.home.example" })
  })

  test("allows the explicitly configured standalone PWA origin", () => {
    expect(
      validateBrowserBoundary(request("pilot.example.test", "https://lesquel.github.io"), options),
    ).toEqual({ ok: true, origin: "https://lesquel.github.io" })
  })

  test("rejects a DNS-rebinding Host header", () => {
    expect(validateBrowserBoundary(request("attacker.example"), options)).toEqual({
      ok: false,
      code: "INVALID_HOST",
    })
  })

  test("rejects mismatched, null, and non-HTTP browser origins", () => {
    for (const origin of ["https://attacker.example", "null", "chrome-extension://abc"]) {
      expect(validateBrowserBoundary(request("127.0.0.1:4096", origin), options)).toEqual({
        ok: false,
        code: "INVALID_ORIGIN",
      })
    }
  })

  test("rejects malformed and wrong-port Host headers", () => {
    for (const host of ["", "127.0.0.1:9999", "user@127.0.0.1:4096", "127.0.0.1/x"]) {
      expect(validateBrowserBoundary(request(host), options)).toEqual({
        ok: false,
        code: "INVALID_HOST",
      })
    }
  })
})

describe("applyBrowserResponseHeaders", () => {
  test("adds browser hardening headers without wildcard CORS", async () => {
    const response = applyBrowserResponseHeaders(
      new Response("ok", { headers: { "Content-Type": "text/plain" } }),
      null,
    )

    expect(await response.text()).toBe("ok")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("reflects only an already-validated same authority origin", () => {
    const response = applyBrowserResponseHeaders(
      new Response(null),
      "https://pilot.example.test",
    )
    expect(response.headers.get("access-control-allow-origin")).toBe("https://pilot.example.test")
    expect(response.headers.get("vary")).toContain("Origin")
  })
})
