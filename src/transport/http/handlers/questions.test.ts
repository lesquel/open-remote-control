import { describe, expect, test } from "bun:test"
import type { AgentAttentionService } from "../../../core/types/agent-attention"
import type { RouteContext, RouteDeps } from "../routes"
import { listQuestions, rejectQuestion, replyQuestion } from "./questions"

function context(service: AgentAttentionService, req = new Request("http://test/questions?directory=/projects/a"), id = "q1"): RouteContext {
  return {
    req,
    url: new URL(req.url),
    params: { id },
    deps: {
      attentionService: service,
      audit: { log: () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    } as unknown as RouteDeps,
  }
}

describe("OpenCode questions HTTP bridge", () => {
  test("lists pending questions for the selected project", async () => {
    const service = {
      listQuestions: async (directory?: string) => [{ id: "q1", sessionID: directory ?? "", questions: [] }],
    } as unknown as AgentAttentionService
    const response = await listQuestions(context(service))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: "q1", sessionID: "/projects/a", questions: [] }])
  })

  test("validates and forwards ordered answers", async () => {
    const calls: unknown[] = []
    const service = {
      replyQuestion: async (...args: unknown[]) => { calls.push(args) },
    } as unknown as AgentAttentionService
    const req = new Request("http://test/questions/q1?directory=/projects/a", {
      method: "POST",
      body: JSON.stringify({ answers: [["First"], ["Second", "Third"]] }),
    })
    const response = await replyQuestion(context(service, req))
    expect(response.status).toBe(200)
    expect(calls).toEqual([["q1", [["First"], ["Second", "Third"]], "/projects/a"]])
  })

  test("rejects malformed answer payloads", async () => {
    const service = {} as AgentAttentionService
    const req = new Request("http://test/questions/q1", {
      method: "POST",
      body: JSON.stringify({ answers: ["not-an-array"] }),
    })
    const response = await replyQuestion(context(service, req))
    expect(response.status).toBe(400)
  })

  test("forwards question rejection", async () => {
    const calls: unknown[] = []
    const service = {
      rejectQuestion: async (...args: unknown[]) => { calls.push(args) },
    } as unknown as AgentAttentionService
    const req = new Request("http://test/questions/q1/reject?directory=/projects/a", { method: "POST" })
    const response = await rejectQuestion(context(service, req))
    expect(response.status).toBe(200)
    expect(calls).toEqual([["q1", "/projects/a"]])
  })
})
