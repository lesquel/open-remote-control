import type { PluginInput } from "@opencode-ai/plugin"
import type { Config, SettingsLoaderHelper } from "../../core/types/config"
import type { AuditLog } from "../../core/audit/log"
import type { EventBus } from "../../core/events/bus"
import type { PermissionQueue } from "../../core/permissions/queue"
import type { TelegramChannel, PushService } from "../../core/types/notification-channels"
import type { SettingsStore } from "../../core/settings/store"
import type { Logger } from "../../infra/logger/index"
import type { AuthRequirement, RouteParams } from "../../infra/http/types"
import type { DeviceCapability, DeviceStore } from "../../core/devices/store"
import type { RoutePrincipal } from "./authentication"
import type { AgentDescriptor } from "../../core/types/agent-integration"
import type { AgentAttentionService } from "../../core"

// Re-export infra types so consumers that currently import from routes.ts
// continue to work without changes.
export type { AuthRequirement, RouteParams } from "../../infra/http/types"

/** Dependencies injected into every handler. */
export interface RouteDeps {
  client: PluginInput["client"]
  project: PluginInput["project"]
  directory: PluginInput["directory"]
  worktree: PluginInput["worktree"]
  config: Config
  token: string
  /** Local device credentials; optional only for backwards-compatible embedders and focused tests. */
  deviceStore?: DeviceStore
  /** Injected by the composition root so transport/ never imports from server/. */
  pilotVersion: string
  /** Loaded agent metadata. Optional for backwards-compatible embedders and focused tests. */
  integrations?: readonly AgentDescriptor[]
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
  /** Separate permission queue for Codex hook bridge requests.
   *  Uses config.codexPermissionTimeoutMs instead of the main timeout. */
  codexPermissionQueue: PermissionQueue
  /** Native agent attention APIs (OpenCode v2 questions and permissions). */
  attentionService?: AgentAttentionService
  telegram: TelegramChannel
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
  /**
   * Injectable config-loading utilities. Provided by the composition root so
   * transport/http/handlers/settings.ts never imports from server/ directly.
   */
  settingsLoader: SettingsLoaderHelper
}

/** Concrete per-request context for the main HTTP server (specialized with RouteDeps). */
export type RouteContext = import("../../infra/http/types").RouteContext<RouteDeps> & {
  principal?: RoutePrincipal
}

export interface Route {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"
  pattern: RegExp
  auth: AuthRequirement
  requiredCapabilities?: readonly DeviceCapability[]
  handler: (ctx: RouteContext) => Promise<Response>
}

// Handlers are now split by domain. Each import group corresponds to one domain file.
// Note: Codex routes are no longer in this central table. Codex now
// self-registers via codexIntegration.setup({ registerRoute }) in server/index.ts.
import {
  serveDashboard,
  serveDashboardStatic,
  serveDashboardRootStatic,
  getStatus,
  getConnectInfo,
  getHealth,
  rotateAuthToken,
  listTools,
  getProject,
  listAgents,
  listProviders,
  getMcpStatus,
  getLspStatus,
  listFileTree,
  readFileContent,
  globFiles,
  readFileAbs,
} from "./handlers/system"
import {
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
  getSessionAttachment,
} from "./handlers/sessions"
import {
  listPermissions,
  respondPermission,
} from "./handlers/permissions"
import { listQuestions, replyQuestion, rejectQuestion } from "./handlers/questions"
import { streamEvents } from "./handlers/events"
import {
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  testPush,
  getSettings,
  patchSettings,
  resetSettings,
  generateVapidKeys,
} from "./handlers/settings"
import {
  listProjects,
  getCurrentProject,
} from "./handlers/projects"
import {
  listDevices,
  updateDevice,
  revokeDevice,
  createPairing,
  redeemPairing,
} from "./handlers/devices"
import { getDiagnostics } from "./handlers/diagnostics"
import { listIntegrations } from "./handlers/integrations"

/**
 * Central route table. Order matters only when patterns could overlap —
 * more specific routes should come first.
 */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/$/, auth: "none", handler: serveDashboard },
  // Static assets for the split dashboard (src/dashboard/)
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
  // Sub-directory static assets — covers ALL dashboard sub-folders post-Commit 5
  // (api/, auth/, components/, modals/, ui/, routing/, state/, sse/, vendor/, icons/).
  // BUG IN v1.18.0: this regex only allowed icons|assets, so the 8 new sub-folders
  // returned 404 JSON which the browser blocked as MIME mismatch. Fixed in v1.18.1.
  {
    method: "GET",
    pattern: /^\/(?:icons|api|auth|components|modals|ui|routing|state|sse|vendor)\/[^/]+\.(js|css|json|svg|png|ico|woff2?|ttf|d\.ts)$/,
    auth: "none",
    handler: serveDashboardRootStatic,
  },
  { method: "GET", pattern: /^\/status$/, auth: "required", requiredCapabilities: ["status.read"], handler: getStatus },
  { method: "GET", pattern: /^\/diagnostics$/, auth: "required", requiredCapabilities: ["status.read"], handler: getDiagnostics },
  { method: "GET", pattern: /^\/integrations$/, auth: "required", requiredCapabilities: ["status.read"], handler: listIntegrations },
  { method: "GET", pattern: /^\/sessions$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: listSessions },
  { method: "POST", pattern: /^\/sessions$/, auth: "required", requiredCapabilities: ["sessions.write"], handler: createSession },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/messages$/,
    auth: "required",
    requiredCapabilities: ["sessions.read"],
    handler: getSessionMessages,
  },
  {
    // Auth: optional — accepts Bearer header OR ?token= query param (for <img src="..."> tags)
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/attachments\/(?<partId>[^/]+)$/,
    auth: "optional",
    requiredCapabilities: ["files.read"],
    handler: getSessionAttachment,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/diff$/,
    auth: "required",
    requiredCapabilities: ["diff.read"],
    handler: getSessionDiff,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)\/children$/,
    auth: "required",
    requiredCapabilities: ["sessions.read"],
    handler: getSessionChildren,
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/prompt$/,
    auth: "required",
    requiredCapabilities: ["prompts.send"],
    handler: postSessionPrompt,
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/abort$/,
    auth: "required",
    requiredCapabilities: ["sessions.write"],
    handler: abortSession,
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    requiredCapabilities: ["sessions.read"],
    handler: getSession,
  },
  {
    method: "PATCH",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    requiredCapabilities: ["sessions.write"],
    handler: updateSession,
  },
  {
    method: "DELETE",
    pattern: /^\/sessions\/(?<id>[^/]+)$/,
    auth: "required",
    requiredCapabilities: ["sessions.write"],
    handler: deleteSession,
  },
  {
    method: "GET",
    pattern: /^\/permissions$/,
    auth: "required",
    requiredCapabilities: ["permissions.read"],
    handler: listPermissions,
  },
  {
    method: "POST",
    pattern: /^\/permissions\/(?<id>[^/]+)$/,
    auth: "required",
    requiredCapabilities: ["permissions.approve", "permissions.deny"],
    handler: respondPermission,
  },
  {
    method: "GET",
    pattern: /^\/questions$/,
    auth: "required",
    requiredCapabilities: ["sessions.read"],
    handler: listQuestions,
  },
  {
    method: "POST",
    pattern: /^\/questions\/(?<id>[^/]+)$/,
    auth: "required",
    requiredCapabilities: ["prompts.send"],
    handler: replyQuestion,
  },
  {
    method: "POST",
    pattern: /^\/questions\/(?<id>[^/]+)\/reject$/,
    auth: "required",
    requiredCapabilities: ["prompts.send"],
    handler: rejectQuestion,
  },
  // SSE: auth via query param allowed
  { method: "GET", pattern: /^\/events$/, auth: "optional", requiredCapabilities: ["sessions.read"], handler: streamEvents },
  { method: "GET", pattern: /^\/tools$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: listTools },
  { method: "GET", pattern: /^\/project$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: getProject },
  // Connect info — returns LAN / tunnel / local URLs for phone access modal
  { method: "GET", pattern: /^\/connect-info$/, auth: "required", requiredCapabilities: ["devices.manage"], handler: getConnectInfo },
  // Health check — no auth required (monitoring systems, load balancers)
  { method: "GET", pattern: /^\/health$/, auth: "none", handler: getHealth },
  // Token rotation — auth required with the CURRENT token
  { method: "POST", pattern: /^\/auth\/rotate$/, auth: "required", requiredCapabilities: ["auth.rotate"], handler: rotateAuthToken },
  // Per-device auth lifecycle. Pairing secrets are short-lived and one-time.
  { method: "GET", pattern: /^\/devices$/, auth: "required", requiredCapabilities: ["devices.manage"], handler: listDevices },
  { method: "PATCH", pattern: /^\/devices\/(?<id>[^/]+)$/, auth: "required", requiredCapabilities: ["devices.manage"], handler: updateDevice },
  { method: "DELETE", pattern: /^\/devices\/(?<id>[^/]+)$/, auth: "required", requiredCapabilities: ["devices.manage"], handler: revokeDevice },
  { method: "POST", pattern: /^\/pairing$/, auth: "required", requiredCapabilities: ["devices.manage"], handler: createPairing },
  { method: "POST", pattern: /^\/pairing\/redeem$/, auth: "none", handler: redeemPairing },
  // SDK proxy endpoints — dashboard data
  { method: "GET", pattern: /^\/agents$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: listAgents },
  { method: "GET", pattern: /^\/providers$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: listProviders },
  { method: "GET", pattern: /^\/mcp\/status$/, auth: "required", requiredCapabilities: ["status.read"], handler: getMcpStatus },
  { method: "GET", pattern: /^\/projects$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: listProjects },
  { method: "GET", pattern: /^\/project\/current$/, auth: "required", requiredCapabilities: ["sessions.read"], handler: getCurrentProject },
  { method: "GET", pattern: /^\/lsp\/status$/, auth: "required", requiredCapabilities: ["status.read"], handler: getLspStatus },
  // File browser endpoints — auth required
  { method: "GET", pattern: /^\/file\/list$/, auth: "required", requiredCapabilities: ["files.read"], handler: listFileTree },
  { method: "GET", pattern: /^\/file\/content$/, auth: "required", requiredCapabilities: ["files.read"], handler: readFileContent },
  // Web Push — auth required on all, subscribe body is a PushSubscriptionJSON
  { method: "GET", pattern: /^\/push\/public-key$/, auth: "required", requiredCapabilities: ["notifications.manage"], handler: getPushPublicKey },
  { method: "POST", pattern: /^\/push\/subscribe$/, auth: "required", requiredCapabilities: ["notifications.manage"], handler: subscribePush },
  { method: "POST", pattern: /^\/push\/unsubscribe$/, auth: "required", requiredCapabilities: ["notifications.manage"], handler: unsubscribePush },
  { method: "POST", pattern: /^\/push\/test$/, auth: "required", requiredCapabilities: ["notifications.manage"], handler: testPush },
  // Glob file opener — gated by config.enableGlobOpener
  { method: "GET", pattern: /^\/fs\/glob$/, auth: "required", requiredCapabilities: ["files.read"], handler: globFiles },
  { method: "GET", pattern: /^\/fs\/read$/, auth: "required", requiredCapabilities: ["files.read"], handler: readFileAbs },
  // Plugin settings — editable from the dashboard, persisted to ~/.opencode-pilot/config.json
  { method: "GET", pattern: /^\/settings$/, auth: "required", requiredCapabilities: ["settings.read"], handler: getSettings },
  { method: "PATCH", pattern: /^\/settings$/, auth: "required", requiredCapabilities: ["settings.write"], handler: patchSettings },
  { method: "POST", pattern: /^\/settings\/reset$/, auth: "required", requiredCapabilities: ["settings.write"], handler: resetSettings },
  { method: "POST", pattern: /^\/settings\/vapid\/generate$/, auth: "required", requiredCapabilities: ["settings.write"], handler: generateVapidKeys },
  // Codex CLI hook bridge routes are self-registered by codexIntegration.setup()
  // in server/index.ts via registerRoute. They no longer live in this central table.
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
