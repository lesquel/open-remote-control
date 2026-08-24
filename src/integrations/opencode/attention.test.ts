import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { createOpenCodeAttentionService } from "./attention"

type AttentionClient = Pick<OpencodeClient, "permission" | "question">

describe("OpenCode v2 attention adapter", () => {
  test("forwards project directory when listing native permissions and questions", async () => {
    const calls: string[] = []
    const client = {
      permission: {
        list: async ({ directory }: { directory?: string }) => {
          calls.push(`permission:${directory}`)
          return { data: [{ id: "p1", sessionID: "s1", permission: "bash", patterns: ["rm x"], metadata: {}, always: [] }], error: undefined }
        },
      },
      question: {
        list: async ({ directory }: { directory?: string }) => {
          calls.push(`question:${directory}`)
          return { data: [{ id: "q1", sessionID: "s1", questions: [] }], error: undefined }
        },
      },
    } as unknown as AttentionClient

    const service = createOpenCodeAttentionService(client)
    expect(await service.listPermissions("/projects/a")).toHaveLength(1)
    expect(await service.listQuestions("/projects/a")).toHaveLength(1)
    expect(calls).toEqual(["permission:/projects/a", "question:/projects/a"])
  })

  test("maps replies to the native v2 endpoints", async () => {
    const calls: unknown[] = []
    const client = {
      permission: {
        reply: async (input: unknown) => { calls.push(input); return { data: true, error: undefined } },
      },
      question: {
        reply: async (input: unknown) => { calls.push(input); return { data: true, error: undefined } },
        reject: async (input: unknown) => { calls.push(input); return { data: true, error: undefined } },
      },
    } as unknown as AttentionClient

    const service = createOpenCodeAttentionService(client)
    await service.replyPermission("p1", "once", "/projects/a")
    await service.replyQuestion("q1", [["Yes"]], "/projects/a")
    await service.rejectQuestion("q2", "/projects/a")

    expect(calls).toEqual([
      { requestID: "p1", reply: "once", directory: "/projects/a" },
      { requestID: "q1", answers: [["Yes"]], directory: "/projects/a" },
      { requestID: "q2", directory: "/projects/a" },
    ])
  })

  test("turns SDK error fields into visible adapter failures", async () => {
    const client = {
      permission: { list: async () => ({ data: undefined, error: { message: "unsupported" } }) },
      question: { list: async () => ({ data: [], error: undefined }) },
    } as unknown as AttentionClient

    await expect(createOpenCodeAttentionService(client).listPermissions()).rejects.toThrow("permission.list")
  })
})
