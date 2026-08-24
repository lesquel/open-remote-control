// Tests for createPermissionAskHook — SECURITY-CRITICAL
// Covers: no-remote-channel path (falls through to TUI), remote-reachable path
// (blocks and waits), allow/deny resolution, timeout fallback to TUI.
import { describe, expect, test } from "bun:test"
import { createPermissionAskHook } from "./permission.ask"
import type { PermissionOutput } from "./permission.ask"
import { createPermissionQueue } from "../../../core/permissions/queue"
import type { NotificationService } from "../../../core/types/notification-service"
import type { Permission } from "@opencode-ai/sdk"

// ─── Fake NotificationService ─────────────────────────────────────────────────

function makeNotifications(notifyReturn: boolean): NotificationService & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    emit() {},
    emitPilot() {},
    async notifyPermissionPending(...args) {
      calls.push({ method: "notifyPermissionPending", args })
      return notifyReturn
    },
    async notifySessionIdle() {},
    async notifySessionError() {},
    async flush() {},
  }
}

// ─── Fake audit ───────────────────────────────────────────────────────────────

type AuditEntry = { action: string; details: Record<string, unknown> }

function makeAudit(entries: AuditEntry[] = []) {
  return {
    entries,
    log(action: string, details: Record<string, unknown>) {
      entries.push({ action, details })
    },
  }
}

// ─── Minimal Permission fixture ───────────────────────────────────────────────

function makePermission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: "perm-001",
    title: "Allow bash: rm -rf /",
    sessionID: "sess-1",
    type: "execute",
    pattern: "bash",
    metadata: {},
    ...overrides,
  } as Permission
}

// ─── No remote channel — fall through to TUI ──────────────────────────────────

describe("permission.ask — no remote channel (notifyPermissionPending returns false)", () => {
  test("output.status is NOT set — TUI handles permission", async () => {
    const notifications = makeNotifications(false)
    const queue = createPermissionQueue(5_000)
    const audit = makeAudit()
    const hook = createPermissionAskHook(notifications, queue, audit)

    const input = makePermission()
    const output: PermissionOutput = {}

    await hook(input, output)

    // No remote channel → output.status stays undefined (TUI asks)
    expect(output.status).toBeUndefined()
  })

  test("permission.noRemoteChannel is audited when no channel is reachable", async () => {
    const notifications = makeNotifications(false)
    const queue = createPermissionQueue(5_000)
    const auditEntries: AuditEntry[] = []
    const audit = makeAudit(auditEntries)
    const hook = createPermissionAskHook(notifications, queue, audit)

    const input = makePermission()
    await hook(input, {})

    const entry = auditEntries.find(e => e.action === "permission.noRemoteChannel")
    expect(entry).toBeDefined()
    expect(entry?.details.permissionID).toBe("perm-001")
  })

  test("queue.waitForResponse is NOT called when no channel is reachable", async () => {
    const notifications = makeNotifications(false)
    let waitCalled = false
    const queue = {
      waitForResponse: async () => { waitCalled = true; return null },
      resolve: () => false,
      pending: () => [],
    }
    const hook = createPermissionAskHook(notifications, queue, makeAudit())

    await hook(makePermission(), {})

    expect(waitCalled).toBe(false)
  })
})

// ─── Remote channel reachable — allow ─────────────────────────────────────────

describe("permission.ask — remote channel reachable, result: allow", () => {
  test("output.status is set to 'allow' when remote resolves allow", async () => {
    const notifications = makeNotifications(true)
    const queue = createPermissionQueue(5_000)
    const hook = createPermissionAskHook(notifications, queue, makeAudit())

    const input = makePermission({ id: "perm-allow" })
    const output: PermissionOutput = {}

    // Resolve in background once the waiter is registered
    const resolver = (async () => {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        const pending = queue.pending()
        if (pending.length > 0) {
          queue.resolve("perm-allow", "allow")
          return
        }
        await new Promise<void>(r => setTimeout(r, 0))
      }
      throw new Error("resolver: queue never populated")
    })()

    await hook(input, output)
    await resolver

    expect(output.status).toBe("allow")
  })

  test("permission.resolved is audited with action:allow and source:remote", async () => {
    const notifications = makeNotifications(true)
    const queue = createPermissionQueue(5_000)
    const auditEntries: AuditEntry[] = []
    const hook = createPermissionAskHook(notifications, queue, makeAudit(auditEntries))

    const input = makePermission({ id: "perm-allow-audit" })
    const output: PermissionOutput = {}

    const resolver = (async () => {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        if (queue.pending().length > 0) { queue.resolve("perm-allow-audit", "allow"); return }
        await new Promise<void>(r => setTimeout(r, 0))
      }
      throw new Error("resolver: timed out")
    })()

    await hook(input, output)
    await resolver

    const entry = auditEntries.find(e => e.action === "permission.resolved")
    expect(entry).toBeDefined()
    expect(entry?.details.action).toBe("allow")
    expect(entry?.details.source).toBe("remote")
    expect(entry?.details.permissionID).toBe("perm-allow-audit")
  })
})

// ─── Remote channel reachable — deny ──────────────────────────────────────────

describe("permission.ask — remote channel reachable, result: deny", () => {
  test("output.status is set to 'deny' when remote resolves deny", async () => {
    const notifications = makeNotifications(true)
    const queue = createPermissionQueue(5_000)
    const hook = createPermissionAskHook(notifications, queue, makeAudit())

    const input = makePermission({ id: "perm-deny" })
    const output: PermissionOutput = {}

    const resolver = (async () => {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        if (queue.pending().length > 0) { queue.resolve("perm-deny", "deny"); return }
        await new Promise<void>(r => setTimeout(r, 0))
      }
      throw new Error("resolver: timed out")
    })()

    await hook(input, output)
    await resolver

    expect(output.status).toBe("deny")
  })
})

// ─── Remote channel reachable — timeout → falls back to TUI ──────────────────

describe("permission.ask — remote channel reachable but times out", () => {
  test("output.status stays undefined (TUI fallback) on queue timeout", async () => {
    const notifications = makeNotifications(true)
    // Very short timeout so test runs fast
    const queue = createPermissionQueue(100)
    const hook = createPermissionAskHook(notifications, queue, makeAudit())

    const input = makePermission({ id: "perm-timeout" })
    const output: PermissionOutput = {}

    // Don't resolve — let it time out
    await hook(input, output)

    // waitForResponse returns null on timeout; output.status should NOT be set
    expect(output.status).toBeUndefined()
  }, 2_000)

  test("no audit entry for permission.resolved when timeout occurs", async () => {
    const notifications = makeNotifications(true)
    const queue = createPermissionQueue(100)
    const auditEntries: AuditEntry[] = []
    const hook = createPermissionAskHook(notifications, queue, makeAudit(auditEntries))

    const input = makePermission({ id: "perm-timeout-audit" })
    await hook(input, {})

    const resolved = auditEntries.find(e => e.action === "permission.resolved")
    expect(resolved).toBeUndefined()
  }, 2_000)
})

// ─── notifyPermissionPending receives correct arguments ───────────────────────

describe("permission.ask — notifyPermissionPending receives correct arguments", () => {
  test("passes permissionID, title, sessionID, type, pattern, metadata to notify", async () => {
    const notifications = makeNotifications(false) // false = no wait needed
    const queue = createPermissionQueue(5_000)
    const hook = createPermissionAskHook(notifications, queue, makeAudit())

    const input = makePermission({
      id: "perm-args",
      title: "Allow edit",
      sessionID: "sess-args",
      type: "edit",
      pattern: "**/*.ts",
      metadata: { risk: "medium" },
    })
    await hook(input, {})

    expect(notifications.calls).toHaveLength(1)
    const call = notifications.calls[0] as { method: string; args: unknown[] }
    expect(call.method).toBe("notifyPermissionPending")
    expect(call.args[0]).toBe("perm-args")
    expect(call.args[1]).toBe("Allow edit")
    expect(call.args[2]).toBe("sess-args")
    expect(call.args[3]).toBe("edit")
    expect(call.args[4]).toBe("**/*.ts")
    expect(call.args[5]).toEqual({ risk: "medium" })
  })

  test("binds a remote permission to the plugin's immutable project context", async () => {
    const notifications = makeNotifications(false)
    const hook = createPermissionAskHook(notifications, createPermissionQueue(5_000), makeAudit(), "/projects/a")

    await hook(makePermission({ id: "project-bound", sessionID: "session-a", metadata: { command: "echo safe" } }), {})

    const call = notifications.calls[0] as { args: unknown[] }
    expect(call.args[5]).toEqual({
      command: "echo safe",
      integrationID: "opencode",
      projectID: "/projects/a",
      directory: "/projects/a",
      sessionID: "session-a",
    })
  })
})
