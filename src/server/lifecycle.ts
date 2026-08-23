/**
 * lifecycle.ts — process-global error handler installation + shutdown guard.
 *
 * Extracted from server/index.ts to:
 *   (D1) install uncaughtException / unhandledRejection EXACTLY ONCE per
 *        process regardless of how many plugin-factory invocations occur.
 *   (D3) provide a per-invocation re-entrant shutdown guard so that concurrent
 *        SIGINT+SIGTERM or multiple signal deliveries do not double-run cleanup.
 *
 * Both exports are PURE factory / install functions — no classes, per AGENTS.md.
 */

import type { EventBus } from "../core/events/bus"
import { getSharedEventBus } from "../core/events/bus"

type ShutdownSignal = "SIGINT" | "SIGTERM"

interface SignalSource {
  once(event: ShutdownSignal, listener: () => void): unknown
}

export interface ShutdownCoordinator {
  register(handler: () => Promise<void>): () => void
}

export interface ShutdownStep {
  name: string
  run: () => void | Promise<void>
}

/** Run cleanup sequentially while making every failure observable and isolated. */
export async function runShutdownSteps(
  steps: ReadonlyArray<ShutdownStep>,
  onError: (step: string, error: unknown) => void,
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run()
    } catch (error) {
      onError(step.name, error)
    }
  }
}

/**
 * Own process signals once while allowing every plugin instance to register
 * independent cleanup. A failing instance is isolated from the remaining
 * handlers, and SIGINT followed by SIGTERM can never replay cleanup.
 */
export function createShutdownCoordinator(
  signals: SignalSource,
  onError: (error: unknown) => void,
): ShutdownCoordinator {
  const handlers = new Set<() => Promise<void>>()
  let installed = false
  let shuttingDown = false

  async function runAll(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    const pending = [...handlers]
    handlers.clear()
    const results = await Promise.allSettled(pending.map((handler) => handler()))
    for (const result of results) {
      if (result.status === "rejected") onError(result.reason)
    }
  }

  function register(handler: () => Promise<void>): () => void {
    if (shuttingDown) {
      void handler().catch(onError)
      return () => {}
    }
    handlers.add(handler)
    if (!installed) {
      installed = true
      signals.once("SIGINT", () => void runAll())
      signals.once("SIGTERM", () => void runAll())
    }
    return () => { handlers.delete(handler) }
  }

  return { register }
}

const processShutdownCoordinator = createShutdownCoordinator(process, () => {
  // Each registered instance wraps its cleanup with its own structured logger.
  // This fallback is intentionally silent because stdout/stderr corrupts the TUI.
})

export function registerProcessShutdown(handler: () => Promise<void>): () => void {
  return processShutdownCoordinator.register(handler)
}

// ─── D1 guard — module-scoped, lives for the lifetime of the process ──────────
//
// `process.on("uncaughtException", …)` accumulates per call. Every plugin-factory
// invocation previously added another pair of listeners → N duplicate audit writes
// and a MaxListenersExceededWarning feedback loop. A module-level boolean ensures
// the two handlers are installed exactly once no matter how many workspaces/
// worktrees invoke the factory in the same Node/Bun process.
//
// DO NOT use process.once — once removes the listener after the first fire, so a
// second unhandled rejection would be completely unhandled.
// DO NOT remove these listeners in per-instance shutdown — they must live for
// process lifetime so every future unhandled error is still captured.
let _globalErrorHandlersInstalled = false

/** Deps forwarded to the global error handlers — only the first invocation wins. */
interface GlobalHandlerDeps {
  /** The process-wide shared event bus (passed for testability). */
  eventBus: EventBus
  /** Audit logger compatible with the AuditLog interface. */
  audit: { log: (event: string, payload: Record<string, unknown>) => void }
  /** Structured logger (no console.log — TUI renders stdout as red noise). */
  logger: { error: (message: string, payload?: Record<string, unknown>) => void }
}

/**
 * Install the two process-global error handlers at most once.
 *
 * Safe to call on every plugin-factory invocation. On the first call the
 * handlers are registered; all subsequent calls are no-ops. The handlers
 * route through `getSharedEventBus()` on EACH invocation so they always use
 * the live singleton — not a closure over a potentially-stale reference.
 *
 * @param deps - passed for testability; the bus obtained via `getSharedEventBus()`
 *               at call time of each error handler is what's actually used inside
 *               the callbacks (ensures correctness even if deps differ across invocations).
 */
export function installGlobalErrorHandlersOnce(deps: GlobalHandlerDeps): void {
  if (_globalErrorHandlersInstalled) return
  _globalErrorHandlersInstalled = true

  // Use the first caller's deps as the stable reference, but inside the
  // handlers always obtain the shared bus at call time so that bus resets
  // in tests do not silently break the handler.
  const { audit, logger } = deps

  process.on("uncaughtException", (err: Error) => {
    const bus = getSharedEventBus()
    audit.log("process.uncaughtException", { error: err.message, stack: err.stack ?? "" })
    logger.error("Uncaught exception", { error: err.message })
    bus.emit({
      type: "pilot.error",
      properties: { kind: "uncaughtException", message: err.message, timestamp: Date.now() },
    })
    // Do NOT exit — let the process continue (non-fatal)
  })

  process.on("unhandledRejection", (reason: unknown) => {
    const bus = getSharedEventBus()
    const message = reason instanceof Error ? reason.message : String(reason)
    audit.log("process.unhandledRejection", { error: message })
    logger.error("Unhandled rejection", { error: message })
    bus.emit({
      type: "pilot.error",
      properties: { kind: "unhandledRejection", message, timestamp: Date.now() },
    })
    // Do NOT exit — non-fatal
  })
}

// ─── D3 shutdown guard ────────────────────────────────────────────────────────

interface ShutdownGuardDeps {
  /** The per-invocation event bus reference (= getSharedEventBus() at call site). */
  eventBus: EventBus
}

interface ShutdownGuard {
  /**
   * Wraps the caller-supplied async cleanup body with:
   *   - (D3) re-entrant guard: second invocation is a no-op.
   *   - (D2) calls `eventBus.closeAll()` before the caller's cleanup runs.
   *
   * Usage in server/index.ts:
   *   const { shutdown } = createShutdownGuard({ eventBus })
   *   // … build the rest of shutdown logic, then:
   *   process.once("SIGINT", () => void shutdown(async () => { … your cleanup … }))
   *
   * The simpler form `shutdown()` (no argument) is used in tests.
   */
  shutdown: (body?: () => Promise<void>) => Promise<void>
}

/**
 * Create a per-plugin-invocation re-entrant shutdown guard.
 *
 * The returned `shutdown` wrapper guarantees:
 *   - D2: `eventBus.closeAll()` is called (errors swallowed — best-effort
 *         cleanup in shutdown path, per AGENTS.md §3 "No silent failures"
 *         exception: "only acceptable when the error is provably irrelevant
 *         (e.g., best-effort cleanup in a shutdown path) AND there is a
 *         comment explaining why").
 *   - D3: the cleanup body runs at most once; subsequent calls are no-ops.
 */
export function createShutdownGuard(deps: ShutdownGuardDeps): ShutdownGuard {
  let shuttingDown = false

  async function shutdown(body?: () => Promise<void>): Promise<void> {
    // D3 — re-entrancy guard: SIGINT then SIGTERM (or double-SIGINT) must not
    // run server.stop(), tunnel.stop(), clearState, etc. twice.
    if (shuttingDown) return
    shuttingDown = true

    // D2 — close SSE clients before server.stop() so in-flight streams are
    // flushed/terminated cleanly. Without this, per-client ping setIntervals
    // keep firing after Bun's HTTP server has stopped accepting connections.
    // Swallowed: closeAll() iterates a Set and calls controller.close() per
    // client — if a client's controller is already closed, close() throws
    // "ReadableStream is already closed" (Bun/WhatWG). Safe to ignore.
    try { deps.eventBus.closeAll() } catch { /* best-effort SSE teardown */ }

    if (body) {
      await body()
    }
  }

  return { shutdown }
}
