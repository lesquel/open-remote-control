import { describe, expect, test } from "bun:test"
import { validateToken } from "./auth"

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers["Authorization"] = authHeader
  return new Request("http://localhost/status", { headers })
}

describe("validateToken", () => {
  test("returns true with correct Bearer token", () => {
    const token = "abc123secret"
    expect(validateToken(makeRequest(`Bearer ${token}`), token)).toBe(true)
  })

  test("returns false when Authorization header is missing", () => {
    expect(validateToken(makeRequest(), "abc123")).toBe(false)
  })

  test("returns false with wrong token", () => {
    expect(validateToken(makeRequest("Bearer wrong"), "abc123")).toBe(false)
  })

  test("returns false with wrong scheme (Basic)", () => {
    expect(validateToken(makeRequest("Basic abc123"), "abc123")).toBe(false)
  })

  test("returns false with empty authorization header", () => {
    expect(validateToken(makeRequest(""), "abc123")).toBe(false)
  })

  test("returns false with a completely different token", () => {
    expect(validateToken(makeRequest("Bearer notthetoken"), "abc123")).toBe(false)
  })
})
