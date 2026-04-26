// ─── Circuit Breaker ─────────────────────────────────────────────────────────
// Simple closed → open → half-open state machine.
// Wrap flaky external calls (Telegram, tunnel) to stop hammering on failure.

export type CircuitState = "closed" | "open" | "half-open"

export interface CircuitBreaker {
  /** Execute fn through the breaker. Throws CircuitOpenError when open. */
  run<T>(fn: () => Promise<T>): Promise<T>
  /** Current state. Computed lazily (open → half-open after resetMs). */
  state(): CircuitState
  /** Reset to closed manually (e.g. on service restart). */
  reset(): void
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. */
  maxFailures: number
  /** Milliseconds to wait before moving open → half-open. */
  resetMs: number
}

export class CircuitOpenError extends Error {
  constructor() {
    super("circuit open — request blocked")
    this.name = "CircuitOpenError"
  }
}

export function createCircuitBreaker(opts: CircuitBreakerOptions): CircuitBreaker {
  const { maxFailures, resetMs } = opts

  let failures = 0
  let openedAt: number | null = null
  // Internal raw state — state() resolves half-open lazily from openedAt
  let rawState: "closed" | "open" = "closed"

  function state(): CircuitState {
    if (rawState === "closed") return "closed"
    // open → half-open once resetMs has elapsed
    if (openedAt !== null && Date.now() - openedAt >= resetMs) return "half-open"
    return "open"
  }

  function trip(): void {
    rawState = "open"
    openedAt = Date.now()
    failures = 0 // reset counter; next open period is fresh
  }

  function close(): void {
    rawState = "closed"
    failures = 0
    openedAt = null
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    const current = state()

    if (current === "open") {
      throw new CircuitOpenError()
    }

    // half-open: allow one probe call
    try {
      const result = await fn()
      // success — close (or stay closed)
      close()
      return result
    } catch (err) {
      if (current === "half-open") {
        // probe failed — go back to open, reset the timer
        trip()
      } else {
        // closed — increment failure count
        failures++
        if (failures >= maxFailures) {
          trip()
        }
      }
      throw err
    }
  }

  function reset(): void {
    close()
  }

  return { run, state, reset }
}
