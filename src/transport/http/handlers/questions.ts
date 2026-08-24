import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { extractDirectory } from "./system"

const MAX_QUESTIONS = 20
const MAX_ANSWERS_PER_QUESTION = 20
const MAX_ANSWER_LENGTH = 10_000

function directoryFrom(ctx: RouteContext): string | undefined | Response {
  const extracted = extractDirectory(ctx.url)
  if (extracted === null) return jsonError("INVALID_DIRECTORY", "Invalid directory", 400, CORS_HEADERS)
  return "directory" in extracted ? extracted.directory : undefined
}

function unavailable(ctx: RouteContext): Response | null {
  return ctx.deps.attentionService
    ? null
    : jsonError("UNSUPPORTED", "This OpenCode version does not expose interactive questions", 501, CORS_HEADERS)
}

function validAnswers(value: unknown): value is string[][] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= MAX_QUESTIONS
    && value.every((answer) => Array.isArray(answer)
      && answer.length <= MAX_ANSWERS_PER_QUESTION
      && answer.every((item) => typeof item === "string" && item.length > 0 && item.length <= MAX_ANSWER_LENGTH))
}

export async function listQuestions(ctx: RouteContext): Promise<Response> {
  const unsupported = unavailable(ctx)
  if (unsupported) return unsupported
  const directory = directoryFrom(ctx)
  if (directory instanceof Response) return directory
  try {
    const questions = await ctx.deps.attentionService?.listQuestions(directory)
    return json(questions ?? [], 200, CORS_HEADERS)
  } catch (error) {
    ctx.deps.logger.error("Could not list OpenCode questions", {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError("SDK_ERROR", "Could not list OpenCode questions", 502, CORS_HEADERS)
  }
}

export async function replyQuestion(ctx: RouteContext): Promise<Response> {
  const unsupported = unavailable(ctx)
  if (unsupported) return unsupported
  let body: { answers?: unknown }
  try {
    body = await ctx.req.json() as { answers?: unknown }
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }
  if (!validAnswers(body.answers)) {
    return jsonError("INVALID_ANSWERS", "answers must be an ordered array of non-empty string arrays", 400, CORS_HEADERS)
  }
  const directory = directoryFrom(ctx)
  if (directory instanceof Response) return directory
  try {
    await ctx.deps.attentionService?.replyQuestion(ctx.params.id, body.answers, directory)
    ctx.deps.audit.log("question.responded", { requestID: ctx.params.id })
    return json({ ok: true }, 200, CORS_HEADERS)
  } catch (error) {
    ctx.deps.logger.error("Could not answer OpenCode question", {
      requestID: ctx.params.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError("SDK_ERROR", "Could not answer OpenCode question", 502, CORS_HEADERS)
  }
}

export async function rejectQuestion(ctx: RouteContext): Promise<Response> {
  const unsupported = unavailable(ctx)
  if (unsupported) return unsupported
  const directory = directoryFrom(ctx)
  if (directory instanceof Response) return directory
  try {
    await ctx.deps.attentionService?.rejectQuestion(ctx.params.id, directory)
    ctx.deps.audit.log("question.rejected", { requestID: ctx.params.id })
    return json({ ok: true }, 200, CORS_HEADERS)
  } catch (error) {
    ctx.deps.logger.error("Could not reject OpenCode question", {
      requestID: ctx.params.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError("SDK_ERROR", "Could not reject OpenCode question", 502, CORS_HEADERS)
  }
}
