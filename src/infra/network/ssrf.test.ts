// ssrf.test.ts — SSRF guard for outbound URL validation (V2)
import { describe, expect, test } from "bun:test"
import { validateEndpoint } from "./ssrf"

describe("validateEndpoint (V2 SSRF guard)", () => {
  test("accepts a valid public https URL", () => {
    expect(validateEndpoint("https://example.com/image.png")).toEqual({ ok: true })
  })

  test("accepts a public https URL with port", () => {
    expect(validateEndpoint("https://cdn.example.com:443/file")).toEqual({ ok: true })
  })

  test("rejects localhost", () => {
    const result = validateEndpoint("https://localhost/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects 127.0.0.1", () => {
    const result = validateEndpoint("https://127.0.0.1/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects 0.0.0.0", () => {
    const result = validateEndpoint("https://0.0.0.0/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects ::1 (IPv6 loopback)", () => {
    const result = validateEndpoint("https://[::1]/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects RFC 1918 10.x.x.x", () => {
    const result = validateEndpoint("https://10.0.0.1/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects RFC 1918 192.168.x.x", () => {
    const result = validateEndpoint("https://192.168.1.1/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects RFC 1918 172.16.x.x", () => {
    const result = validateEndpoint("https://172.16.0.1/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects RFC 1918 172.31.x.x", () => {
    const result = validateEndpoint("https://172.31.255.255/secret")
    expect(result.ok).toBe(false)
  })

  test("allows 172.15.x.x (just outside RFC 1918 range)", () => {
    const result = validateEndpoint("https://172.15.0.1/image.png")
    expect(result.ok).toBe(true)
  })

  test("rejects link-local 169.254.x.x", () => {
    const result = validateEndpoint("https://169.254.1.1/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects IPv6 unique-local fc00::", () => {
    const result = validateEndpoint("https://[fc00::1]/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects IPv6 unique-local fd00::", () => {
    const result = validateEndpoint("https://[fd00::1]/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects IPv6 link-local fe80::", () => {
    const result = validateEndpoint("https://[fe80::1]/secret")
    expect(result.ok).toBe(false)
  })

  test("rejects non-https URL (http://)", () => {
    // Guard for attachment proxy: block non-public hosts; http: is rejected by push service
    // For attachments the guard must also handle http:// input
    const result = validateEndpoint("http://localhost/file")
    expect(result.ok).toBe(false)
  })

  test("rejects invalid URL (not parseable)", () => {
    const result = validateEndpoint("not-a-url")
    expect(result.ok).toBe(false)
  })
})
