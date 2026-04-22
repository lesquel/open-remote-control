import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "fs"
import { join, dirname, extname, isAbsolute } from "path"
import { fileURLToPath } from "url"
import type { RouteContext } from "./routes"
import { json, jsonError } from "./json"
import { CORS_HEADERS } from "./cors"
import { validateToken } from "./auth"
import { validateBody } from "./validation"
import {
  validateCreateSession,
  validateUpdateSession,
  validatePromptBody,
  validatePushSubscribe,
  validatePushTest,
  validateSettingsPatch,
} from "./validators"
import { generateToken } from "../util/auth"
import { updateStateToken } from "../services/state"
import { getLocalIP } from "../util/network"
import { getTunnelInfo } from "../services/tunnel"
import { PILOT_VERSION, LOCALHOST_ADDRESSES, VAPID_DEFAULT_SUBJECT } from "../constants"
import { MSG } from "../strings"
import {
  RESTART_REQUIRED_FIELDS,
  envKeyFor,
  loadConfigSafe,
  mergeStoredSettings,
  projectConfigToSettings,
  resolveSources,
} from "../config"
import type { PushSubscriptionJson } from "../services/push"
import type { PilotSettings } from "../services/settings-store"
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

/**
 * Cache-Control used for every dashboard asset.
 *
 * `no-cache` does NOT mean "do not cache" (that's `no-store`). It means
 * "cache freely, but revalidate with the origin before using". The browser
 * will still hit the server on every load and we'll respond with a fresh
 * copy from the in-memory snapshot. This costs us a round-trip per asset
 * in exchange for making every user pick up a new version on the next
 * refresh — no more users stuck on an old bundle for a month because their
 * service worker intercepted the request before it hit the network.
 */
const DASHBOARD_CACHE_HEADERS = {
  "Cache-Control": "no-cache, must-revalidate",
} as const

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function serveDashboard({ deps }: RouteContext): Promise<Response> {
  const html = getDashboardHtml(deps.config.dev)
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...DASHBOARD_CACHE_HEADERS,
      ...CORS_HEADERS,
    },
  })
}

/**
 * In-memory cache of dashboard files.
 *
 * Previously we read each file from disk on every request. That broke
 * catastrophically if someone deleted the plugin's cache directory while
 * the server was running (e.g. `npx init` while OpenCode is alive) — the
 * HTTP server kept serving but every asset request returned 404, leaving
 * the user's browser stuck on whatever it had cached before.
 *
 * We now snapshot every file under DASHBOARD_DIR into memory at boot.
 * Responses serve from memory, so cache-wipe operations can't break a
 * running dashboard.
 *
 * Dev mode (`PILOT_DEV=true`) bypasses the cache so live edits to
 * dashboard files show up without a plugin restart.
 */
type CachedAsset = { content: Buffer; mime: string }
const assetCache = new Map<string, CachedAsset>()

function loadAssetsIntoMemory(): void {
  if (!existsSync(DASHBOARD_DIR)) return
  const walk = (dir: string, prefix: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, `${prefix}${entry}/`)
        continue
      }
      const ext = extname(full)
      const mime = MIME[ext] ?? "text/plain"
      try {
        assetCache.set(`${prefix}${entry}`, {
          content: readFileSync(full),
          mime,
        })
      } catch {
        // Skip unreadable files — they just return 404 at request time.
      }
    }
  }
  walk(DASHBOARD_DIR, "")
}

// Lazy-load on first dashboard request so import order doesn't matter.
let assetsLoaded = false
function ensureAssetsLoaded(): void {
  if (assetsLoaded) return
  assetsLoaded = true
  loadAssetsIntoMemory()
}

/**
 * Apply per-file template substitutions. Right now only `sw.js` uses this —
 * its `__PILOT_CACHE_VERSION__` placeholder is replaced with a version-
 * scoped cache name so browsers invalidate cached dashboard assets on
 * every plugin release (see 1.13.15 fix for the "token inválido" issue).
 *
 * Keep this function pure and O(1) per file — it runs inside every
 * response path.
 */
function applyTemplating(relativePath: string, content: Buffer): Buffer {
  if (relativePath === "sw.js") {
    const replaced = content
      .toString("utf-8")
      .replace(/__PILOT_CACHE_VERSION__/g, `pilot-v${PILOT_VERSION}`)
    return Buffer.from(replaced, "utf-8")
  }
  return content
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

  // Dev mode: re-read every request so live edits show up.
  if (deps.config.dev) {
    const filePath = join(DASHBOARD_DIR, relativePath)
    if (!existsSync(filePath)) {
      return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
    }
    try {
      const raw = readFileSync(filePath)
      const content = applyTemplating(relativePath, raw)
      const mime = MIME[extname(filePath)] ?? "text/plain"
      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": mime,
          ...DASHBOARD_CACHE_HEADERS,
          ...CORS_HEADERS,
        },
      })
    } catch {
      deps.audit.log("error", { path: pathname, error: "Failed to read file" })
      return jsonError("INTERNAL_ERROR", "Failed to read file", 500, CORS_HEADERS)
    }
  }

  // Production: serve from the in-memory snapshot.
  ensureAssetsLoaded()
  const asset = assetCache.get(relativePath)
  if (!asset) {
    return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
  }
  const content = applyTemplating(relativePath, asset.content)
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": asset.mime,
      ...DASHBOARD_CACHE_HEADERS,
      ...CORS_HEADERS,
    },
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
      pilot: { version: PILOT_VERSION, uptime: process.uptime() },
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
    return jsonError("UNAUTHORIZED", MSG.UNAUTHORIZED_BANNER, 401, CORS_HEADERS)
  }

  deps.audit.log("sse.connected", { ip: getIP(req) })
  return deps.eventBus.createSSEResponse(CORS_HEADERS)
}

export async function listTools({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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

// ─── Connect info ────────────────────────────────────────────────────────────

/**
 * GET /connect-info — returns all info needed by the dashboard "Connect from phone" modal.
 * Auth: required.
 */
export async function getConnectInfo({ deps }: RouteContext): Promise<Response> {
  const { config, token } = deps
  const port = config.port
  const localIp = getLocalIP()
  const isExposed =
    config.host === "0.0.0.0" ||
    !(LOCALHOST_ADDRESSES as readonly string[]).includes(config.host)

  const lanUrl = localIp ? `http://${localIp}:${port}/?token=${token}` : null

  const lanInfo = {
    available: localIp !== null,
    url: isExposed && localIp ? lanUrl : (localIp ? `http://${localIp}:${port}/?token=${token}` : null),
    ip: localIp,
    exposed: isExposed,
  }

  const tunnelInfo = getTunnelInfo()
  const tunnelResult =
    tunnelInfo.status === "connected" && tunnelInfo.url !== null
      ? {
          available: true as const,
          provider: tunnelInfo.provider,
          url: `${tunnelInfo.url}/?token=${token}`,
          status: tunnelInfo.status,
        }
      : {
          available: false as const,
          provider: tunnelInfo.provider,
          status: tunnelInfo.status,
          howTo: "Set PILOT_TUNNEL=cloudflared (or ngrok) and restart",
        }

  const localInfo = {
    url: `http://127.0.0.1:${port}/?token=${token}`,
  }

  // Token preview: first 4 + "..." + last 4 (show full token for URL embedding)
  const tokenPreview =
    token.length > 10
      ? `${token.slice(0, 4)}...${token.slice(-4)}`
      : token.slice(0, 4) + "..."

  deps.audit.log("connect-info.requested", {})

  return json(
    {
      lan: lanInfo,
      tunnel: tunnelResult,
      local: localInfo,
      token,
      tokenPreview,
    },
    200,
    CORS_HEADERS,
  )
}

// ─── Health ─────────────────────────────────────────────────────────────────

// Captured once when the module is first loaded — used for uptime_s and started_at.
const SERVER_STARTED_AT = new Date()

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

  // Telegram connectivity — non-blocking check; fall back to null if invasive
  let telegramOk: boolean | null = null
  if (deps.telegram.enabled) {
    try {
      const result = await deps.telegram.testConnection()
      telegramOk = result.ok
    } catch {
      telegramOk = null
    }
  }

  const anyDegraded =
    sdkStatus === "down" ||
    tunnelStatus === "down" ||
    telegramStatus === "down"

  const uptimeS = (Date.now() - SERVER_STARTED_AT.getTime()) / 1000

  return json(
    {
      status: anyDegraded ? "degraded" : "ok",
      version: PILOT_VERSION,
      uptime_s: Math.round(uptimeS),
      started_at: SERVER_STARTED_AT.toISOString(),
      sse_clients: deps.eventBus.clientCount(),
      telegram_ok: telegramOk,
      push_configured: deps.push.isEnabled(),
      // Legacy fields kept for backward compatibility
      uptimeMs: Math.round(process.uptime() * 1000),
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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

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
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
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
      MSG.WEB_PUSH_NOT_CONFIGURED,
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
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }
  const validation = validatePushSubscribe(body)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "POST /push/subscribe",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }
  if (!isValidSubscriptionBody(body)) {
    return jsonError(
      "INVALID_SUBSCRIPTION",
      "Body must be a PushSubscription JSON with endpoint and keys.{p256dh,auth}",
      400,
      CORS_HEADERS,
    )
  }
  deps.push.addSubscription(body as PushSubscriptionJson)
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
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
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

export async function testPush({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.push.isEnabled()) {
    return jsonError("PUSH_DISABLED", "Web Push is not configured", 503, CORS_HEADERS)
  }
  let rawBody: unknown = {}
  try {
    const raw = await req.text()
    rawBody = raw ? JSON.parse(raw) : {}
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validatePushTest(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "POST /push/test",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  const { endpoint } = validation.data

  const payload = {
    title: "OpenCode Pilot — test push",
    body: "Web Push is working",
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
      MSG.GLOB_DISABLED,
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
      MSG.GLOB_DISABLED,
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

// ─── Settings API ────────────────────────────────────────────────────────────
//
// Exposes the layered configuration (defaults → .env → settings-store → shell)
// so the dashboard can display and edit it. Writes go to the JSON store; shell
// env vars cannot be overridden from the UI (409 on conflict).
//
// Sensitive fields (telegram token, VAPID private key) are returned as-is via
// HTTPS/localhost — the transport is already trusted and the UI needs them to
// show "previously saved" state.

function buildSettingsResponse(deps: RouteContext["deps"]): {
  settings: Required<PilotSettings>
  sources: ReturnType<typeof resolveSources>
  restartRequired: ReadonlyArray<keyof PilotSettings>
  configFilePath: string
} {
  // Recompute the effective config from the FRESH store + shell env every
  // time. `deps.config` is a boot-time snapshot and does not reflect changes
  // made via PATCH /settings — returning it here caused saved values (port,
  // host, tunnel, etc.) to appear "reverted" in the UI even though the disk
  // state was correct. Settings marked `restartRequired` still need a plugin
  // restart to take effect; `settings` below shows the value that WILL be
  // active after that restart.
  const stored = deps.settingsStore.load()
  const effectiveEnv = mergeStoredSettings(process.env, deps.shellEnv, stored)
  const effective = loadConfigSafe(effectiveEnv, () => {
    // swallow — we already warned once at boot
  })
  return {
    settings: projectConfigToSettings(effective),
    sources: resolveSources(deps.shellEnv, deps.envFileApplied, stored),
    restartRequired: RESTART_REQUIRED_FIELDS,
    configFilePath: deps.settingsStore.filePath(),
  }
}

export async function getSettings({ deps }: RouteContext): Promise<Response> {
  return json(buildSettingsResponse(deps), 200, CORS_HEADERS)
}

export async function patchSettings({ req, deps }: RouteContext): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validateSettingsPatch(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "PATCH /settings",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  // Reject fields that are pinned by shell-env — we cannot override those.
  const conflicts: string[] = []
  for (const key of Object.keys(validation.data) as Array<keyof PilotSettings>) {
    const envKey = envKeyFor(key)
    if (deps.shellEnv[envKey] !== undefined && deps.shellEnv[envKey] !== "") {
      conflicts.push(key)
    }
  }
  if (conflicts.length > 0) {
    return jsonError(
      "SHELL_ENV_PINNED",
      `Cannot override: ${conflicts.join(", ")} (set via shell env). Unset the env var and retry.`,
      409,
      CORS_HEADERS,
    )
  }

  deps.settingsStore.save(validation.data)
  deps.audit.log("settings.saved", {
    keys: Object.keys(validation.data),
  })

  return json(buildSettingsResponse(deps), 200, CORS_HEADERS)
}

export async function resetSettings({ deps }: RouteContext): Promise<Response> {
  deps.settingsStore.reset()
  deps.audit.log("settings.reset", {})
  return json({ ok: true, configFilePath: deps.settingsStore.filePath() }, 200, CORS_HEADERS)
}

/**
 * Generate a fresh VAPID key pair. Does NOT auto-save — the UI shows the keys
 * and lets the user decide. Requires web-push to be installed.
 */
export async function generateVapidKeys({ deps }: RouteContext): Promise<Response> {
  try {
    const mod = (await import("web-push")) as unknown as
      | { generateVAPIDKeys?: () => { publicKey: string; privateKey: string } }
      | { default: { generateVAPIDKeys?: () => { publicKey: string; privateKey: string } } }
    const wp =
      "default" in (mod as Record<string, unknown>) &&
      typeof (mod as { default: unknown }).default === "object"
        ? (mod as { default: { generateVAPIDKeys?: () => { publicKey: string; privateKey: string } } }).default
        : (mod as { generateVAPIDKeys?: () => { publicKey: string; privateKey: string } })
    if (typeof wp.generateVAPIDKeys !== "function") {
      return jsonError(
        "WEB_PUSH_UNAVAILABLE",
        "web-push module does not expose generateVAPIDKeys",
        500,
        CORS_HEADERS,
      )
    }
    const { publicKey, privateKey } = wp.generateVAPIDKeys()
    deps.audit.log("settings.vapid.generated", {})
    return json(
      {
        publicKey,
        privateKey,
        subject: VAPID_DEFAULT_SUBJECT,
      },
      200,
      CORS_HEADERS,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("generateVapidKeys failed", { error: message })
    return jsonError("WEB_PUSH_UNAVAILABLE", "web-push module not installed", 503, CORS_HEADERS)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}
