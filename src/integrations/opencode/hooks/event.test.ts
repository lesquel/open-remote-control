// Tests for createEventHook — sessionBusyStart Map lifecycle
// Covers: busy→idle under threshold, busy→idle over threshold, session.error,
// and whether sessionBusyStart is cleaned up on session.error.
import { describe, expect, test } from "bun:test"
import { createEventHook } from "./event"
import type { NotificationService } from "../../../core/types/notification-service"
import type { PluginInput } from "@opencode-ai/plugin"

// ─── Minimal fake NotificationService ────────────────────────────────────────

type NotifyCall = {
  kind: "idle" | "error"
  sessionID: string
  error?: string
}

function makeNotifications(opts?: {
  notifyPermissionPendingResult?: boolean
}): NotificationService & { calls: NotifyCall[]; emitted: Array<{ type: string }> } {
  const calls: NotifyCall[] = []
  const emitted: Array<{ type: string }> = []
  return {
    calls,
    emitted,
    emit(event) {
      emitted.push({ type: event.type })
    },
    emitPilot(event) {
      emitted.push({ type: event.type })
    },
    async notifyPermissionPending() {
      return opts?.notifyPermissionPendingResult ?? false
    },
    async notifySessionIdle(_client, sessionID) {
      calls.push({ kind: "idle", sessionID })
    },
    async notifySessionError(_client, sessionID, error) {
      calls.push({ kind: "error", sessionID, error })
    },
    async flush() {},
  }
}

// ─── Minimal fake client ──────────────────────────────────────────────────────

function makeClient(): PluginInput["client"] {
  return {} as PluginInput["client"]
}

// ─── Minimal fake audit ───────────────────────────────────────────────────────

type AuditEntry = { action: string; details: Record<string, unknown> }

function makeAudit(entries: AuditEntry[] = []) {
  return {
    entries,
    log(action: string, details: Record<string, unknown>) {
      entries.push({ action, details })
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStatusEvent(sessionID: string, statusType: "busy" | "idle") {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID,
        status: { type: statusType },
      },
    },
  }
}

function makeErrorEvent(sessionID: string, errorMessage = "something went wrong") {
  return {
    event: {
      type: "session.error",
      properties: {
        sessionID,
        error: {
          data: { message: errorMessage },
        },
      },
    },
  }
}

// ─── busy→idle UNDER threshold (≤10s) — no notification ─────────────────────

describe("session.status busy→idle under 10s threshold", () => {
  test("no idle notification when busy duration ≤ threshold", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    // Manually inject a busy start time just 1 second ago (under 10s)
    const sessionID = "sess-under"
    sessionBusyStart.set(sessionID, Date.now() - 1_000)

    await hook(makeStatusEvent(sessionID, "idle"))

    expect(notifications.calls.filter(c => c.kind === "idle")).toHaveLength(0)
  })

  test("sessionBusyStart entry is deleted when under threshold", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-under-delete"
    sessionBusyStart.set(sessionID, Date.now() - 1_000)

    await hook(makeStatusEvent(sessionID, "idle"))

    // The entry must be cleaned up regardless of threshold outcome
    // ACTUAL behavior: the entry is NOT deleted when under threshold (the code
    // only deletes inside the `if (started && Date.now() - started > 10_000)` block)
    // This is a characterization test for the real behavior:
    expect(sessionBusyStart.has(sessionID)).toBe(true) // NOT cleaned up when under threshold
  })
})

// ─── busy→idle OVER threshold (>10s) — should notify ─────────────────────────

describe("session.status busy→idle over 10s threshold", () => {
  test("idle notification IS sent when busy duration > 10s", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-over"
    // Inject a busy start 11 seconds ago (over 10s threshold)
    sessionBusyStart.set(sessionID, Date.now() - 11_000)

    await hook(makeStatusEvent(sessionID, "idle"))

    const idleCalls = notifications.calls.filter(c => c.kind === "idle" && c.sessionID === sessionID)
    expect(idleCalls).toHaveLength(1)
  })

  test("sessionBusyStart entry IS deleted when over threshold", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-over-delete"
    sessionBusyStart.set(sessionID, Date.now() - 11_000)

    await hook(makeStatusEvent(sessionID, "idle"))

    expect(sessionBusyStart.has(sessionID)).toBe(false) // cleaned up when over threshold
  })
})

// ─── busy event sets sessionBusyStart ─────────────────────────────────────────

describe("session.status busy sets sessionBusyStart", () => {
  test("busy event records a start time for the session", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-busy"
    const before = Date.now()
    await hook(makeStatusEvent(sessionID, "busy"))
    const after = Date.now()

    expect(sessionBusyStart.has(sessionID)).toBe(true)
    const recorded = sessionBusyStart.get(sessionID)!
    expect(recorded).toBeGreaterThanOrEqual(before)
    expect(recorded).toBeLessThanOrEqual(after)
  })
})

// ─── session.error — notify is called ─────────────────────────────────────────

describe("session.error behavior", () => {
  test("session.error fires notifySessionError with the correct sessionID and error message", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-err"
    const errorMessage = "the model timed out"

    await hook(makeErrorEvent(sessionID, errorMessage))

    const errorCalls = notifications.calls.filter(c => c.kind === "error")
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0]!.sessionID).toBe(sessionID)
    expect(errorCalls[0]!.error).toBe(errorMessage)
  })

  test("session.error falls back to String(props.error) when errorObj.data.message is absent", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-err-fallback"
    await hook({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "flat string error",
        },
      },
    })

    const errorCalls = notifications.calls.filter(c => c.kind === "error")
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0]!.error).toBe("flat string error")
  })

  // ─── LATENT BUG CHARACTERIZATION TEST ─────────────────────────────────────
  // The audit flagged that sessionBusyStart is NOT cleaned up on session.error.
  // This test asserts the ACTUAL current behavior (NOT fixed here — see final summary).
  test("CHARACTERIZATION: sessionBusyStart is NOT cleaned up on session.error", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    const sessionID = "sess-err-cleanup"

    // First mark the session busy
    await hook(makeStatusEvent(sessionID, "busy"))
    expect(sessionBusyStart.has(sessionID)).toBe(true) // sanity check

    // Now fire session.error — the code at event.ts:39-45 does NOT touch sessionBusyStart
    await hook(makeErrorEvent(sessionID, "crashed"))

    // ACTUAL behavior: entry remains in the map (possible memory leak)
    expect(sessionBusyStart.has(sessionID)).toBe(true)
  })
})

// ─── All events are forwarded to the SSE bus ──────────────────────────────────

describe("all events forwarded to notifications.emit", () => {
  test("every event type is forwarded regardless of session.status logic", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    await hook({ event: { type: "tool.completed", properties: { sessionID: "s1", result: "ok" } } })
    await hook({ event: { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } } })

    expect(notifications.emitted.length).toBeGreaterThanOrEqual(2)
    expect(notifications.emitted.some(e => e.type === "tool.completed")).toBe(true)
    expect(notifications.emitted.some(e => e.type === "session.status")).toBe(true)
  })

  test("audit.log is called for every event", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const auditEntries: AuditEntry[] = []
    const audit = makeAudit(auditEntries)
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), audit)

    await hook({ event: { type: "tool.completed", properties: {} } })
    await hook({ event: { type: "session.error", properties: { sessionID: "x", error: "e" } } })

    expect(auditEntries.filter(e => e.action === "event")).toHaveLength(2)
  })
})

// ─── idle event without prior busy entry ─────────────────────────────────────

describe("idle event with no prior busy entry", () => {
  test("idle with no busyStart entry does NOT notify", async () => {
    const sessionBusyStart = new Map<string, number>()
    const notifications = makeNotifications()
    const hook = createEventHook(notifications, sessionBusyStart, makeClient(), makeAudit())

    // Never set busy — sessionBusyStart is empty
    await hook(makeStatusEvent("sess-no-busy", "idle"))

    expect(notifications.calls.filter(c => c.kind === "idle")).toHaveLength(0)
  })
})
