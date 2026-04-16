import { readFileSync, existsSync } from "fs"
import { join, dirname, extname } from "path"
import { fileURLToPath } from "url"
import type { RouteContext } from "./routes"
import { json, jsonError } from "./json"
import { CORS_HEADERS } from "./cors"
import { validateToken } from "./auth"

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

export async function listSessions({ deps }: RouteContext): Promise<Response> {
  const result = await deps.client.session.list()
  const statuses = await deps.client.session.status()
  return json(
    { sessions: result.data ?? [], statuses: statuses.data ?? {} },
    200,
    CORS_HEADERS,
  )
}

export async function createSession({ deps }: RouteContext): Promise<Response> {
  const result = await deps.client.session.create()
  deps.audit.log("session.created", { sessionID: result.data?.id ?? null })
  return json(result.data ?? null, result.error ? 500 : 201, CORS_HEADERS)
}

export async function getSession({ params, deps }: RouteContext): Promise<Response> {
  const result = await deps.client.session.get({ path: { id: params.id } })
  return json(result.data ?? null, result.error ? 404 : 200, CORS_HEADERS)
}

export async function getSessionMessages({
  params,
  deps,
}: RouteContext): Promise<Response> {
  const result = await deps.client.session.messages({ path: { id: params.id } })
  return json(result.data ?? [], 200, CORS_HEADERS)
}

export async function getSessionDiff({ params, deps }: RouteContext): Promise<Response> {
  const result = await deps.client.session.diff({ path: { id: params.id } })
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
  params,
  deps,
}: RouteContext): Promise<Response> {
  const body = (await req.json()) as PromptBody

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
    body: promptBody,
  })
  return json(result.data ?? null, result.error ? 500 : 200, CORS_HEADERS)
}

export async function abortSession({ params, deps }: RouteContext): Promise<Response> {
  deps.audit.log("session.aborted", { sessionID: params.id })
  const result = await deps.client.session.abort({ path: { id: params.id } })
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

export async function listTools({ deps }: RouteContext): Promise<Response> {
  const result = await deps.client.tool.ids()
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}
