import { readFileSync, existsSync, statSync, realpathSync } from "fs"
import { join, dirname, extname, isAbsolute } from "path"
import { fileURLToPath } from "url"
import type { RouteContext } from "./routes"
import { json, jsonError } from "./json"
import { CORS_HEADERS } from "./cors"
import { validateToken } from "./auth"
import { validateBody } from "./validation"
import { generateToken } from "../util/auth"
import { updateStateToken } from "../services/state"
import { PILOT_VERSION } from "../constants"
import type { PushSubscriptionJson } from "../services/push"
import type {
  Agent,
  LspStatus,
  McpStatus,
  Project,
} from "@opencode-ai/sdk"

// ─── Directory param helper ──────────────────────────────────────────────────

const MAX_DIRECTORY_LENGTH = 512

/**
 * Extract and validate the optional `?directory=<path>` query param.
 * Returns `{ directory }` if present and valid, or `{}` if absent.
 * Returns `null` if the value is malformed (caller should return 400).
 */
function extractDirectory(url: URL): { directory: string } | {} | null {
  const dir = url.searchParams.get("directory")
  if (!dir) return {}
  if (dir.includes("..") || dir.length > MAX_DIRECTORY_LENGTH) return null
  return { directory: dir }
}

// ─── Dashboard path ─────────────────────────────────────────────────────────
// The dashboard has been split into src/server/dashboard/.
// GET / serves dashboard/index.html.
// GET /dashboard/* serves static files from the dashboard/ directory.
// The legacy dashboard.html in src/server/ is kept as a fallback only.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = join(__dirname, "..")

/** The directory that contains the split dashboard. */
const DASHBOARD_DIR = join(SERVER_DIR, "dashboard")

/** Path to the dashboard entry point. Falls back to the legacy single file. */
const DASHBOARD_INDEX_PATH = existsSync(join(DASHBOARD_DIR, "index.html"))
  ? join(DASHBOARD_DIR, "index.html")
  : join(SERVER_DIR, "dashboard.html")

let cachedHtml: string | null = null

function getDashboardHtml(dev: boolean): string {
  if (!dev && cachedHtml !== null) return cachedHtml
  const html = readFileSync(DASHBOARD_INDEX_PATH, "utf-8")
  if (!dev) cachedHtml = html
  return html
}

/** MIME types for static dashboard assets. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function serveDashboard({ deps }: RouteContext): Promise<Response> {
  const html = getDashboardHtml(deps.config.dev)
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
  })
}

/**
 * Serve a static dashboard file given a relative path within DASHBOARD_DIR.
 */
async function serveDashboardFile(
  relativePath: string,
  pathname: string,
  deps: RouteContext["deps"],
): Promise<Response> {
  // Prevent path traversal
  if (relativePath.includes("..")) {
    return jsonError("FORBIDDEN", "Forbidden", 403, CORS_HEADERS)
  }

  const filePath = join(DASHBOARD_DIR, relativePath)

  if (!existsSync(filePath)) {
    return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
  }

  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    deps.audit.log("error", { path: pathname, error: "Failed to read file" })
    return jsonError("INTERNAL_ERROR", "Failed to read file", 500, CORS_HEADERS)
  }

  const ext = extname(filePath)
  const mime = MIME[ext] ?? "text/plain"

  return new Response(content, {
    headers: { "Content-Type": mime, ...CORS_HEADERS },
  })
}

/**
 * Serve static files from the dashboard/ directory.
 * Path: /dashboard/<file>  →  src/server/dashboard/<file>
 * This handler is registered for GET /dashboard/*.
 */
export async function serveDashboardStatic({
  url,
  deps,
}: RouteContext): Promise<Response> {
  const relativePath = url.pathname.replace(/^\/dashboard\//, "")
  return serveDashboardFile(relativePath, url.pathname, deps)
}

/**
 * Serve dashboard static files from the root path.
 * Path: /<file>  →  src/server/dashboard/<file>
 * This allows relative imports from index.html to resolve correctly
 * (e.g. ./styles.css, ./main.js, ./sw.js, ./manifest.json, ./icons/*).
 */
export async function serveDashboardRootStatic({
  url,
  deps,
}: RouteContext): Promise<Response> {
  const relativePath = url.pathname.replace(/^\//, "")
  return serveDashboardFile(relativePath, url.pathname, deps)
}

export async function getStatus({ deps }: RouteContext): Promise<Response> {
  const sessions = await deps.client.session.list()
  const statuses = await deps.client.session.status()
  return json(
    {
      pilot: { version: "0.1.0", uptime: process.uptime() },
      sessions: {
        total: sessions.data?.length ?? 0,
        statuses: statuses.data ?? {},
      },
      clients: deps.eventBus.clientCount(),
    },
    200,
    CORS_HEADERS,
  )
}

export async function listSessions({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.session.list({ query: { ...dirParam } })
  const statuses = await deps.client.session.status({ query: { ...dirParam } })
  return json(
    { sessions: result.data ?? [], statuses: statuses.data ?? {} },
    200,
    CORS_HEADERS,
  )
}

export async function createSession({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.session.create({ query: { ...dirParam } })
  deps.audit.log("session.created", { sessionID: result.data?.id ?? null })
  return json(result.data ?? null, result.error ? 500 : 201, CORS_HEADERS)
}

export async function getSession({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.session.get({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? null, result.error ? 404 : 200, CORS_HEADERS)
}

interface UpdateSessionBody {
  title?: string
}

export async function updateSession({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }

  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError("INVALID_BODY", "Request body must be a JSON object", 400, CORS_HEADERS)
  }

  const body = rawBody as UpdateSessionBody

  if (typeof body.title !== "string" || !body.title.trim()) {
    return jsonError("INVALID_TITLE", "title is required and must be a non-empty string", 400, CORS_HEADERS)
  }

  try {
    const result = await deps.client.session.update({
      path: { id: params.id },
      query: { ...dirParam },
      body: { title: body.title.trim() },
    })
    deps.audit.log("session.updated", { sessionID: params.id, title: body.title.trim() })
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
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)

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
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.session.messages({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function getSessionDiff({ url, params, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
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
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.session.children({ path: { id: params.id }, query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

interface PromptBody {
  message?: string
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>
  model?: { providerID: string; modelID: string }
  agent?: string
}

export async function postSessionPrompt({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }

  // Validate that body is an object (message or parts required — checked below)
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError("INVALID_BODY", "Request body must be a JSON object", 400, CORS_HEADERS)
  }

  const body = rawBody as PromptBody

  if (!body.message && (!body.parts || body.parts.length === 0)) {
    return jsonError("MISSING_BODY", "message or parts is required", 400, CORS_HEADERS)
  }

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
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  deps.audit.log("session.aborted", { sessionID: params.id })
  const result = await deps.client.session.abort({ path: { id: params.id }, query: { ...dirParam } })
  return json({ ok: true }, result.error ? 500 : 200, CORS_HEADERS)
}

export async function listPermissions({ deps }: RouteContext): Promise<Response> {
  return json(deps.permissionQueue.pending(), 200, CORS_HEADERS)
}

interface PermissionBody {
  action: "allow" | "deny"
}

export async function respondPermission({
  req,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const body = (await req.json()) as PermissionBody
  if (!body.action || !["allow", "deny"].includes(body.action)) {
    return jsonError(
      "INVALID_ACTION",
      "action must be 'allow' or 'deny'",
      400,
      CORS_HEADERS,
    )
  }

  deps.audit.log("permission.responded", {
    permissionID: params.id,
    action: body.action,
  })

  deps.permissionQueue.resolve(params.id, body.action)
  return json({ ok: true }, 200, CORS_HEADERS)
}

export async function streamEvents({ req, url, deps }: RouteContext): Promise<Response> {
  const queryToken = url.searchParams.get("token")
  const headerValid = validateToken(req, deps.token)
  const queryValid = queryToken === deps.token

  if (!headerValid && !queryValid) {
    deps.audit.log("auth.failed", { path: "/events", ip: getIP(req) })
    return jsonError("UNAUTHORIZED", "Unauthorized", 401, CORS_HEADERS)
  }

  deps.audit.log("sse.connected", { ip: getIP(req) })
  return deps.eventBus.createSSEResponse(CORS_HEADERS)
}

export async function listTools({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  const result = await deps.client.tool.ids({ query: { ...dirParam } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function getProject({ deps }: RouteContext): Promise<Response> {
  return json(
    {
      project: deps.project,
      directory: deps.directory,
      worktree: deps.worktree,
    },
    200,
    CORS_HEADERS,
  )
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function getHealth({ deps }: RouteContext): Promise<Response> {
  // SDK liveness: try a lightweight call
  let sdkStatus: "up" | "down" = "down"
  try {
    await deps.client.session.list()
    sdkStatus = "up"
  } catch {
    sdkStatus = "down"
  }

  // Tunnel status
  const tunnelStatus: "up" | "down" | "disabled" =
    deps.config.tunnel === "off"
      ? "disabled"
      : deps.tunnelUrl !== null
        ? "up"
        : "down"

  // Telegram status — "down" if bot is configured but not enabled (no config)
  const telegramStatus: "up" | "down" | "disabled" =
    deps.config.telegram === null
      ? "disabled"
      : deps.telegram.enabled
        ? "up"
        : "down"

  const anyDegraded =
    sdkStatus === "down" ||
    tunnelStatus === "down" ||
    telegramStatus === "down"

  return json(
    {
      status: anyDegraded ? "degraded" : "ok",
      uptimeMs: Math.round(process.uptime() * 1000),
      version: PILOT_VERSION,
      services: {
        tunnel: tunnelStatus,
        telegram: telegramStatus,
        sdk: sdkStatus,
      },
    },
    200,
    CORS_HEADERS,
  )
}

// ─── Token rotation ─────────────────────────────────────────────────────────

export async function rotateAuthToken({ deps }: RouteContext): Promise<Response> {
  const newToken = generateToken()

  // Update runtime token. deps is a shared object reference, so this mutation
  // is immediately visible to the server's auth check on subsequent requests.
  deps.rotateToken(newToken)

  // Persist to state file so the TUI slash command still works after rotation.
  updateStateToken(deps.directory, newToken)

  deps.audit.log("auth.token.rotated", {})

  // Emit SSE so the dashboard can show a toast / refresh its token.
  const baseUrlForEvent = deps.tunnelUrl ?? `http://${deps.config.host}:${deps.config.port}`
  deps.eventBus.emit({
    type: "pilot.token.rotated",
    properties: {
      timestamp: Date.now(),
      connectUrl: `${baseUrlForEvent}/?token=${newToken}`,
    },
  })

  // Telegram notification — include connect URL if we have a base URL.
  if (deps.telegram.enabled) {
    const baseUrl = deps.tunnelUrl ?? `http://${deps.config.host}:${deps.config.port}`
    const connectUrl = `${baseUrl}/?token=${newToken}`
    deps.telegram
      .sendMessage(
        `🔑 <b>Token Rotated</b>\n\nNew connect URL:\n<a href="${connectUrl}">${connectUrl}</a>`,
      )
      .catch((err) =>
        deps.audit.log("telegram.send_failed", {
          error: String(err),
          kind: "token_rotated",
        }),
      )
  }

  return json(
    {
      token: newToken,
      expiresAt: null,
    },
    200,
    CORS_HEADERS,
  )
}

// ─── SDK proxy handlers ──────────────────────────────────────────────────────

export async function listAgents({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  try {
    const result = await deps.client.app.agents({ query: { ...dirParam } })
    const agents: Array<Agent> = result.data ?? []
    return json({ agents }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: app.agents", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function listProviders({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  try {
    const result = await deps.client.provider.list({ query: { ...dirParam } })
    return json(result.data ?? {}, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: provider.list", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function getMcpStatus({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  try {
    const result = await deps.client.mcp.status({ query: { ...dirParam } })
    const servers: Record<string, McpStatus> = result.data ?? {}
    return json({ servers }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: mcp.status", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function listProjects({ deps }: RouteContext): Promise<Response> {
  try {
    const result = await deps.client.project.list()
    const projects: Array<Project> = result.data ?? []
    return json({ projects }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: project.list", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function getCurrentProject({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  try {
    const result = await deps.client.project.current({ query: { ...dirParam } })
    return json({ project: result.data ?? null }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: project.current", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

// ─── File browser ────────────────────────────────────────────────────────────

export async function listFileTree({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  // Block directory traversal in path param
  if (path.includes(".."))
    return jsonError("FORBIDDEN", "Path traversal not allowed", 403, CORS_HEADERS)

  try {
    const result = await deps.client.file.list({
      query: { path, ...dirParam },
    })
    return json(result.data ?? [], 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: file.list", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function readFileContent({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  // Block directory traversal
  if (path.includes(".."))
    return jsonError("FORBIDDEN", "Path traversal not allowed", 403, CORS_HEADERS)

  try {
    const result = await deps.client.file.read({
      query: { path, ...dirParam },
    })
    return json(result.data ?? null, result.data ? 200 : 404, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: file.read", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

// ─── LSP status ──────────────────────────────────────────────────────────────

export async function getLspStatus({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Invalid directory parameter", 400, CORS_HEADERS)
  try {
    const result = await deps.client.lsp.status({ query: { ...dirParam } })
    const clients: Array<LspStatus> = result.data ?? []
    return json({ clients }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: lsp.status", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

// ─── Web Push ────────────────────────────────────────────────────────────────

export async function getPushPublicKey({ deps }: RouteContext): Promise<Response> {
  if (!deps.config.vapid) {
    return jsonError(
      "PUSH_DISABLED",
      "Web Push is not configured. Set PILOT_VAPID_PUBLIC_KEY and PILOT_VAPID_PRIVATE_KEY.",
      503,
      CORS_HEADERS,
    )
  }
  return json({ publicKey: deps.config.vapid.publicKey }, 200, CORS_HEADERS)
}

function isValidSubscriptionBody(v: unknown): v is PushSubscriptionJson {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.endpoint !== "string" || o.endpoint.length === 0) return false
  const keys = o.keys
  if (!keys || typeof keys !== "object") return false
  const k = keys as Record<string, unknown>
  return typeof k.p256dh === "string" && typeof k.auth === "string"
}

export async function subscribePush({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.push.isEnabled()) {
    return jsonError("PUSH_DISABLED", "Web Push is not configured", 503, CORS_HEADERS)
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }
  if (!isValidSubscriptionBody(body)) {
    return jsonError(
      "INVALID_SUBSCRIPTION",
      "Body must be a PushSubscription JSON with endpoint and keys.{p256dh,auth}",
      400,
      CORS_HEADERS,
    )
  }
  deps.push.addSubscription(body)
  return json({ ok: true, count: deps.push.count() }, 200, CORS_HEADERS)
}

interface UnsubscribeBody {
  endpoint?: string
}

export async function unsubscribePush({ req, deps }: RouteContext): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }
  if (!body || typeof body !== "object") {
    return jsonError("INVALID_BODY", "Request body must be a JSON object", 400, CORS_HEADERS)
  }
  const { endpoint } = body as UnsubscribeBody
  if (!endpoint || typeof endpoint !== "string") {
    return jsonError("MISSING_ENDPOINT", "endpoint is required", 400, CORS_HEADERS)
  }
  deps.push.removeSubscription(endpoint)
  return json({ ok: true }, 200, CORS_HEADERS)
}

interface TestPushBody {
  endpoint?: string
}

export async function testPush({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.push.isEnabled()) {
    return jsonError("PUSH_DISABLED", "Web Push is not configured", 503, CORS_HEADERS)
  }
  let body: unknown = {}
  try {
    const raw = await req.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }
  const endpoint = (body as TestPushBody)?.endpoint

  const payload = {
    title: "OpenCode Pilot — test push",
    body: "Web Push is working 🎉",
    data: { kind: "test", url: "/" },
  }

  if (endpoint) {
    const ok = await deps.push.sendTo(endpoint, payload)
    return json({ ok }, ok ? 200 : 404, CORS_HEADERS)
  }

  await deps.push.broadcast(payload)
  return json({ ok: true, sent: deps.push.count() }, 200, CORS_HEADERS)
}

// ─── Glob file opener ────────────────────────────────────────────────────────

const GLOB_DEFAULT_LIMIT = 1000
const GLOB_MAX_LIMIT = 5000

function parseLimit(raw: string | null, def: number, max: number): number {
  if (!raw) return def
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(n, max)
}

/** Resolve an absolute path and ensure it resides under one of the allowed roots. */
function resolveSafePath(
  raw: string,
  allowedRoots: string[],
): { ok: true; resolved: string } | { ok: false; error: string } {
  if (!isAbsolute(raw)) return { ok: false, error: "path must be absolute" }

  let resolved: string
  try {
    resolved = realpathSync(raw)
  } catch {
    return { ok: false, error: "path not found" }
  }

  for (const root of allowedRoots) {
    if (!root) continue
    let realRoot: string
    try {
      realRoot = realpathSync(root)
    } catch {
      continue
    }
    if (resolved === realRoot || resolved.startsWith(realRoot + "/")) {
      return { ok: true, resolved }
    }
  }
  return { ok: false, error: "path is outside allowed roots" }
}

export async function globFiles({ url, deps }: RouteContext): Promise<Response> {
  if (!deps.config.enableGlobOpener) {
    return jsonError(
      "GLOB_DISABLED",
      "Glob opener is disabled. Set PILOT_ENABLE_GLOB_OPENER=true to enable.",
      403,
      CORS_HEADERS,
    )
  }

  const pattern = url.searchParams.get("pattern")
  if (!pattern) return jsonError("MISSING_PATTERN", "pattern is required", 400, CORS_HEADERS)

  const cwdParam = url.searchParams.get("cwd")
  const cwd = cwdParam && cwdParam.length > 0 ? cwdParam : deps.directory
  const limit = parseLimit(url.searchParams.get("limit"), GLOB_DEFAULT_LIMIT, GLOB_MAX_LIMIT)

  const allowedRoots = [deps.directory, process.env.HOME ?? ""]
  const cwdSafe = resolveSafePath(cwd, allowedRoots)
  if (!cwdSafe.ok) {
    return jsonError("FORBIDDEN", `cwd rejected: ${cwdSafe.error}`, 403, CORS_HEADERS)
  }

  try {
    const glob = new Bun.Glob(pattern)
    const results: Array<{ path: string; absolute: string; mtime: number; size: number }> = []
    for await (const rel of glob.scan({ cwd: cwdSafe.resolved, onlyFiles: true })) {
      const abs = join(cwdSafe.resolved, rel)
      let mtime = 0
      let size = 0
      try {
        const st = statSync(abs)
        mtime = st.mtimeMs
        size = st.size
      } catch {}
      results.push({ path: rel, absolute: abs, mtime, size })
      if (results.length >= limit) break
    }
    results.sort((a, b) => b.mtime - a.mtime)
    deps.audit.log("glob.search", {
      pattern,
      cwd: cwdSafe.resolved,
      count: results.length,
    })
    return json(
      { pattern, cwd: cwdSafe.resolved, count: results.length, files: results },
      200,
      CORS_HEADERS,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("glob scan failed", { error: message })
    return jsonError("GLOB_ERROR", "Glob scan failed", 500, CORS_HEADERS)
  }
}

const READ_MAX_BYTES = 2 * 1024 * 1024

export async function readFileAbs({ url, deps }: RouteContext): Promise<Response> {
  if (!deps.config.enableGlobOpener) {
    return jsonError(
      "GLOB_DISABLED",
      "Glob opener is disabled. Set PILOT_ENABLE_GLOB_OPENER=true to enable.",
      403,
      CORS_HEADERS,
    )
  }

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  const allowedRoots = [deps.directory, process.env.HOME ?? ""]
  const safe = resolveSafePath(path, allowedRoots)
  if (!safe.ok) {
    return jsonError("FORBIDDEN", `path rejected: ${safe.error}`, 403, CORS_HEADERS)
  }

  try {
    const st = statSync(safe.resolved)
    if (!st.isFile()) {
      return jsonError("NOT_A_FILE", "path is not a file", 400, CORS_HEADERS)
    }
    if (st.size > READ_MAX_BYTES) {
      return jsonError("FILE_TOO_LARGE", "File exceeds 2 MB limit", 413, CORS_HEADERS)
    }
    const content = readFileSync(safe.resolved, "utf-8")
    deps.audit.log("fs.read", { path: safe.resolved })
    return json({ path: safe.resolved, content, size: st.size }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("fs read failed", { error: message, path: safe.resolved })
    return jsonError("READ_ERROR", "Failed to read file", 500, CORS_HEADERS)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}
