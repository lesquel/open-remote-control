import { describe, it, expect, beforeEach } from "bun:test"
import { createCircuitBreaker } from "./index"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFailingFn(message = "boom"): () => Promise<string> {
  return () => Promise.reject(new Error(message))
}

function makeSucceedingFn(value = "ok"): () => Promise<string> {
  return () => Promise.resolve(value)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createCircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = createCircuitBreaker({ maxFailures: 3, resetMs: 1000 })
    expect(cb.state()).toBe("closed")
  })

  it("stays closed while failures < maxFailures", async () => {
    const cb = createCircuitBreaker({ maxFailures: 3, resetMs: 1000 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    expect(cb.state()).toBe("closed")
  })

  it("opens after maxFailures consecutive failures", async () => {
    const cb = createCircuitBreaker({ maxFailures: 3, resetMs: 1000 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    expect(cb.state()).toBe("open")
  })

  it("rejects immediately when open without calling fn", async () => {
    const cb = createCircuitBreaker({ maxFailures: 2, resetMs: 1000 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    expect(cb.state()).toBe("open")

    let called = false
    const fn = () => {
      called = true
      return Promise.resolve("x")
    }
    await cb.run(fn).catch(() => {})
    expect(called).toBe(false)
  })

  it("transitions open → half-open after resetMs", async () => {
    const cb = createCircuitBreaker({ maxFailures: 2, resetMs: 50 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    expect(cb.state()).toBe("open")

    await new Promise((r) => setTimeout(r, 60))
    expect(cb.state()).toBe("half-open")
  })

  it("half-open: success → closed", async () => {
    const cb = createCircuitBreaker({ maxFailures: 2, resetMs: 50 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})

    await new Promise((r) => setTimeout(r, 60))
    expect(cb.state()).toBe("half-open")

    const result = await cb.run(makeSucceedingFn("great"))
    expect(result).toBe("great")
    expect(cb.state()).toBe("closed")
  })

  it("half-open: failure → open again", async () => {
    const cb = createCircuitBreaker({ maxFailures: 2, resetMs: 50 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})

    await new Promise((r) => setTimeout(r, 60))
    expect(cb.state()).toBe("half-open")

    await cb.run(makeFailingFn()).catch(() => {})
    expect(cb.state()).toBe("open")
  })

  it("resets failure count on success", async () => {
    const cb = createCircuitBreaker({ maxFailures: 3, resetMs: 1000 })
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    await cb.run(makeSucceedingFn()).catch(() => {})
    await cb.run(makeFailingFn()).catch(() => {})
    // 2 failures before success, then 1 after — total < 3
    expect(cb.state()).toBe("closed")
  })

  it("propagates error value from underlying fn when closed", async () => {
    const cb = createCircuitBreaker({ maxFailures: 5, resetMs: 1000 })
    const err = await cb.run(makeFailingFn("specific error")).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe("specific error")
  })

  it("throws CircuitOpenError with correct message when open", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1, resetMs: 1000 })
    await cb.run(makeFailingFn()).catch(() => {})
    const err = await cb.run(makeSucceedingFn()).catch((e) => e)
    expect((err as Error).message).toContain("circuit open")
  })
})
