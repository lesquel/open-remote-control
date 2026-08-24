import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { createOpenCodeAttentionService } from "./attention"
import { createOpenCodeAttentionClient } from "./client"

type AttentionClient = Pick<OpencodeClient, "permission" | "question">

describe("OpenCode v2 attention adapter", () => {
  test("authenticates the independently-created v2 client with OpenCode Basic auth", async () => {
    const password = "test-password"
    const expectedAuthorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    const seen: Array<{ path: string; authorization: string | null }> = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        seen.push({
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
        })
        if (request.headers.get("authorization") !== expectedAuthorization) {
          return new Response("Unauthorized", { status: 401 })
        }
        return Response.json([])
      },
    })

    try {
      const client = createOpenCodeAttentionClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        password,
      })
      const service = createOpenCodeAttentionService(client)

      await expect(service.listPermissions("/projects/a")).resolves.toEqual([])
      await expect(service.listQuestions("/projects/a")).resolves.toEqual([])
      expect(seen).toEqual([
        { path: "/permission", authorization: expectedAuthorization },
        { path: "/question", authorization: expectedAuthorization },
      ])
    } finally {
      server.stop(true)
    }
  })

  test("does not send Basic auth when OpenCode server password is absent", async () => {
    let authorization: string | null = "unreached"
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        authorization = request.headers.get("authorization")
        return Response.json([])
      },
    })

    try {
      const client = createOpenCodeAttentionClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
      })
      await expect(createOpenCodeAttentionService(client).listQuestions()).resolves.toEqual([])
      expect(authorization).toBeNull()
    } finally {
      server.stop(true)
    }
  })

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
