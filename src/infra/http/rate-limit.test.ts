import { describe, expect, test } from "bun:test"
import { createRateLimiter } from "./rate-limit"

const policy = { limit: 2, windowMs: 1_000 }

describe("createRateLimiter", () => {
  test("blocks after the configured count and resets with the window", () => {
    const limiter = createRateLimiter()
    expect(limiter.consume("key", policy, 0).allowed).toBe(true)
    expect(limiter.consume("key", policy, 1).allowed).toBe(true)
    expect(limiter.consume("key", policy, 2)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    })
    expect(limiter.consume("key", policy, 1_001).allowed).toBe(true)
  })

  test("isolates keys and bounds attacker-controlled cardinality", () => {
    const limiter = createRateLimiter(3)
    limiter.consume("one", policy, 0)
    limiter.consume("two", policy, 0)
    limiter.consume("three", policy, 0)
    limiter.consume("four", policy, 0)

    expect(limiter.size()).toBeLessThanOrEqual(3)
    expect(limiter.consume("two", policy, 1).allowed).toBe(true)
  })
})
