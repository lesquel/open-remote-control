import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { getLocalIP } from "../../../infra/network/ip"
import { getTunnelInfo } from "../../../infra/tunnel/index"
import { LOCALHOST_ADDRESSES } from "../../../infra/http/constants"
import { generateToken } from "../../../infra/auth/token"
import { updateStateToken } from "../../../core/state/store"

// ─── Shared utility ──────────────────────────────────────────────────────────

const MAX_DIRECTORY_LENGTH = 512

/**
 * Extract and validate the optional `?directory=<path>` query param.
 * Returns `{ directory }` if present and valid, or `{}` if absent.
 * Returns `null` if the value is malformed (caller should return 400).
 */
export function extractDirectory(url: URL): { directory: string } | {} | null {
  const dir = url.searchParams.get("directory")
  if (!dir) return {}
  if (dir.includes("..") || dir.length > MAX_DIRECTORY_LENGTH) return null
  return { directory: dir }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}

// ─── Status ─────────────────────────────────────────────────────────────────

export async function getStatus({ deps }: RouteContext): Promise<Response> {
  const sessions = await deps.client.session.list()
  if (sessions.error) {
    const errMsg =
      typeof sessions.error === "object" && sessions.error !== null && "message" in sessions.error
        ? String((sessions.error as { message?: unknown }).message ?? "")
        : String(sessions.error)
    deps.logger.error("SDK call failed: session.list", { error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
  const statuses = await deps.client.session.status()
  if (statuses.error) {
    const errMsg =
      typeof statuses.error === "object" && statuses.error !== null && "message" in statuses.error
        ? String((statuses.error as { message?: unknown }).message ?? "")
        : String(statuses.error)
    deps.logger.error("SDK call failed: session.status", { error: errMsg })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
  return json(
    {
      pilot: { version: deps.pilotVersion, uptime: process.uptime() },
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
      : deps.telegram.enabled()
        ? "up"
        : "down"

  // Telegram connectivity — non-blocking check; fall back to null if invasive
  let telegramOk: boolean | null = null
  if (deps.telegram.enabled()) {
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
      version: deps.pilotVersion,
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
  if (deps.telegram.enabled()) {
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

// ─── Re-exports (barrel) ─────────────────────────────────────────────────────
// routes.ts and other handlers import from "./handlers/system" for all these
// symbols. Moving them to sibling files must not break those importers.

export {
  serveDashboard,
  serveDashboardStatic,
  serveDashboardRootStatic,
} from "./dashboard"

export {
  listTools,
  getProject,
  listAgents,
  listProviders,
  getMcpStatus,
  getLspStatus,
} from "./sdk-proxy"

export {
  listFileTree,
  readFileContent,
  globFiles,
  readFileAbs,
} from "./filesystem"
