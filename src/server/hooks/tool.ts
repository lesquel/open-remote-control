import type { NotificationService } from "../services/notifications"

interface ToolInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolOutput {
  title: string
}

/**
 * Emits pilot.tool.started / pilot.tool.completed events to the SSE bus.
 */
export function createToolHooks(notifications: NotificationService) {
  async function handleToolBefore(input: ToolInput): Promise<void> {
    notifications.emitPilot({
      type: "pilot.tool.started",
      properties: {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
      },
    })
  }

  async function handleToolAfter(input: ToolInput, output: ToolOutput): Promise<void> {
    notifications.emitPilot({
      type: "pilot.tool.completed",
      properties: {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        title: output.title,
      },
    })
  }

  return { handleToolBefore, handleToolAfter }
}
