import { describe, expect, test } from "bun:test"
import { jitteredReconnectDelay } from "./backoff"

describe("jitteredReconnectDelay", () => {
  test("applies a bounded spread around the exponential base", () => {
    expect(jitteredReconnectDelay(1_000, () => 0)).toBe(800)
    expect(jitteredReconnectDelay(1_000, () => 0.5)).toBe(1_000)
    expect(jitteredReconnectDelay(1_000, () => 1)).toBe(1_200)
  })

  test("clamps hostile random sources", () => {
    expect(jitteredReconnectDelay(1_000, () => -4)).toBe(800)
    expect(jitteredReconnectDelay(1_000, () => 8)).toBe(1_200)
    expect(jitteredReconnectDelay(1_000, () => Number.NaN)).toBe(1_000)
  })
})
