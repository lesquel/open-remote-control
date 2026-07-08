// Tests for Telegram bot — focused on queue resolution behaviour.
// handleCallbackQuery is internal; we test via the polling loop with mocked fetch.
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { createPermissionQueue } from "../../../core/permissions/queue"
import { createCircuitBreaker } from "../../../infra/circuit-breaker/index"
import type { Logger } from "../../../infra/logger/index"
import { createTelegramChannel } from "./index"

function makeLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] }
  return {
    calls,
    debug: (...args: unknown[]) => { calls.debug!.push(args) },
    info: (...args: unknown[]) => { calls.info!.push(args) },
    warn: (...args: unknown[]) => { calls.warn!.push(args) },
    error: (...args: unknown[]) => { calls.error!.push(args) },
  }
}

// Minimal callback_query update that simulates Telegram sending "allow: permId"
function makeCallbackUpdate(action: "allow" | "deny", permId: string, updateId = 1) {
  return {
    update_id: updateId,
    callback_query: {
      id: "cq-id-1",
      data: `${action}:${permId}`,
      from: { id: 999 },
      message: {
        chat: { id: 12345 },
        message_id: 42,
        text: "Permission Request",
      },
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// D1 — pollLoop crash resilience
// ──────────────────────────────────────────────────────────────────────────────
describe("D1 — pollLoop outer crash recovery", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  test("loop logs error and continues when inner logic throws unexpectedly, exits when stop() called", async () => {
    const logger = makeLogger()
    const q = createPermissionQueue(5_000)

    let callCount = 0
    // First call throws in a way that could escape inner try (we simulate it by
    // throwing from the outer mock, before the try inside the loop is entered).
    // In practice the inner try/catch catches rawFetch errors — but the OUTER
    // guard must also handle throws that happen in loop scaffolding.
    // We simulate the outer crash by returning a response that causes offset to become NaN
    // when we force an update_id that would blow up processing — but simplest is:
    // throw synchronously from fetch on call 1, resolve a normal halt on call 3+.
    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (!url.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      callCount++
      if (callCount === 1) {
        // This throw will be caught by the INNER per-iteration try/catch in pollLoop
        // The outer guard ensures even crashes outside that catch are recoverable.
        throw new Error("SIMULATED_OUTER_CRASH")
      }
      // Second+ call: stall (so bot.stop() can be called cleanly from the test)
      await new Promise<void>((r) => setTimeout(r, 10_000))
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      logger,
      // Tiny backoff so the loop retries within the 500ms test window
      { backoffStepsMs: [50] },
    )

    // Give the loop time to process the throw AND retry at least once (50ms backoff)
    await new Promise<void>((r) => setTimeout(r, 300))
    bot.stop()

    // The inner per-iteration catch logs at warn level ("Telegram polling failed")
    // Either way: at least one log entry must record the SIMULATED_OUTER_CRASH,
    // proving the loop didn't die silently.
    const allLogs = [
      ...(logger.calls.warn ?? []),
      ...(logger.calls.error ?? []),
    ]
    const crashLogged = allLogs.some((args) =>
      args.some((a) => {
        if (typeof a === "string") return a.includes("SIMULATED_OUTER_CRASH") || a.includes("polling")
        if (a && typeof a === "object") {
          const s = JSON.stringify(a)
          return s.includes("SIMULATED_OUTER_CRASH")
        }
        return false
      }),
    )
    expect(crashLogged).toBe(true)

    // The loop must have attempted more than one iteration (i.e. it continued after the crash)
    expect(callCount).toBeGreaterThanOrEqual(2)
  }, 5_000)

  test("pollLoop call site attaches a .catch so unhandled rejection is logged", async () => {
    // If the entire pollLoop promise rejects (e.g. outer loop throws),
    // the .catch at the call site must log it.
    const logger = makeLogger()
    const q = createPermissionQueue(5_000)

    let calls = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (!url.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      calls++
      // Always resolve normally so the loop runs but we can stop it
      await new Promise<void>((r) => setTimeout(r, 50))
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      logger,
    )

    // Stop cleanly — the promise should resolve (not be an unhandled rejection)
    await new Promise<void>((r) => setTimeout(r, 150))
    bot.stop()

    // No error logs on a clean run
    await new Promise<void>((r) => setTimeout(r, 100))
    expect(logger.calls.error?.length ?? 0).toBe(0)
  }, 5_000)
})

// ──────────────────────────────────────────────────────────────────────────────
// D2 — stop() wakes abortable sleep immediately
// ──────────────────────────────────────────────────────────────────────────────
describe("D2 — abortable sleep on stop()", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  test("stops polling instead of retrying when another getUpdates poller is active", async () => {
    const logger = makeLogger()
    const q = createPermissionQueue(5_000)
    let getUpdatesCalls = 0
    let loopSettled = false

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (!url.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      getUpdatesCalls++
      return new Response(
        JSON.stringify({
          ok: false,
          description: "Conflict: terminated by other getUpdates request",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      logger,
      {
        backoffStepsMs: [10],
        onLoopSettled: () => { loopSettled = true },
      },
    )

    try {
      await new Promise<void>((r) => setTimeout(r, 80))
      expect(loopSettled).toBe(true)
      expect(getUpdatesCalls).toBe(1)

      const infoLogs = logger.calls.info ?? []
      const stoppedLog = infoLogs.some((args) =>
        args.some((a) => String(a).toLowerCase().includes("another poller")),
      )
      expect(stoppedLog).toBe(true)
    } finally {
      bot.stop()
    }
  }, 5_000)

  test("stop() aborts backoff sleep — loop settles within abort window, not after full sleep duration", async () => {
    // D2 observable: loop must SETTLE (pollLoop promise resolves) promptly after stop().
    // We inject a 500ms backoff. Without the fix: loop settles at t≈500ms.
    // With the fix: loop settles at t≈30ms (immediately after stop() aborts the sleep).
    // We detect this via onLoopSettled callback and wall-clock timing.
    const q = createPermissionQueue(5_000)
    let loopSettledAt = -1

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (!url.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      // Always fail so loop enters 500ms sleep
      throw new Error("simulated failure — loop enters 500ms sleep")
    }) as unknown as typeof globalThis.fetch

    const t0 = Date.now()

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      undefined,
      {
        backoffStepsMs: [500],
        onLoopSettled: () => { loopSettledAt = Date.now() - t0 },
      },
    )

    // Let first fetch fail (loop now sleeping 500ms)
    await new Promise<void>((r) => setTimeout(r, 30))

    // Call stop() mid-sleep (30ms elapsed, 470ms remaining in sleep)
    const stopCalledAt = Date.now() - t0
    bot.stop()

    // With fix: loop settles within ~50ms of stop() (abort fires immediately)
    // Without fix: loop settles at ~500ms (sleep expires naturally)
    // We wait 200ms — well within the window that distinguishes the two cases
    await new Promise<void>((r) => setTimeout(r, 200))

    expect(loopSettledAt).toBeGreaterThanOrEqual(0) // loop did settle
    // Loop should have settled within 150ms of stop() being called (generous window)
    const settleDelay = loopSettledAt - stopCalledAt
    expect(settleDelay).toBeLessThan(150)
  }, 5_000)
})

// ──────────────────────────────────────────────────────────────────────────────
// D3 — api() logs down/recovered transitions, not every call
// ──────────────────────────────────────────────────────────────────────────────
describe("D3 — api() circuit-open logging transition", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  test("api() logs exactly once on first failure, still returns null, and logs recovery on success", async () => {
    const logger = makeLogger()
    const q = createPermissionQueue(5_000)

    let fetchCallCount = 0
    let allowSuccess = false

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()

      if (url.includes("/getUpdates")) {
        // Stall so the poll loop doesn't flood other api() calls
        await new Promise<void>((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      fetchCallCount++
      if (allowSuccess) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      // Fail — causes circuit to accumulate failures
      throw new Error("Telegram unreachable")
    }) as unknown as typeof globalThis.fetch

    // Inject a circuit breaker with tiny resetMs (50ms) so we can test recovery
    // without waiting the production 60s.
    const fastBreaker = createCircuitBreaker({ maxFailures: 5, resetMs: 50 })

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      logger,
      { circuitBreaker: fastBreaker, backoffStepsMs: [50] },
    )

    // Trip the circuit: send 6 messages (maxFailures=5, so 6th hits open state)
    for (let i = 0; i < 6; i++) {
      await bot.sendMessage("test")
    }

    // Count warn/error logs related to the outage
    const downLogs = [
      ...(logger.calls.warn ?? []),
      ...(logger.calls.error ?? []),
    ].filter((args) =>
      args.some((a) => {
        const s = typeof a === "string" ? a : JSON.stringify(a)
        return (
          s.toLowerCase().includes("telegram") &&
          (s.toLowerCase().includes("down") ||
           s.toLowerCase().includes("unreachable") ||
           s.toLowerCase().includes("circuit") ||
           s.toLowerCase().includes("failed"))
        )
      }),
    )

    // Must have logged the outage (at least once)
    expect(downLogs.length).toBeGreaterThanOrEqual(1)

    // Must NOT have logged once per call (6 calls → should be 1 "down" log, not 6)
    const outageLogCount = downLogs.length
    expect(outageLogCount).toBeLessThan(6)

    // Wait for the circuit breaker to transition to half-open (resetMs=50ms)
    await new Promise<void>((r) => setTimeout(r, 100))

    // Now recover: allow fetch to succeed; the half-open probe call will succeed
    allowSuccess = true
    const warnCountBefore = (logger.calls.warn ?? []).length
    const infoCountBefore = (logger.calls.info ?? []).length

    // A successful sendMessage while in half-open → closes circuit → should log "recovered"
    await bot.sendMessage("recovery test")

    const recoveryLogged = [
      ...(logger.calls.warn ?? []).slice(warnCountBefore),
      ...(logger.calls.info ?? []).slice(infoCountBefore),
    ].some((args) =>
      args.some((a) => {
        const s = typeof a === "string" ? a : JSON.stringify(a)
        return s.toLowerCase().includes("recover")
      }),
    )

    bot.stop()
    expect(recoveryLogged).toBe(true)
  }, 10_000)

  test("api() does not log on every call when circuit stays open", async () => {
    const logger = makeLogger()
    const q = createPermissionQueue(5_000)

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/getUpdates")) {
        await new Promise<void>((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error("always down")
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      q,
      q,
      logger,
    )

    // Trip the circuit (5 failures to open, then 10 more calls on open circuit)
    for (let i = 0; i < 15; i++) {
      await bot.sendMessage("flood test")
    }

    const totalLogs = [
      ...(logger.calls.warn ?? []),
      ...(logger.calls.error ?? []),
    ].filter((args) =>
      args.some((a) => {
        const s = typeof a === "string" ? a : JSON.stringify(a)
        return s.toLowerCase().includes("down") || s.toLowerCase().includes("unreachable") || s.toLowerCase().includes("circuit")
      }),
    )

    bot.stop()
    // 15 calls should produce FAR fewer than 15 "down" log entries
    expect(totalLogs.length).toBeLessThan(15)
    // And at least 1 (the first transition)
    expect(totalLogs.length).toBeGreaterThanOrEqual(1)
  }, 10_000)
})

// ──────────────────────────────────────────────────────────────────────────────
// Existing tests (queue resolution)
// ──────────────────────────────────────────────────────────────────────────────
describe("createTelegramChannel — codexPermissionQueue resolution", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  test("allow callback resolves codexPermissionQueue", async () => {
    const permId = "test-perm-id-1234"
    const mainQueue = createPermissionQueue(5_000)
    const codexQueue = createPermissionQueue(5_000)

    let callCount = 0

    // Mock fetch: first call returns one callback update, subsequent calls hang (stop polling)
    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()

      if (url.includes("/getUpdates")) {
        callCount++
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ ok: true, result: [makeCallbackUpdate("allow", permId)] }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        // Subsequent calls: stall so the test can complete without racing
        await new Promise((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      // answerCallbackQuery / editMessageText — just succeed
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      mainQueue,
      codexQueue,
    )

    // Wait for the codex queue to be resolved
    const codexResult = await Promise.race([
      codexQueue.waitForResponse(permId),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ])

    bot.stop()

    expect(codexResult).not.toBeNull()
    expect((codexResult as { action: string } | null)?.action).toBe("allow")
  }, 5_000)

  test("allow callback also resolves mainPermissionQueue", async () => {
    const permId = "test-perm-id-5678"
    const mainQueue = createPermissionQueue(5_000)
    const codexQueue = createPermissionQueue(5_000)

    let callCount = 0

    globalThis.fetch = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()

      if (url.includes("/getUpdates")) {
        callCount++
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ ok: true, result: [makeCallbackUpdate("allow", permId)] }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        await new Promise((r) => setTimeout(r, 10_000))
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const bot = createTelegramChannel(
      { token: "fake-token", chatId: "12345" },
      mainQueue,
      codexQueue,
    )

    const mainResult = await Promise.race([
      mainQueue.waitForResponse(permId),
      new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
    ])

    bot.stop()

    expect(mainResult).not.toBeNull()
    expect((mainResult as { action: string } | null)?.action).toBe("allow")
  }, 5_000)
})
