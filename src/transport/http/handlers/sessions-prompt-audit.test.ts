import { describe, expect, test } from "bun:test"
import type { RouteContext, RouteDeps } from "../routes"
import { postSessionPrompt } from "./sessions"

describe("postSessionPrompt audit privacy", () => {
  test("records prompt metadata without persisting prompt content", async () => {
    const secretPrompt = "deploy with token sk-secret-value"
    const entries: Array<{ action: string; details: Record<string, unknown> }> = []
    const deps = {
      client: {
        session: {
          prompt: async () => ({ data: { ok: true }, error: null }),
        },
      },
      audit: {
        log: (action: string, details: Record<string, unknown>) => entries.push({ action, details }),
      },
    } as unknown as RouteDeps
    const url = new URL("http://localhost/sessions/session-1/prompt")
    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: secretPrompt }),
    })
    const context = {
      req,
      url,
      params: { id: "session-1" },
      deps,
    } as RouteContext

    const response = await postSessionPrompt(context)
    const promptEntry = entries.find((entry) => entry.action === "prompt.sent")

    expect(response.status).toBe(200)
    expect(promptEntry?.details).toEqual({
      sessionID: "session-1",
      inputMode: "message",
      contentLength: secretPrompt.length,
      partCount: 0,
      agentSelected: false,
      modelSelected: false,
    })
    expect(JSON.stringify(entries)).not.toContain(secretPrompt)
    expect(JSON.stringify(entries)).not.toContain("sk-secret-value")
  })
})
