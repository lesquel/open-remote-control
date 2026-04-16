import type { PluginInput } from "@opencode-ai/plugin"
import type { Config } from "../config"
import type { AuditLog } from "../services/audit"
import type { EventBus } from "../services/event-bus"
import type { PermissionQueue } from "../services/permission-queue"

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
  audit: AuditLog
  eventBus: EventBus
  permissionQueue: PermissionQueue
}

export interface RouteContext {
  req: Request
  url: URL
  params: RouteParams
  deps: RouteDeps
}

export interface Route {
  method: "GET" | "POST" | "DELETE" | "PUT"
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
  getSessionMessages,
  getSessionDiff,
  postSessionPrompt,
  abortSession,
  listPermissions,
  respondPermission,
  streamEvents,
  listTools,
  getProject,
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
