import { describe, expect, test } from "bun:test"
import { generateToken } from "./token"

describe("generateToken", () => {
  test("returns a 64-character hex string", () => {
    const token = generateToken()
    expect(token).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(token)).toBe(true)
  })

  test("returns a different value on each call", () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })
})
