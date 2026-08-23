import { CORS_HEADERS } from "../middlewares/cors"
import { json } from "../middlewares/json"
import type { RouteContext } from "../routes"

function activeStatus(value: unknown): boolean {
  if (typeof value === "string") return value !== "idle"
  if (!value || typeof value !== "object") return false
  const status = (value as Record<string, unknown>).type ?? (value as Record<string, unknown>).status
  return typeof status === "string" && status !== "idle"
}

export async function getDiagnostics({ deps, principal }: RouteContext): Promise<Response> {
  let sessionTotal: number | null = null
  let activeSessions: number | null = null
  let sdkStatus: "ok" | "error" = "ok"
  try {
    const [sessions, statuses] = await Promise.all([
      deps.client.session.list(),
      deps.client.session.status(),
    ])
    if (sessions.error || statuses.error) {
      sdkStatus = "error"
    } else {
      sessionTotal = sessions.data?.length ?? 0
      activeSessions = Object.values(statuses.data ?? {}).filter(activeStatus).length
    }
  } catch {
    sdkStatus = "error"
  }

  let configSources: Record<string, unknown> = {}
  try {
    configSources = deps.settingsLoader.loadEffective(deps.settingsStore.load()).sources
  } catch {
    // Diagnostics remains available when configuration recovery itself fails.
  }

  return json({
    pilot: {
      version: deps.pilotVersion,
      uptimeSeconds: Math.round(process.uptime()),
      runtime: { name: "Bun", version: Bun.version },
    },
    listener: {
      host: deps.config.host,
      port: deps.config.port,
      tunnel: {
        provider: deps.config.tunnel,
        status: deps.config.tunnel === "off" ? "disabled" : deps.tunnelUrl ? "connected" : "disconnected",
      },
    },
    authentication: {
      kind: principal?.kind ?? "unknown",
      role: principal?.role ?? null,
      deviceId: principal?.kind === "device" ? principal.id : null,
    },
    runtime: {
      sdk: { status: sdkStatus, version: null },
      sseClients: deps.eventBus.clientCount(),
      pendingPermissions: deps.permissionQueue.pending().length + deps.codexPermissionQueue.pending().length,
      sessions: { total: sessionTotal, active: activeSessions },
      integrations: ["opencode", "codex"],
      notifications: {
        telegram: deps.telegram.enabled(),
        push: deps.push.isEnabled(),
        pushSubscriptions: deps.push.count(),
      },
      devices: { total: deps.deviceStore?.list().length ?? 0 },
    },
    configuration: { sources: configSources },
    recentErrors: deps.logger.recentErrors?.() ?? [],
  }, 200, CORS_HEADERS)
}
