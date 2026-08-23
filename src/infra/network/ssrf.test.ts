// ssrf.test.ts — SSRF guard for outbound URL validation (V2)
import { describe, expect, test } from "bun:test"
import { isPublicIpAddress, validateEndpoint } from "./ssrf"

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

  test.each([
    "127.0.0.2",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "ff02::1",
  ])("rejects non-public address %s", (address) => {
    const host = address.includes(":") ? `[${address}]` : address
    expect(validateEndpoint(`https://${host}/secret`).ok).toBe(false)
    expect(isPublicIpAddress(address)).toBe(false)
  })

  test.each(["2130706433", "0x7f000001", "017700000001"])(
    "rejects alternate loopback encoding %s",
    (address) => expect(validateEndpoint(`https://${address}/secret`).ok).toBe(false),
  )

  test("rejects localhost subdomains and trailing dots", () => {
    expect(validateEndpoint("https://api.localhost./secret").ok).toBe(false)
  })

  test("rejects URL credentials", () => {
    expect(validateEndpoint("https://user:password@example.com/file").ok).toBe(false)
  })

  test.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])(
    "accepts public address %s",
    (address) => expect(isPublicIpAddress(address)).toBe(true),
  )
})
