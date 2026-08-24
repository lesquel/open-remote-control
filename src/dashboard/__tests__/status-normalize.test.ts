import { describe, expect, test } from "bun:test"
import { normalizeSessionStatus, normalizeStatusMap } from "../state/status-normalize"

describe("OpenCode session status normalization", () => {
  test("keeps legacy string statuses", () => {
    expect(normalizeSessionStatus("busy")).toBe("busy")
    expect(normalizeSessionStatus("idle")).toBe("idle")
  })

  test("extracts the v2 discriminated-union type instead of rendering [object Object]", () => {
    expect(normalizeSessionStatus({ type: "busy" })).toBe("busy")
    expect(normalizeSessionStatus({ type: "retry", attempt: 2 })).toBe("retry")
  })

  test("falls back safely for malformed values", () => {
    expect(normalizeSessionStatus(null)).toBe("idle")
    expect(normalizeSessionStatus({})).toBe("idle")
  })

  test("normalizes every session returned by /session/status", () => {
    expect(normalizeStatusMap({
      one: { type: "busy" },
      two: "idle",
    })).toEqual({ one: "busy", two: "idle" })
  })
})
