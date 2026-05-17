// Tests for createToolHooks — tool.started / tool.completed event emission
// Covers: pilot.tool.started, pilot.tool.completed, pilot.subagent.spawned for
// Task-like tools, non-Task tools, and the known TODO about child sessionID.
import { describe, expect, test } from "bun:test"
import { createToolHooks } from "./tool"
import type { NotificationService } from "../../../core/types/notification-service"
import type { PilotEvent } from "../../../core/events/types"

// ─── Fake NotificationService ─────────────────────────────────────────────────

function makeNotifications(): NotificationService & { pilotEvents: PilotEvent[] } {
  const pilotEvents: PilotEvent[] = []
  return {
    pilotEvents,
    emit() {},
    emitPilot(event) {
      pilotEvents.push(event)
    },
    async notifyPermissionPending() { return false },
    async notifySessionIdle() {},
    async notifySessionError() {},
    async flush() {},
  }
}

// ─── pilot.tool.started ───────────────────────────────────────────────────────

describe("handleToolBefore — pilot.tool.started", () => {
  test("emits pilot.tool.started with tool, sessionID, callID", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore({ tool: "bash", sessionID: "sess-1", callID: "call-1" })

    const started = notifications.pilotEvents.find(e => e.type === "pilot.tool.started")
    expect(started).toBeDefined()
    expect(started?.properties).toMatchObject({
      tool: "bash",
      sessionID: "sess-1",
      callID: "call-1",
    })
  })

  test("emits pilot.tool.started even when output is undefined", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore({ tool: "edit", sessionID: "sess-2", callID: "call-2" }, undefined)

    const started = notifications.pilotEvents.find(e => e.type === "pilot.tool.started")
    expect(started).toBeDefined()
  })
})

// ─── pilot.tool.completed ─────────────────────────────────────────────────────

describe("handleToolAfter — pilot.tool.completed", () => {
  test("emits pilot.tool.completed with tool, sessionID, callID, title, ok:true", async () => {
    const notifications = makeNotifications()
    const { handleToolAfter } = createToolHooks(notifications)

    await handleToolAfter(
      { tool: "bash", sessionID: "sess-1", callID: "call-1" },
      { title: "Ran bash command" },
    )

    const completed = notifications.pilotEvents.find(e => e.type === "pilot.tool.completed")
    expect(completed).toBeDefined()
    expect(completed?.properties).toMatchObject({
      tool: "bash",
      sessionID: "sess-1",
      callID: "call-1",
      title: "Ran bash command",
      ok: true,
    })
  })

  test("ok is always true (tools reaching after-hook ran to completion)", async () => {
    const notifications = makeNotifications()
    const { handleToolAfter } = createToolHooks(notifications)

    await handleToolAfter(
      { tool: "read_file", sessionID: "s", callID: "c" },
      { title: "Read file" },
    )

    const completed = notifications.pilotEvents.find(e => e.type === "pilot.tool.completed")
    expect((completed?.properties as Record<string, unknown>).ok).toBe(true)
  })
})

// ─── isTaskTool — pilot.subagent.spawned ─────────────────────────────────────

describe("handleToolBefore — pilot.subagent.spawned for Task-like tools", () => {
  const taskVariants = ["task", "Task", "TASK", "task.execute", "task:run", "task.spawn"]

  for (const toolName of taskVariants) {
    test(`emits pilot.subagent.spawned for tool="${toolName}"`, async () => {
      const notifications = makeNotifications()
      const { handleToolBefore } = createToolHooks(notifications)

      await handleToolBefore(
        { tool: toolName, sessionID: "sess-task", callID: "call-task" },
        { args: { description: "Do something useful" } },
      )

      const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
      expect(spawned).toBeDefined()
      expect(spawned?.properties).toMatchObject({
        sessionID: "sess-task",
        callID: "call-task",
        tool: toolName,
      })
    })
  }

  test("pilot.subagent.spawned includes description from args.description", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore(
      { tool: "task", sessionID: "s", callID: "c" },
      { args: { description: "Run integration tests" } },
    )

    const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
    expect((spawned?.properties as Record<string, unknown>).description).toBe("Run integration tests")
  })

  test("pilot.subagent.spawned falls back to args.prompt (truncated to 120) when description absent", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    const longPrompt = "x".repeat(200)
    await handleToolBefore(
      { tool: "task", sessionID: "s", callID: "c" },
      { args: { prompt: longPrompt } },
    )

    const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
    const description = (spawned?.properties as Record<string, unknown>).description
    expect(typeof description).toBe("string")
    expect((description as string).length).toBeLessThanOrEqual(120)
  })

  test("pilot.subagent.spawned description is undefined when neither description nor prompt", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore(
      { tool: "task", sessionID: "s", callID: "c" },
      { args: {} },
    )

    const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
    expect((spawned?.properties as Record<string, unknown>).description).toBeUndefined()
  })
})

// ─── Non-Task tools do NOT emit pilot.subagent.spawned ───────────────────────

describe("handleToolBefore — non-Task tools do NOT spawn", () => {
  const nonTaskTools = ["bash", "edit", "read", "write", "glob", "grep", "computer"]

  for (const toolName of nonTaskTools) {
    test(`no pilot.subagent.spawned for tool="${toolName}"`, async () => {
      const notifications = makeNotifications()
      const { handleToolBefore } = createToolHooks(notifications)

      await handleToolBefore(
        { tool: toolName, sessionID: "s", callID: "c" },
        { args: {} },
      )

      const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
      expect(spawned).toBeUndefined()
    })
  }
})

// ─── TODO characterization: child sessionID is not exposed ────────────────────

describe("CHARACTERIZATION: child sessionID not exposed in subagent.spawned", () => {
  test("pilot.subagent.spawned properties do NOT include a childSessionID field", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore(
      { tool: "task", sessionID: "parent-sess", callID: "call-x" },
      { args: { description: "child work" } },
    )

    const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
    expect(spawned).toBeDefined()
    // The TODO in tool.ts notes the child sessionID is not exposed by the plugin hook.
    // Assert current (intentionally limited) behavior:
    expect("childSessionID" in (spawned?.properties ?? {})).toBe(false)
    // Only the parent sessionID is present
    expect((spawned?.properties as Record<string, unknown>).sessionID).toBe("parent-sess")
  })
})

// ─── Both events emitted together for Task tool ───────────────────────────────

describe("handleToolBefore — Task tool emits both tool.started and subagent.spawned", () => {
  test("emits pilot.tool.started AND pilot.subagent.spawned for task tool", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    await handleToolBefore(
      { tool: "task", sessionID: "s", callID: "c" },
      { args: { description: "parallel work" } },
    )

    const types = notifications.pilotEvents.map(e => e.type)
    expect(types).toContain("pilot.tool.started")
    expect(types).toContain("pilot.subagent.spawned")
  })
})

// ─── args source: output.args only (not input fields) ────────────────────────

describe("handleToolBefore — description only comes from output.args, not input fields", () => {
  test("when output is undefined, description is undefined even for task tool", async () => {
    const notifications = makeNotifications()
    const { handleToolBefore } = createToolHooks(notifications)

    // Pass no output (undefined) — the hook reads output?.args ?? {}, so args = {}
    await handleToolBefore(
      { tool: "task", sessionID: "s", callID: "c" },
    )

    const spawned = notifications.pilotEvents.find(e => e.type === "pilot.subagent.spawned")
    // Since output is undefined, args = output?.args ?? {} = {}, so description = undefined.
    // This characterizes that description comes ONLY from output.args, not from input itself.
    expect((spawned?.properties as Record<string, unknown>).description).toBeUndefined()
  })
})
