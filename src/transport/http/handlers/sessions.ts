import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import {
  validateCreateSession,
  validateUpdateSession,
  validatePromptBody,
} from "../validators/sessions"
import { extractDirectory } from "./system"

export async function listSessions({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.list({ query: { ...dirParam } })
  const statuses = await deps.client.session.status({ query: { ...dirParam } })
  return json(
    { sessions: result.data ?? [], statuses: statuses.data ?? {} },
    200,
    CORS_HEADERS,
  )
}

export async function createSession({ req, url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

  // Body is optional for POST /sessions (no-title session). Tolerate:
  // - no body
  // - empty body (Content-Length: 0) even when Content-Type is application/json
  // - empty string
  // - valid JSON object
  let rawBody: unknown = {}
  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const raw = await req.text()
    if (raw.trim().length > 0) {
      try {
        rawBody = JSON.parse(raw)
      } catch {
        return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
      }
    }
  }

  const validation = validateCreateSession(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", { endpoint: "POST /sessions", reason: validation.error })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  const result = await deps.client.session.create({ query: { ...dirParam } })
  deps.audit.log("session.created", { sessionID: result.data?.id ?? null })
  return json(result.data ?? null, result.error ? 500 : 201, CORS_HEADERS)
}

export async function getSession({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.get({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? null, result.error ? 404 : 200, CORS_HEADERS)
}

export async function updateSession({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validateUpdateSession(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "PATCH /sessions/:id",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  const title = validation.data.title.trim()
  try {
    const result = await deps.client.session.update({
      path: { id: params.id },
      query: { ...dirParam },
      body: { title },
    })
    deps.audit.log("session.updated", { sessionID: params.id, title })
    return json(result.data ?? { ok: true }, result.error ? 500 : 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: session.update", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function deleteSession({
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

  const sessionID = params.id

  try {
    const result = await deps.client.session.delete({
      path: { id: sessionID },
      query: { ...dirParam },
    })
    if (result.error) {
      // Inspect error shape for a 404 from the SDK; fall back to 500 otherwise.
      const errMsg =
        typeof result.error === "object" && result.error !== null && "message" in result.error
          ? String((result.error as { message?: unknown }).message ?? "")
          : String(result.error)
      if (/404|not.*found/i.test(errMsg)) {
        deps.audit.log("session.delete.notfound", { sessionID })
        return jsonError("NOT_FOUND", "Session not found", 404, CORS_HEADERS)
      }
      deps.logger.error("SDK call failed: session.delete", {
        sessionID,
        error: errMsg,
      })
      return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
    }

    deps.audit.log("session.deleted", {
      sessionID,
      ...("directory" in dirParam ? { directory: (dirParam as { directory: string }).directory } : {}),
    })
    return json({ ok: true, id: sessionID }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Graceful 404 when the SDK throws on missing session
    if (/404|not.*found/i.test(message)) {
      deps.audit.log("session.delete.notfound", { sessionID })
      return jsonError("NOT_FOUND", "Session not found", 404, CORS_HEADERS)
    }
    deps.logger.error("SDK call failed: session.delete", {
      sessionID,
      error: message,
    })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function getSessionMessages({
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.messages({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function getSessionDiff({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.diff({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

/**
 * List child (subagent) sessions for a given parent session.
 * Maps to the SDK's session.children endpoint.
 */
export async function getSessionChildren({
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.children({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function postSessionPrompt({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validatePromptBody(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "POST /sessions/:id/prompt",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  const body = validation.data
  const sessionID = params.id
  deps.audit.log("prompt.sent", {
    sessionID,
    messagePreview: body.message?.slice(0, 100) ?? "(parts)",
  })

  const promptBody: {
    parts: Array<{ type: "text"; text: string }>
    model?: { providerID: string; modelID: string }
    agent?: string
  } = {
    parts: (body.parts as Array<{ type: "text"; text: string }>) ?? [
      { type: "text", text: body.message! },
    ],
  }

  if (body.model) promptBody.model = body.model
  if (body.agent) promptBody.agent = body.agent

  const result = await deps.client.session.prompt({
    path: { id: sessionID },
    query: { ...dirParam },
    body: promptBody,
  })
  return json(result.data ?? null, result.error ? 500 : 200, CORS_HEADERS)
}

export async function abortSession({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  deps.audit.log("session.aborted", { sessionID: params.id })
  const result = await deps.client.session.abort({ path: { id: params.id }, query: { ...dirParam } })
  return json({ ok: true }, result.error ? 500 : 200, CORS_HEADERS)
}
