import type { PluginInput } from "@opencode-ai/plugin"
import type { Config } from "../config"
import type { AuditLog } from "../services/audit"
import type { EventBus } from "../services/event-bus"
import type { PermissionQueue } from "../services/permission-queue"
import type { TelegramBot } from "../services/telegram"
import type { PushService } from "../services/push"
import type { SettingsStore } from "../services/settings-store"
import type { Logger } from "../util/logger"

/** Auth requirements for a route. */
export type AuthRequirement = "required" | "optional" | "none"

/** Resolved URL params from named capture groups. */
export type RouteParams = Record<string, string>

/** Dependencies injected into every handler. */
export interface RouteDeps {
  client: PluginInput["client"]
  project: PluginInput["project"]
  directory: PluginInput["directory"]
  worktree: PluginInput["worktree"]
  config: Config
  token: string
  /**
   * Replace the active token. Called by POST /auth/rotate.
   * The server validates future requests against whatever deps.token holds
   * at the time, so this must also update the value the server reads.
   * The mutable container pattern is handled in index.ts: deps.token is
   * updated by writing through this callback.
   */
  rotateToken: (newToken: string) => void
  /** Public URL from the tunnel (if active), used in notifications. */
  tunnelUrl: string | null
  audit: AuditLog
  eventBus: EventBus
  permissionQueue: PermissionQueue
  telegram: TelegramBot
  push: PushService
  logger: Logger
  /** Persistent settings store (~/.opencode-pilot/config.json). */
  settingsStore: SettingsStore
  /**
   * Snapshot of process.env taken BEFORE .env and the settings-store were
   * layered on top. Used by /settings to classify each field's source.
   */
  shellEnv: NodeJS.ProcessEnv
  /** Keys that the .env loader wrote into process.env (provenance). */
  envFileApplied: string[]
}

export interface RouteContext {
  req: Request
  url: URL
  params: RouteParams
  deps: RouteDeps
}

export interface Route {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"
  pattern: RegExp
  auth: AuthRequirement
  handler: (ctx: RouteContext) => Promise<Response>
}

// handlers are imported after they are defined in handlers.ts
import {
  serveDashboard,
  serveDashboardStatic,
  serveDashboardRootStatic,
  getStatus,
  listSessions,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getSessionMessages,
  getSessionDiff,
  getSessionChildren,
  postSessionPrompt,
  abortSession,
  listPermissions,
  respondPermission,
  streamEvents,
  listTools,
  getProject,
  getConnectInfo,
  getHealth,
  rotateAuthToken,
  listAgents,
  listProviders,
  getMcpStatus,
  listProjects,
  getCurrentProject,
  getLspStatus,
  listFileTree,
  readFileContent,
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  testPush,
  globFiles,
  readFileAbs,
  getSettings,
  patchSettings,
  resetSettings,
  generateVapidKeys,
} from "./handlers"

/**
 * Central route table. Order matters only when patterns could overlap —
 * more specific routes should come first.
 */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/$/, auth: "none", handler: serveDashboard },
  // Static assets for the split dashboard (src/server/dashboard/)
  // /dashboard/* — legacy path kept for backward compat
  { method: "GET", pattern: /^\/dashboard\//, auth: "none", handler: serveDashboardStatic },
  // Root-level static assets: JS, CSS, JSON, SVG, PNG, ICO — served from dashboard dir
  // This allows ./relative imports in index.html to resolve correctly.
  // Must come before API routes so /manifest.json etc. are served, but the regex
  // only matches known extensions so it won't shadow API paths.
  {
    method: "GET",
    pattern: /^\/[^/]+\.(js|css|json|svg|png|ico|woff2?|ttf)$/,
    auth: "none",
    handler: serveDashboardRootStatic,
  },
  // Sub-directory static assets (e.g. /icons/icon.svg)
  {
    method: "GET",
    pattern: /^\/(?:icons|assets)\/[^/]+\.(js|css|json|svg|png|ico|woff2?|ttf)$/,
    auth: "none",
    handler: serveDashboardRootStatic,
  },
  { method: "GET", pattern: /^\/status$/, auth: "required", handler: getStatus },
  { method: "GET", pattern: /^\/sessions$/, auth: "required", handler: listSessions },
  { method: "POST", pattern: /^\/sessions$/, auth: "required", handler: createSession },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/messages$/,
    auth: "required",
    handler: getSessionMessages,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/diff$/,
    auth: "required",
    handler: getSessionDiff,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/children$/,
    auth: "required",
    handler: getSessionChildren,
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/prompt$/,
    auth: "required",
    handler: postSessionPrompt,
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/abort$/,
    auth: "required",
    handler: abortSession,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    handler: getSession,
  },
  {
    method: "PATCH",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    handler: updateSession,
  },
  {
    method: "DELETE",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    handler: deleteSession,
  },
  {
    method: "GET",
    pattern: /^\/permissions$/,
    auth: "required",
    handler: listPermissions,
  },
  {
    method: "POST",
    pattern: /^\/permissions\/(?<id>[^/]+)$/,
    auth: "required",
    handler: respondPermission,
  },
  // SSE: auth via query param allowed
  { method: "GET", pattern: /^\/events$/, auth: "optional", handler: streamEvents },
  { method: "GET", pattern: /^\/tools$/, auth: "required", handler: listTools },
  { method: "GET", pattern: /^\/project$/, auth: "required", handler: getProject },
  // Connect info — returns LAN / tunnel / local URLs for phone access modal
  { method: "GET", pattern: /^\/connect-info$/, auth: "required", handler: getConnectInfo },
  // Health check — no auth required (monitoring systems, load balancers)
  { method: "GET", pattern: /^\/health$/, auth: "none", handler: getHealth },
  // Token rotation — auth required with the CURRENT token
  { method: "POST", pattern: /^\/auth\/rotate$/, auth: "required", handler: rotateAuthToken },
  // SDK proxy endpoints — dashboard data
  { method: "GET", pattern: /^\/agents$/, auth: "required", handler: listAgents },
  { method: "GET", pattern: /^\/providers$/, auth: "required", handler: listProviders },
  { method: "GET", pattern: /^\/mcp\/status$/, auth: "required", handler: getMcpStatus },
  { method: "GET", pattern: /^\/projects$/, auth: "required", handler: listProjects },
  { method: "GET", pattern: /^\/project\/current$/, auth: "required", handler: getCurrentProject },
  { method: "GET", pattern: /^\/lsp\/status$/, auth: "required", handler: getLspStatus },
  // File browser endpoints — auth required
  { method: "GET", pattern: /^\/file\/list$/, auth: "required", handler: listFileTree },
  { method: "GET", pattern: /^\/file\/content$/, auth: "required", handler: readFileContent },
  // Web Push — auth required on all, subscribe body is a PushSubscriptionJSON
  { method: "GET", pattern: /^\/push\/public-key$/, auth: "required", handler: getPushPublicKey },
  { method: "POST", pattern: /^\/push\/subscribe$/, auth: "required", handler: subscribePush },
  { method: "POST", pattern: /^\/push\/unsubscribe$/, auth: "required", handler: unsubscribePush },
  { method: "POST", pattern: /^\/push\/test$/, auth: "required", handler: testPush },
  // Glob file opener — gated by config.enableGlobOpener
  { method: "GET", pattern: /^\/fs\/glob$/, auth: "required", handler: globFiles },
  { method: "GET", pattern: /^\/fs\/read$/, auth: "required", handler: readFileAbs },
  // Plugin settings — editable from the dashboard, persisted to ~/.opencode-pilot/config.json
  { method: "GET", pattern: /^\/settings$/, auth: "required", handler: getSettings },
  { method: "PATCH", pattern: /^\/settings$/, auth: "required", handler: patchSettings },
  { method: "POST", pattern: /^\/settings\/reset$/, auth: "required", handler: resetSettings },
  { method: "POST", pattern: /^\/settings\/vapid\/generate$/, auth: "required", handler: generateVapidKeys },
]

/** Match the first route whose method and pattern match. */
export function matchRoute(
  method: string,
  path: string,
): { route: Route; params: RouteParams } | null {
  for (const route of routes) {
    if (route.method !== method) continue
    const match = path.match(route.pattern)
    if (match) {
      return { route, params: match.groups ?? {} }
    }
  }
  return null
}
