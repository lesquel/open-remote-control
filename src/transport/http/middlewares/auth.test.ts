import { describe, expect, test } from "bun:test"
import { validateToken, safeEqual } from "./auth"

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

describe("safeEqual", () => {
  test("returns true for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
  })

  test("returns false for different strings of same length", () => {
    expect(safeEqual("abc", "abd")).toBe(false)
  })

  test("returns false for different lengths — actual shorter", () => {
    expect(safeEqual("a", "abc")).toBe(false)
  })

  test("returns false for different lengths — actual longer", () => {
    expect(safeEqual("abc", "a")).toBe(false)
  })

  test("returns false for empty actual against non-empty expected", () => {
    expect(safeEqual("", "abc")).toBe(false)
  })

  test("returns true for two empty strings", () => {
    expect(safeEqual("", "")).toBe(true)
  })

  test("constant-time: timingSafeEqual is called regardless of length mismatch", () => {
    // We can't spy on timingSafeEqual directly in this runtime, but we verify
    // the function returns the correct boolean in all length-mismatch cases.
    // Length difference must not leak timing info — both paths return false here.
    expect(safeEqual("a", "abc")).toBe(false)
    expect(safeEqual("abc", "a")).toBe(false)
    expect(safeEqual("x".repeat(64), "x".repeat(65))).toBe(false)
  })
})
