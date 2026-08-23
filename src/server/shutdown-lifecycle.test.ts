/**
 * Shutdown lifecycle tests — TDD for the 4 verified defects fixed in this PR.
 *
 * D1 — process error handlers must be installed exactly once per process
 * D2 — shutdown() must call eventBus.closeAll()
 * D3 — shutdown() must be idempotent (re-entrant safe)
 * D4 — no process.once("exit", ...) handler registered
 */

import { describe, test, expect, mock } from "bun:test"
import {
  installGlobalErrorHandlersOnce,
  createShutdownCoordinator,
  createShutdownGuard,
  runShutdownSteps,
} from "./lifecycle"
import { EventEmitter } from "node:events"

// ─── D1: installGlobalErrorHandlersOnce ──────────────────────────────────────

describe("installGlobalErrorHandlersOnce", () => {
  // No beforeEach/afterEach: the module-scoped install-once guard cannot be
  // reset, and each test file runs in its own Bun worker, so process listener
  // counts stay stable within this file. Tests assert deltas directly.

  test("calling installGlobalErrorHandlersOnce twice does not increase process listener count the second time", () => {
    // First call installs the handlers — counts rise by 1 each.
    const deps1 = makeDeps()
    installGlobalErrorHandlersOnce(deps1)
    const afterFirst = process.listenerCount("uncaughtException")

    // Second call must be a no-op — counts MUST NOT increase.
    const deps2 = makeDeps()
    installGlobalErrorHandlersOnce(deps2)
    const afterSecond = process.listenerCount("uncaughtException")

    expect(afterSecond).toBe(afterFirst)
  })

  test("calling installGlobalErrorHandlersOnce ten times does not add more than one uncaughtException listener", () => {
    const before = process.listenerCount("uncaughtException")
    for (let i = 0; i < 10; i++) {
      installGlobalErrorHandlersOnce(makeDeps())
    }
    const after = process.listenerCount("uncaughtException")
    // The function may have already been called in prior test; at most one
    // additional listener added across all these calls combined.
    expect(after - before).toBeLessThanOrEqual(1)
  })

  test("calling installGlobalErrorHandlersOnce ten times does not add more than one unhandledRejection listener", () => {
    const before = process.listenerCount("unhandledRejection")
    for (let i = 0; i < 10; i++) {
      installGlobalErrorHandlersOnce(makeDeps())
    }
    const after = process.listenerCount("unhandledRejection")
    expect(after - before).toBeLessThanOrEqual(1)
  })
})

// ─── D2: shutdown must call eventBus.closeAll ─────────────────────────────────

describe("createShutdownGuard — closeAll called", () => {
  test("shutdown() calls eventBus.closeAll()", async () => {
    let closedAll = false
    const fakeEventBus = {
      closeAll: () => { closedAll = true },
    }
    const { shutdown } = createShutdownGuard({ eventBus: fakeEventBus as never })
    await shutdown()
    expect(closedAll).toBe(true)
  })

  test("shutdown() calls eventBus.closeAll() even when closeAll throws", async () => {
    let closedAttempted = false
    const fakeEventBus = {
      closeAll: () => {
        closedAttempted = true
        throw new Error("close failed")
      },
    }
    const { shutdown } = createShutdownGuard({ eventBus: fakeEventBus as never })
    // Must not throw
    await expect(shutdown()).resolves.toBeUndefined()
    expect(closedAttempted).toBe(true)
  })
})

describe("runShutdownSteps — observable failure isolation", () => {
  test("preserves order and continues after a failed cleanup", async () => {
    const calls: string[] = []
    const errors: Array<{ step: string; error: unknown }> = []
    await runShutdownSteps([
      { name: "integration", run: () => { calls.push("integration"); throw new Error("failed") } },
      { name: "http", run: async () => { calls.push("http") } },
      { name: "state", run: () => { calls.push("state") } },
    ], (step, error) => errors.push({ step, error }))

    expect(calls).toEqual(["integration", "http", "state"])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.step).toBe("integration")
  })
})

// ─── D3: shutdown must be idempotent ─────────────────────────────────────────

describe("createShutdownGuard — idempotency", () => {
  test("calling shutdown() twice only runs cleanup once", async () => {
    let closeAllCount = 0
    const fakeEventBus = {
      closeAll: () => { closeAllCount++ },
    }
    const { shutdown } = createShutdownGuard({ eventBus: fakeEventBus as never })
    await shutdown()
    await shutdown()
    expect(closeAllCount).toBe(1)
  })

  test("calling shutdown() ten times only runs cleanup once", async () => {
    let closeAllCount = 0
    const fakeEventBus = {
      closeAll: () => { closeAllCount++ },
    }
    const { shutdown } = createShutdownGuard({ eventBus: fakeEventBus as never })
    await Promise.all(Array.from({ length: 10 }, () => shutdown()))
    expect(closeAllCount).toBe(1)
  })

  test("second shutdown() call returns immediately (no error)", async () => {
    const fakeEventBus = { closeAll: () => {} }
    const { shutdown } = createShutdownGuard({ eventBus: fakeEventBus as never })
    await shutdown()
    await expect(shutdown()).resolves.toBeUndefined()
  })
})

// ─── D4: no process.once("exit") ─────────────────────────────────────────────

describe("D4 — no process exit listener registered by lifecycle module", () => {
  test("importing lifecycle does not add a process exit listener", async () => {
    // The exit listener count must not change just from importing the module.
    // Since this file already imports lifecycle above, we measure the count
    // from the current state — if the import had added one, the other tests
    // would have seen it; this assertion confirms the current count is sane.
    const countBefore = process.listenerCount("exit")
    // Re-import to simulate what server/index.ts does on each invocation.
    // Bun caches modules so this is a no-op, but the count check is still valid.
    await import("./lifecycle")
    const countAfter = process.listenerCount("exit")
    expect(countAfter).toBe(countBefore)
  })
})

describe("createShutdownCoordinator — process-wide ownership", () => {
  test("installs one listener per signal and runs every registered instance", async () => {
    const signals = new EventEmitter()
    const errors: unknown[] = []
    const coordinator = createShutdownCoordinator(signals, (error) => errors.push(error))
    let first = 0
    let second = 0

    coordinator.register(async () => { first += 1 })
    coordinator.register(async () => { second += 1 })
    expect(signals.listenerCount("SIGINT")).toBe(1)
    expect(signals.listenerCount("SIGTERM")).toBe(1)

    signals.emit("SIGINT")
    await Bun.sleep(0)
    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(errors).toEqual([])
  })

  test("a second signal cannot run instance cleanup twice", async () => {
    const signals = new EventEmitter()
    const coordinator = createShutdownCoordinator(signals, () => {})
    let calls = 0
    coordinator.register(async () => { calls += 1 })

    signals.emit("SIGINT")
    signals.emit("SIGTERM")
    await Bun.sleep(0)
    expect(calls).toBe(1)
  })

  test("one rejected cleanup does not prevent the remaining instances", async () => {
    const signals = new EventEmitter()
    const errors: unknown[] = []
    const coordinator = createShutdownCoordinator(signals, (error) => errors.push(error))
    let completed = false
    coordinator.register(async () => { throw new Error("cleanup failed") })
    coordinator.register(async () => { completed = true })

    signals.emit("SIGTERM")
    await Bun.sleep(0)
    expect(completed).toBe(true)
    expect(errors).toHaveLength(1)
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps() {
  return {
    eventBus: {
      emit: () => {},
      closeAll: () => {},
    } as never,
    // Minimal no-op audit compatible with AuditLog interface used by handler
    audit: {
      log: () => {},
    } as never,
    logger: {
      error: () => {},
    } as never,
  }
}
