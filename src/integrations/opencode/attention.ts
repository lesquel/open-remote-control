import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { AgentAttentionService } from "../../core"

type AttentionClient = Pick<OpencodeClient, "permission" | "question">

function failure(operation: string, error: unknown): Error {
  let detail = "unknown SDK error"
  if (error instanceof Error) detail = error.message
  else if (error && typeof error === "object" && "message" in error) {
    detail = String((error as { message: unknown }).message)
  } else if (error !== undefined) detail = String(error)
  return new Error(`OpenCode ${operation} failed: ${detail}`)
}

export function createOpenCodeAttentionService(client: AttentionClient): AgentAttentionService {
  return {
    async listPermissions(directory) {
      const result = await client.permission.list({ directory })
      if (result.error !== undefined) throw failure("permission.list", result.error)
      return result.data ?? []
    },

    async replyPermission(requestID, reply, directory) {
      const result = await client.permission.reply({ requestID, reply, directory })
      if (result.error !== undefined) throw failure("permission.reply", result.error)
    },

    async listQuestions(directory) {
      const result = await client.question.list({ directory })
      if (result.error !== undefined) throw failure("question.list", result.error)
      return result.data ?? []
    },

    async replyQuestion(requestID, answers, directory) {
      const result = await client.question.reply({ requestID, answers, directory })
      if (result.error !== undefined) throw failure("question.reply", result.error)
    },

    async rejectQuestion(requestID, directory) {
      const result = await client.question.reject({ requestID, directory })
      if (result.error !== undefined) throw failure("question.reject", result.error)
    },
  }
}
