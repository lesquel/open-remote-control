// Tests for createNotificationService (pipeline fan-out)
// Covers: notifyPermissionPending return value, SSE-reachability gating,
// fire-and-forget channel dispatch, in-flight tracking + flush drain/timeout,
// emit/emitPilot wiring.
import { describe, expect, test } from "bun:test"
import { createNotificationService } from "./pipeline"
import type { NotificationServiceDeps } from "./pipeline"
import type { EventBus } from "../core/events/bus"
import type { TelegramChannel } from "./channels/telegram/index"
import type { PushService } from "./channels/push/service"
import type { AuditLog } from "../core/audit/log"
import type { NotificationChannel, NotificationEvent, NotificationResult } from "./ports"
import type { BusEvent } from "../core/events/types"

// ─── Fake EventBus ────────────────────────────────────────────────────────────

function makeEventBus(opts?: { hasClients?: boolean }): EventBus & { emitted: BusEvent[] } {
  const emitted: BusEvent[] = []
  return {
    emitted,
    emit(event) { emitted.push(event) },
    createSSEResponse: () => new Response(""),
    hasClients: () => opts?.hasClients ?? false,
    clientCount: () => (opts?.hasClients ? 1 : 0),
    closeAll: () => {},
  }
}

// ─── Fake TelegramChannel ─────────────────────────────────────────────────────

type TelegramCall = { method: string; args: unknown[] }

function makeTelegram(opts?: { enabled?: boolean }): TelegramChannel & { calls: TelegramCall[] } {
  const calls: TelegramCall[] = []
  const isEnabled = opts?.enabled ?? false
  return {
    name: "telegram" as const,
    calls,
    enabled: () => isEnabled,
    send: async (_event) => { calls.push({ method: "send", args: [_event] }); return { ok: true } },
    sendMessage: async (text) => { calls.push({ method: "sendMessage", args: [text] }) },
    sendPermissionRequest: async (id, title, sessionId) => {
      calls.push({ method: "sendPermissionRequest", args: [id, title, sessionId] })
    },
    sendStartup: async (url) => { calls.push({ method: "sendStartup", args: [url] }) },
    sendSessionIdle: async (sessionId, title) => {
      calls.push({ method: "sendSessionIdle", args: [sessionId, title] })
    },
    sendSessionError: async (sessionId, title, error) => {
      calls.push({ method: "sendSessionError", args: [sessionId, title, error] })
    },
    testConnection: async () => ({ ok: true }),
    stop: () => {},
  }
}

// ─── Fake PushService ─────────────────────────────────────────────────────────

function makePush(opts?: {
  enabled?: boolean
  subscriptionCount?: number
}): PushService & { broadcasts: unknown[] } {
  const broadcasts: unknown[] = []
  const channel: NotificationChannel = {
    name: "push",
    enabled: () => opts?.enabled ?? false,
    send: async () => ({ ok: true }),
  }
  return {
    broadcasts,
    channel,
    isEnabled: () => opts?.enabled ?? false,
    addSubscription: () => ({ ok: true }),
    removeSubscription: () => {},
    broadcast: async (payload) => { broadcasts.push(payload) },
    sendTo: async () => true,
    count: () => opts?.subscriptionCount ?? 0,
    generateVapid: async () => ({ ok: true as const, publicKey: "", privateKey: "" }),
  }
}

// ─── Fake AuditLog ────────────────────────────────────────────────────────────

type AuditEntry = { action: string; details: Record<string, unknown> }

function makeAudit(entries: AuditEntry[] = []): AuditLog & { entries: AuditEntry[] } {
  return {
    entries,
    log(action, details) { entries.push({ action, details }) },
  }
}

// ─── Fake extra channel ───────────────────────────────────────────────────────

function makeChannel(opts?: {
  enabled?: boolean
  name?: string
}): NotificationChannel & { sentEvents: NotificationEvent[]; shouldFail?: boolean } {
  const sentEvents: NotificationEvent[] = []
  return {
    sentEvents,
    name: opts?.name ?? "extra",
    enabled: () => opts?.enabled ?? true,
    send: async (event) => {
      sentEvents.push(event)
      return { ok: true }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<NotificationServiceDeps>): NotificationServiceDeps & {
  eventBus: ReturnType<typeof makeEventBus>
  telegram: ReturnType<typeof makeTelegram>
  push: ReturnType<typeof makePush>
  audit: ReturnType<typeof makeAudit>
} {
  const eventBus = (overrides?.eventBus as ReturnType<typeof makeEventBus>) ?? makeEventBus()
  const telegram = (overrides?.telegram as ReturnType<typeof makeTelegram>) ?? makeTelegram()
  const push = (overrides?.push as ReturnType<typeof makePush>) ?? makePush()
  const audit = (overrides?.audit as ReturnType<typeof makeAudit>) ?? makeAudit()
  return {
    eventBus,
    telegram,
    push,
    audit,
    channels: overrides?.channels,
  }
}

// ─── notifyPermissionPending: return value (security-critical) ────────────────

describe("notifyPermissionPending — return value controls whether permission hook blocks", () => {
  test("returns false when SSE has no clients, telegram disabled, push disabled", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: false }),
      telegram: makeTelegram({ enabled: false }),
      push: makePush({ enabled: false }),
    })
    const svc = createNotificationService(deps)

    const result = await svc.notifyPermissionPending("p1", "title", "sess", "execute")
    expect(result).toBe(false)
  })

  test("returns true when SSE has clients", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: true }),
      telegram: makeTelegram({ enabled: false }),
      push: makePush({ enabled: false }),
    })
    const svc = createNotificationService(deps)

    const result = await svc.notifyPermissionPending("p2", "title", "sess", "execute")
    expect(result).toBe(true)
  })

  test("returns true when telegram is enabled (regardless of SSE/push)", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: false }),
      telegram: makeTelegram({ enabled: true }),
      push: makePush({ enabled: false }),
    })
    const svc = createNotificationService(deps)

    const result = await svc.notifyPermissionPending("p3", "title", "sess", "execute")
    expect(result).toBe(true)
  })

  test("returns true when push is enabled with at least one subscription", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: false }),
      telegram: makeTelegram({ enabled: false }),
      push: makePush({ enabled: true, subscriptionCount: 1 }),
    })
    const svc = createNotificationService(deps)

    const result = await svc.notifyPermissionPending("p4", "title", "sess", "execute")
    expect(result).toBe(true)
  })

  test("returns false when push enabled but 0 subscriptions", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: false }),
      telegram: makeTelegram({ enabled: false }),
      push: makePush({ enabled: true, subscriptionCount: 0 }),
    })
    const svc = createNotificationService(deps)

    const result = await svc.notifyPermissionPending("p5", "title", "sess", "execute")
    expect(result).toBe(false)
  })
})

// ─── notifyPermissionPending: SSE event emitted only when hasClients ──────────

describe("notifyPermissionPending — SSE pilot.permission.pending emitted only when reachable", () => {
  test("pilot.permission.pending IS emitted when SSE has clients", async () => {
    const deps = makeDeps({ eventBus: makeEventBus({ hasClients: true }) })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-sse", "Allow bash", "sess-1", "execute")

    const pending = deps.eventBus.emitted.find(e => e.type === "pilot.permission.pending")
    expect(pending).toBeDefined()
    const props = pending?.properties as Record<string, unknown>
    expect(props.permissionID).toBe("perm-sse")
    expect(props.title).toBe("Allow bash")
    expect(props.sessionID).toBe("sess-1")
  })

  test("pilot.permission.pending is NOT emitted when no SSE clients", async () => {
    const deps = makeDeps({
      eventBus: makeEventBus({ hasClients: false }),
      telegram: makeTelegram({ enabled: false }),
      push: makePush({ enabled: false }),
    })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-no-sse", "title", "sess", "execute")

    const pending = deps.eventBus.emitted.find(e => e.type === "pilot.permission.pending")
    expect(pending).toBeUndefined()
  })

  test("audit.log permission.requested is called when SSE has clients", async () => {
    const auditEntries: AuditEntry[] = []
    const audit = makeAudit(auditEntries)
    const deps = makeDeps({ eventBus: makeEventBus({ hasClients: true }), audit })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-audit", "title", "sess", "execute")

    const entry = auditEntries.find(e => e.action === "permission.requested")
    expect(entry).toBeDefined()
  })
})

// ─── notifyPermissionPending: fire-and-forget channel dispatch ────────────────

describe("notifyPermissionPending — fire-and-forget channel dispatch", () => {
  test("enabled extra channel receives permission.pending event", async () => {
    const channel = makeChannel({ enabled: true })
    const deps = makeDeps({ channels: [channel] })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-ch", "Allow read", "sess", "read")

    // Channel dispatch is fire-and-forget — flush to let micro-tasks settle
    await new Promise<void>(r => setTimeout(r, 10))

    expect(channel.sentEvents.some(e => e.kind === "permission.pending")).toBe(true)
  })

  test("disabled extra channel is skipped", async () => {
    const channel = makeChannel({ enabled: false })
    const deps = makeDeps({ channels: [channel] })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-ch-off", "title", "sess", "execute")

    await new Promise<void>(r => setTimeout(r, 10))

    expect(channel.sentEvents).toHaveLength(0)
  })

  test("one failing channel does not prevent other channels from receiving the event", async () => {
    const failingChannel: NotificationChannel & { calls: number } = {
      calls: 0,
      name: "failing",
      enabled: () => true,
      send: async () => {
        failingChannel.calls++
        throw new Error("channel exploded")
      },
    }
    const goodChannel = makeChannel({ enabled: true, name: "good" })
    const auditEntries: AuditEntry[] = []
    const audit = makeAudit(auditEntries)

    const deps = makeDeps({ channels: [failingChannel, goodChannel], audit })
    const svc = createNotificationService(deps)

    // Should not throw — await directly and assert it resolves cleanly
    const result = await svc.notifyPermissionPending("perm-fail", "title", "sess", "execute")
    expect(typeof result).toBe("boolean")

    await new Promise<void>(r => setTimeout(r, 20))

    // Good channel still received the event
    expect(goodChannel.sentEvents.some(e => e.kind === "permission.pending")).toBe(true)
    // Failure was audited
    expect(auditEntries.some(e => e.action === "channel.send_failed")).toBe(true)
  })

  test("deduplicates external delivery while preserving SSE reachability", async () => {
    let now = 1_000
    const channel = makeChannel({ enabled: true })
    const telegram = makeTelegram({ enabled: true })
    const push = makePush({ enabled: true, subscriptionCount: 1 })
    const eventBus = makeEventBus({ hasClients: true })
    const deps = makeDeps({ channels: [channel], telegram, push, eventBus })
    const svc = createNotificationService(deps, { dedupWindowMs: 100, now: () => now })

    await svc.notifyPermissionPending("perm-dup", "Allow", "sess", "execute")
    await svc.notifyPermissionPending("perm-dup", "Allow", "sess", "execute")
    await svc.flush()

    expect(telegram.calls.filter(call => call.method === "sendPermissionRequest")).toHaveLength(1)
    expect(push.broadcasts).toHaveLength(1)
    expect(channel.sentEvents).toHaveLength(1)
    expect(eventBus.emitted.filter(event => event.type === "pilot.permission.pending")).toHaveLength(2)
    expect(deps.audit.entries.some(entry => entry.action === "notifications.duplicate_suppressed")).toBe(true)

    now += 100
    await svc.notifyPermissionPending("perm-dup", "Allow", "sess", "execute")
    await svc.flush()
    expect(push.broadcasts).toHaveLength(2)
  })
})

// ─── emit / emitPilot ─────────────────────────────────────────────────────────

describe("emit and emitPilot", () => {
  test("emit forwards raw BusEvent to eventBus.emit", () => {
    const deps = makeDeps()
    const svc = createNotificationService(deps)

    svc.emit({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } })

    expect(deps.eventBus.emitted.some(e => e.type === "session.status")).toBe(true)
  })

  test("emitPilot forwards PilotEvent to eventBus.emit", () => {
    const deps = makeDeps()
    const svc = createNotificationService(deps)

    svc.emitPilot({ type: "pilot.tool.started", properties: { tool: "bash", sessionID: "s", callID: "c" } })

    expect(deps.eventBus.emitted.some(e => e.type === "pilot.tool.started")).toBe(true)
  })

  test("emitPilot records event.pilot in audit log", () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeDeps({ audit: makeAudit(auditEntries) })
    const svc = createNotificationService(deps)

    svc.emitPilot({ type: "pilot.tool.started", properties: { tool: "bash", sessionID: "s", callID: "c" } })

    const entry = auditEntries.find(e => e.action === "event.pilot")
    expect(entry).toBeDefined()
    expect(entry?.details.type).toBe("pilot.tool.started")
  })
})

// ─── flush ────────────────────────────────────────────────────────────────────

describe("flush", () => {
  test("flush resolves immediately with nothing in flight", async () => {
    const deps = makeDeps()
    const svc = createNotificationService(deps)

    // Fast path: no tracked promises, should resolve without delay
    await expect(svc.flush()).resolves.toBeUndefined()
  })

  test("flush awaits an in-flight slow channel dispatch from notifyPermissionPending", async () => {
    // A slow channel that resolves after a short delay
    let resolveDispatch!: () => void
    const dispatchSettled = new Promise<void>(r => { resolveDispatch = r })
    const slowChannel: NotificationChannel = {
      name: "slow",
      enabled: () => true,
      send: async (): Promise<NotificationResult> => {
        await new Promise<void>(r => setTimeout(r, 30))
        resolveDispatch()
        return { ok: true }
      },
    }
    const deps = makeDeps({ channels: [slowChannel] })
    const svc = createNotificationService(deps)

    // Fire permission pending — starts the slow dispatch in the background
    await svc.notifyPermissionPending("p-slow", "title", "sess", "execute")
    // The dispatch is still running (30ms). flush() should wait for it.
    const flushDone = svc.flush()
    await flushDone
    // By the time flush() resolves, the dispatch must have settled
    const settled = await Promise.race([
      dispatchSettled.then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), 5)),
    ])
    expect(settled).toBe(true)
  })

  test("flush awaits an in-flight slow channel dispatch from notifySessionIdle", async () => {
    let resolveDispatch!: () => void
    const dispatchSettled = new Promise<void>(r => { resolveDispatch = r })
    const slowChannel: NotificationChannel = {
      name: "slow-idle",
      enabled: () => true,
      send: async (): Promise<NotificationResult> => {
        await new Promise<void>(r => setTimeout(r, 30))
        resolveDispatch()
        return { ok: true }
      },
    }
    const deps = makeDeps({ channels: [slowChannel] })
    const svc = createNotificationService(deps)

    const fakeClient = {
      session: { get: async () => ({ data: { title: "S" } }) },
    } as unknown as Parameters<typeof svc.notifySessionIdle>[0]

    await svc.notifySessionIdle(fakeClient, "s-idle")
    await svc.flush()

    const settled = await Promise.race([
      dispatchSettled.then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), 5)),
    ])
    expect(settled).toBe(true)
  })

  test("flush resolves within bound and audits notifications.flush_timeout when a dispatch hangs", async () => {
    // A channel whose send() never resolves — simulates a wedged channel
    const hangingChannel: NotificationChannel = {
      name: "hanging",
      enabled: () => true,
      send: (): Promise<NotificationResult> => new Promise(() => {}), // never resolves
    }
    const auditEntries: AuditEntry[] = []
    const audit = makeAudit(auditEntries)
    const deps = makeDeps({ channels: [hangingChannel], audit })
    // Use a very short flush timeout so the test doesn't take 5 seconds
    const svc = createNotificationService(deps, { flushTimeoutMs: 50 })

    await svc.notifyPermissionPending("p-hang", "title", "sess", "execute")

    // flush() must resolve within the short bound (well under 200ms)
    const start = Date.now()
    await svc.flush()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)

    // The drop must be observable via audit (AGENTS.md §3 "No silent failures")
    const timeoutEntry = auditEntries.find(e => e.action === "notifications.flush_timeout")
    expect(timeoutEntry).toBeDefined()
    expect(typeof timeoutEntry?.details.pending).toBe("number")
    expect((timeoutEntry?.details.pending as number)).toBeGreaterThan(0)
  })
})

// ─── notifySessionIdle — fan-out to extra channels ───────────────────────────

describe("notifySessionIdle — fan-out to extra channels", () => {
  test("enabled channel receives session.idle event", async () => {
    const channel = makeChannel({ enabled: true })
    const deps = makeDeps({ channels: [channel] })
    const svc = createNotificationService(deps)

    // Fake client that returns a session
    const fakeClient = {
      session: {
        get: async () => ({ data: { title: "My Session" } }),
      },
    } as unknown as Parameters<typeof svc.notifySessionIdle>[0]

    await svc.notifySessionIdle(fakeClient, "sess-idle")

    expect(channel.sentEvents.some(e => e.kind === "session.idle")).toBe(true)
  })

  test("sends one deduplicated push notification when the agent finishes", async () => {
    const push = makePush({ enabled: true, subscriptionCount: 1 })
    const deps = makeDeps({ push })
    const svc = createNotificationService(deps)
    const fakeClient = {
      session: { get: async () => ({ data: { title: "My Session" } }) },
    } as unknown as Parameters<typeof svc.notifySessionIdle>[0]

    await svc.notifySessionIdle(fakeClient, "sess-push-idle")
    await svc.notifySessionIdle(fakeClient, "sess-push-idle")
    await svc.flush()

    expect(push.broadcasts).toHaveLength(1)
    expect(push.broadcasts[0]).toMatchObject({
      title: "Agent finished",
      body: "My Session",
      data: { kind: "session", sessionID: "sess-push-idle" },
    })
  })

  test("disabled channel is not called during session.idle", async () => {
    const channel = makeChannel({ enabled: false })
    const deps = makeDeps({ channels: [channel] })
    const svc = createNotificationService(deps)

    const fakeClient = {
      session: {
        get: async () => ({ data: { title: "My Session" } }),
      },
    } as unknown as Parameters<typeof svc.notifySessionIdle>[0]

    await svc.notifySessionIdle(fakeClient, "sess-idle-off")

    expect(channel.sentEvents).toHaveLength(0)
  })
})

// ─── notifySessionError — fan-out to extra channels ──────────────────────────

describe("notifySessionError — fan-out to extra channels", () => {
  test("enabled channel receives session.error event", async () => {
    const channel = makeChannel({ enabled: true })
    const deps = makeDeps({ channels: [channel] })
    const svc = createNotificationService(deps)

    const fakeClient = {
      session: {
        get: async () => ({ data: { title: "My Session" } }),
      },
    } as unknown as Parameters<typeof svc.notifySessionError>[0]

    await svc.notifySessionError(fakeClient, "sess-err", "crashed")

    expect(channel.sentEvents.some(e => e.kind === "session.error")).toBe(true)
    const errEvent = channel.sentEvents.find(e => e.kind === "session.error")
    expect(errEvent?.payload.error).toBe("crashed")
  })

  test("sends one deduplicated push notification when the agent fails", async () => {
    const push = makePush({ enabled: true, subscriptionCount: 1 })
    const deps = makeDeps({ push })
    const svc = createNotificationService(deps)
    const fakeClient = {
      session: { get: async () => ({ data: { title: "Broken Session" } }) },
    } as unknown as Parameters<typeof svc.notifySessionError>[0]

    await svc.notifySessionError(fakeClient, "sess-push-error", "private failure detail")
    await svc.notifySessionError(fakeClient, "sess-push-error", "private failure detail")
    await svc.flush()

    expect(push.broadcasts).toHaveLength(1)
    expect(push.broadcasts[0]).toMatchObject({
      title: "Agent error",
      body: "Broken Session",
      data: { kind: "session", sessionID: "sess-push-error" },
    })
    expect(JSON.stringify(push.broadcasts[0])).not.toContain("private failure detail")

    await svc.notifySessionError(fakeClient, "sess-push-error", "a different failure")
    await svc.flush()
    expect(push.broadcasts).toHaveLength(2)
  })

  test("telegram.send_failed is audited when session lookup throws in notifySessionIdle", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeDeps({ audit: makeAudit(auditEntries) })
    const svc = createNotificationService(deps)

    const fakeClient = {
      session: {
        get: async () => { throw new Error("network failure") },
      },
    } as unknown as Parameters<typeof svc.notifySessionIdle>[0]

    // Should not throw — failure is audited
    await expect(svc.notifySessionIdle(fakeClient, "sess-throw")).resolves.toBeUndefined()

    const entry = auditEntries.find(e => e.action === "telegram.send_failed")
    expect(entry).toBeDefined()
    expect(entry?.details.kind).toBe("session_idle")
  })

  test("telegram.send_failed is audited when session lookup throws in notifySessionError", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeDeps({ audit: makeAudit(auditEntries) })
    const svc = createNotificationService(deps)

    const fakeClient = {
      session: {
        get: async () => { throw new Error("timeout") },
      },
    } as unknown as Parameters<typeof svc.notifySessionError>[0]

    await expect(svc.notifySessionError(fakeClient, "sess-err", "crash")).resolves.toBeUndefined()

    const entry = auditEntries.find(e => e.action === "telegram.send_failed")
    expect(entry).toBeDefined()
    expect(entry?.details.kind).toBe("session_error")
  })
})

// ─── telegram fire-and-forget on permission pending ──────────────────────────

describe("notifyPermissionPending — telegram called fire-and-forget", () => {
  test("telegram.sendPermissionRequest is called even when telegram disabled", async () => {
    // The code ALWAYS calls telegram.sendPermissionRequest (fire-and-forget .catch)
    // regardless of telegram.enabled(). Only the RETURN VALUE of notifyPermissionPending
    // accounts for telegram.enabled(). This tests actual behavior.
    const telegram = makeTelegram({ enabled: false })
    const deps = makeDeps({ telegram })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-tg", "title", "sess", "execute")

    // Fire-and-forget — give micro-tasks a tick to settle
    await new Promise<void>(r => setTimeout(r, 10))

    const called = telegram.calls.find(c => c.method === "sendPermissionRequest")
    expect(called).toBeDefined()
  })

  test("push.broadcast is called when push.isEnabled() is true", async () => {
    const push = makePush({ enabled: true, subscriptionCount: 0 })
    const deps = makeDeps({ push })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-push", "Allow write", "sess", "write")

    await new Promise<void>(r => setTimeout(r, 10))

    expect(push.broadcasts.length).toBeGreaterThan(0)
  })

  test("push.broadcast is NOT called when push.isEnabled() is false", async () => {
    const push = makePush({ enabled: false })
    const deps = makeDeps({ push })
    const svc = createNotificationService(deps)

    await svc.notifyPermissionPending("perm-no-push", "title", "sess", "execute")

    await new Promise<void>(r => setTimeout(r, 10))

    expect(push.broadcasts).toHaveLength(0)
  })
})
