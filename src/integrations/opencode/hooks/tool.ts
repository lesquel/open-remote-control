import type { NotificationService } from "../../../notifications/pipeline"

interface ToolBeforeInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolBeforeOutput {
  args: Record<string, unknown>
}

interface ToolAfterInput {
  tool: string
  sessionID: string
  callID: string
  args?: Record<string, unknown>
}

interface ToolAfterOutput {
  title: string
}

/**
 * True if a tool name looks like the Task / subagent-spawning tool.
 * The SDK has used "task", "Task", and "task.execute" across versions,
 * so we normalize and match loosely.
 */
function isTaskTool(tool: string): boolean {
  const lower = tool.toLowerCase()
  return lower === "task" || lower.startsWith("task.") || lower.startsWith("task:")
}

/**
 * Emits pilot.tool.started / pilot.tool.completed events to the SSE bus.
 * Additionally, when the tool is a Task (subagent spawn), emits
 * pilot.subagent.spawned so the dashboard can refresh its subagents panel.
 *
 * TODO: the plugin-level tool hook does not expose the child sessionID
 * created by the Task tool. The dashboard therefore polls
 * GET /sessions/:id/children after receiving this event to discover the
 * actual parent/child relationship.
 */
export function createToolHooks(notifications: NotificationService) {
  async function handleToolBefore(
    input: ToolBeforeInput,
    output?: ToolBeforeOutput,
  ): Promise<void> {
    notifications.emitPilot({
      type: "pilot.tool.started",
      properties: {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
      },
    })

    if (isTaskTool(input.tool)) {
      const args = output?.args ?? {}
      const description =
        typeof args.description === "string"
          ? args.description
          : typeof args.prompt === "string"
            ? args.prompt.slice(0, 120)
            : undefined

      notifications.emitPilot({
        type: "pilot.subagent.spawned",
        properties: {
          sessionID: input.sessionID,
          callID: input.callID,
          tool: input.tool,
          description,
        },
      })
    }
  }

  async function handleToolAfter(
    input: ToolAfterInput,
    output: ToolAfterOutput,
  ): Promise<void> {
    notifications.emitPilot({
      type: "pilot.tool.completed",
      properties: {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        title: output.title,
        // OpenCode tool hooks don't have an explicit success flag — reaching
        // handleToolAfter means the tool ran to completion (ok: true).
        ok: true,
      },
    })
  }

  return { handleToolBefore, handleToolAfter }
}
