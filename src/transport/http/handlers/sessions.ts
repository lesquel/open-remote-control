import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import {
  validateCreateSession,
  validateUpdateSession,
  validatePromptBody,
} from "../validators/sessions"
import { extractDirectory } from "./system"
import { validateToken, safeEqual } from "../middlewares/auth"
import {
  createSafeHttpsFetcher,
  type SafeHttpsFetcher,
} from "../../../infra/network/safe-https-fetch"
import { ATTACHMENT_MAX_BYTES, MIME_SAFELIST } from "../../../infra/http/constants"
import type { FilePart } from "@opencode-ai/sdk"
import { fileURLToPath } from "node:url"
import { isAbsolute } from "node:path"
import { resolveContainedFile } from "../../../infra/fs/contained-file"

// ─── Shared SDK error inspector ───────────────────────────────────────────────

/**
 * Extract a human-readable message from an SDK error value.
 * Mirrors the exact pattern used in deleteSession (the established in-repo reference).
 */
function sdkErrorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : String(error)
}

export async function listSessions({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.list({ query: { ...dirParam } })
  if (result.error) {
    const errMsg = sdkErrorMessage(result.error)
    deps.logger.error("SDK call failed: session.list", { error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
  const statuses = await deps.client.session.status({ query: { ...dirParam } })
  if (statuses.error) {
    const errMsg = sdkErrorMessage(statuses.error)
    deps.logger.error("SDK call failed: session.status", { error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
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
  if (result.error) {
    const errMsg = sdkErrorMessage(result.error)
    if (/404|not.*found/i.test(errMsg)) {
      return jsonError("NOT_FOUND", "Session not found", 404, CORS_HEADERS)
    }
    deps.logger.error("SDK call failed: session.messages", { sessionID: params.id, error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function getSessionDiff({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  const result = await deps.client.session.diff({ path: { id: params.id }, query: { ...dirParam } })
  if (result.error) {
    const errMsg = sdkErrorMessage(result.error)
    if (/404|not.*found/i.test(errMsg)) {
      return jsonError("NOT_FOUND", "Session not found", 404, CORS_HEADERS)
    }
    deps.logger.error("SDK call failed: session.diff", { sessionID: params.id, error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
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
  if (result.error) {
    const errMsg = sdkErrorMessage(result.error)
    if (/404|not.*found/i.test(errMsg)) {
      return jsonError("NOT_FOUND", "Session not found", 404, CORS_HEADERS)
    }
    deps.logger.error("SDK call failed: session.children", { sessionID: params.id, error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
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
    inputMode: body.message !== undefined ? "message" : "parts",
    contentLength: body.message?.length ?? 0,
    partCount: body.parts?.length ?? 0,
    agentSelected: body.agent !== undefined,
    modelSelected: body.model !== undefined,
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

// ─── Attachment proxy ────────────────────────────────────────────────────────

type StructuredError = { ok: false; error: string; detail: string; httpStatus: number }
type Bytes = { ok: true; body: Uint8Array }
const safeHttpsFetch = createSafeHttpsFetcher()

/**
 * Dispatch a FilePart URL to the appropriate byte-fetching strategy.
 * Handles three schemes: http(s), file, and opencode.
 * Returns a typed result — never throws.
 */
async function fetchAttachmentBytes(
  part: FilePart,
  deps: RouteContext["deps"],
  root: string,
): Promise<Bytes | StructuredError> {
  const url = part.url

  if (url.startsWith("https://") || url.startsWith("http://")) {
    return fetchHttp(url, deps)
  }

  if (url.startsWith("file://")) {
    try {
      return readLocalFile(fileURLToPath(url), root)
    } catch {
      return { ok: false, error: "FORBIDDEN", detail: "invalid local attachment url", httpStatus: 403 }
    }
  }

  // Bare absolute path (Unix or Windows)
  if (isAbsolute(url) || /^[A-Z]:\\/i.test(url)) {
    return readLocalFile(url, root)
  }

  if (url.startsWith("opencode://")) {
    return resolveViaSdk(part, deps)
  }

  return {
    ok: false,
    error: "UNSUPPORTED_SCHEME",
    detail: `url scheme not recognized: ${url.slice(0, 48)}`,
    httpStatus: 502,
  }
}

async function fetchHttp(
  url: string,
  deps: RouteContext["deps"],
): Promise<Bytes | StructuredError> {
  return fetchRemoteAttachment(url, deps.config.fetchTimeoutMs ?? 10_000)
}

export async function fetchRemoteAttachment(
  url: string,
  timeoutMs: number,
  fetchSafe: SafeHttpsFetcher = safeHttpsFetch,
): Promise<Bytes | StructuredError> {
  const result = await fetchSafe(url, { timeoutMs, maxBytes: ATTACHMENT_MAX_BYTES })
  if (result.ok) {
    if (result.status === 404) {
      return { ok: false, error: "ATTACHMENT_URL_NOT_FOUND", detail: "remote attachment not found", httpStatus: 404 }
    }
    if (result.status < 200 || result.status >= 300) {
      return { ok: false, error: "REMOTE_ERROR", detail: `remote returned ${result.status}`, httpStatus: 502 }
    }
    return { ok: true, body: result.body }
  }

  if (result.reason === "forbidden") {
    return { ok: false, error: "FORBIDDEN", detail: "attachment URL blocked by SSRF guard", httpStatus: 403 }
  }
  if (result.reason === "timeout") {
    return { ok: false, error: "TIMEOUT", detail: "remote fetch timed out", httpStatus: 504 }
  }
  if (result.reason === "too-large") {
    return { ok: false, error: "PAYLOAD_TOO_LARGE", detail: "attachment exceeds 2 MiB limit", httpStatus: 413 }
  }
  return { ok: false, error: "FETCH_ERROR", detail: "remote attachment fetch failed", httpStatus: 502 }
}

async function readLocalFile(path: string, root: string): Promise<Bytes | StructuredError> {
  const contained = resolveContainedFile(root, path)
  if (!contained.ok) {
    const missing = contained.reason === "not-found"
    return {
      ok: false,
      error: missing ? "ATTACHMENT_NOT_FOUND" : "FORBIDDEN",
      detail: missing ? "local file not found" : "local attachment escaped project boundary",
      httpStatus: missing ? 404 : 403,
    }
  }
  try {
    const file = Bun.file(contained.path)
    const size = file.size
    if (size > ATTACHMENT_MAX_BYTES) {
      return { ok: false, error: "PAYLOAD_TOO_LARGE", detail: "attachment exceeds 2 MiB limit", httpStatus: 413 }
    }
    const buffer = await file.arrayBuffer()
    return { ok: true, body: new Uint8Array(buffer) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/enoent|not found|no such/i.test(message)) {
      return { ok: false, error: "ATTACHMENT_NOT_FOUND", detail: "local file not found", httpStatus: 404 }
    }
    return { ok: false, error: "FILE_READ_ERROR", detail: message, httpStatus: 500 }
  }
}

async function resolveViaSdk(
  part: FilePart,
  deps: RouteContext["deps"],
): Promise<Bytes | StructuredError> {
  // Attempt to read via the SDK's file.read endpoint if the client supports it.
  // The opencode:// scheme is opaque — we try the SDK as a best-effort proxy.
  try {
    const result = await (deps.client as unknown as {
      file?: { read?: (opts: { path: string }) => Promise<{ data?: { content?: string } }> }
    }).file?.read?.({ path: part.url })
    const content = result?.data?.content
    if (typeof content === "string") {
      const bytes = new TextEncoder().encode(content)
      if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
        return { ok: false, error: "PAYLOAD_TOO_LARGE", detail: "attachment exceeds 2 MiB limit", httpStatus: 413 }
      }
      return { ok: true, body: bytes }
    }
    return { ok: false, error: "SDK_NO_CONTENT", detail: "SDK file.read returned no content for opencode:// url", httpStatus: 502 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: "SDK_ERROR", detail: message, httpStatus: 502 }
  }
}

/**
 * GET /sessions/:id/attachments/:partId?messageId=<id>&directory=<d>&token=<t>
 *
 * Auth: Bearer header OR ?token= query param (same pattern as /events).
 * Proxies the attachment bytes back to the browser with safe headers.
 * Enforces MIME safelist, 2 MiB size cap, and path-traversal rejection.
 */
export async function getSessionAttachment({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  // Auth: Bearer header OR ?token= query param (mirrors /events pattern)
  const queryToken = url.searchParams.get("token")
  const headerValid = validateToken(req, deps.token)
  // Timing-safe compare for ?token= path — mirrors the Bearer path in validateToken
  const queryValid = queryToken !== null && safeEqual(queryToken, deps.token)
  if (!headerValid && !queryValid) {
    deps.audit.log("auth.failed", { path: "/sessions/:id/attachments/:partId" })
    return jsonError("UNAUTHORIZED", "Missing or invalid authorization token", 401, CORS_HEADERS)
  }

  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path.", 400, CORS_HEADERS)

  const sessionID = params.id
  const partId = params.partId

  // messageId is required — the dashboard knows which message it's rendering
  const messageId = url.searchParams.get("messageId")
  if (!messageId) {
    return jsonError("MISSING_MESSAGE_ID", "messageId query param is required", 400, CORS_HEADERS)
  }

  // Look up the specific message by ID using the SDK's direct endpoint
  let filePart: FilePart | null = null
  try {
    const result = await deps.client.session.message({
      path: { id: sessionID, messageID: messageId },
      query: { ...dirParam },
    })
    if (result.error) {
      const errMsg =
        typeof result.error === "object" && result.error !== null && "message" in result.error
          ? String((result.error as { message?: unknown }).message ?? "")
          : String(result.error)
      if (/404|not.*found/i.test(errMsg)) {
        return jsonError("SESSION_NOT_FOUND", "Session or message not found", 404, CORS_HEADERS)
      }
      return jsonError("SDK_ERROR", "Failed to fetch message", 500, CORS_HEADERS)
    }
    const parts = result.data?.parts ?? []
    for (const p of parts) {
      if (p.type === "file" && p.id === partId) {
        filePart = p as FilePart
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/404|not.*found/i.test(message)) {
      return jsonError("SESSION_NOT_FOUND", "Session or message not found", 404, CORS_HEADERS)
    }
    deps.logger.error("SDK call failed: session.message", { sessionID, messageId, error: message })
    return jsonError("SDK_ERROR", "Failed to fetch message from SDK", 500, CORS_HEADERS)
  }

  if (filePart === null) {
    return jsonError("ATTACHMENT_NOT_FOUND", "Part not found or is not a file part", 404, CORS_HEADERS)
  }

  // MIME safelist check
  const mimeList: ReadonlyArray<string> = MIME_SAFELIST
  if (!mimeList.includes(filePart.mime)) {
    return jsonError(
      "UNSUPPORTED_MIME",
      `MIME type ${filePart.mime} is not in the attachment safelist`,
      415,
      CORS_HEADERS,
    )
  }

  // Fetch bytes via scheme-dispatched proxy
  const attachmentRoot = "directory" in dirParam ? dirParam.directory : deps.directory
  const result = await fetchAttachmentBytes(filePart, deps, attachmentRoot)
  if (!result.ok) {
    deps.logger.error("attachment fetch failed", {
      sessionID,
      partId,
      error: result.error,
      detail: result.detail,
    })
    return jsonError(result.error, result.detail, result.httpStatus, CORS_HEADERS)
  }

  deps.audit.log("attachment.served", { sessionID, partId, mime: filePart.mime })

  return new Response(result.body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": filePart.mime,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    },
  })
}
