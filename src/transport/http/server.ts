import { validateToken, getIP } from "./middlewares/auth"
import { CORS_HEADERS, corsPreflightResponse } from "./middlewares/cors"
import { jsonError } from "./middlewares/json"
import { matchRoute, routes } from "./routes"
import type { RouteDeps, Route } from "./routes"
import { MAX_REQUEST_BODY_BYTES } from "../../infra/http/constants"
import { readBoundedBytes } from "../../infra/http/text"
import {
  applyBrowserResponseHeaders,
  validateBrowserBoundary,
} from "../../infra/http/browser-security"
import { randomUUID } from "node:crypto"

export interface RemoteServer {
  /**
   * Attempt to bind the HTTP server. Returns `{ ok: true }` on success.
   * Returns `{ ok: false, reason: "port-in-use" }` when the port is already
   * bound by another OpenCode instance on the same machine — the plugin
   * treats this as "passive mode" (see src/server/index.ts) rather than
   * propagating the error. Any other bind failure still throws.
   */
  start(): { ok: true } | { ok: false; reason: "port-in-use"; error: Error }
  stop(): void
  /**
   * Register a new route at runtime. Used by integrations (e.g. Codex) that
   * self-register via AgentIntegration.setup({ registerRoute }).
   * Routes registered this way are appended to the live route table.
   */
  registerRoute(route: Route): void
}

function isEaddrInUse(err: unknown): boolean {
  if (!err) return false
  const anyErr = err as { code?: string; message?: string }
  if (anyErr.code === "EADDRINUSE") return true
  return typeof anyErr.message === "string" && /EADDRINUSE|address already in use|port is already in use/i.test(anyErr.message)
}

/**
 * Guard against large-body DoS attacks. Call this early in any fetch handler
 * that will read a request body.
 *
 * - If Content-Length is present and exceeds maxBytes, returns a 413 response
 *   immediately without touching the body stream.
 * - If Content-Length is absent or zero, returns null so the caller can proceed
 *   to read the body normally (Bun's `req.json()` / `req.arrayBuffer()` will
 *   buffer it; callers that need strict enforcement on chunked uploads should
 *   use a streaming size-limiter instead, but for dashboard traffic this is
 *   sufficient).
 *
 * Returns a Response to send back on violation, or null when the request is
 * within limits.
 */
export function checkBodySize(
  req: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
  requestId?: string,
): Response | null {
  const cl = req.headers.get("content-length")
  if (cl !== null) {
    const len = Number(cl)
    if (Number.isFinite(len) && len > maxBytes) {
      return jsonError(
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds the ${maxBytes}-byte limit`,
        413,
        CORS_HEADERS,
        requestId,
      )
    }
  }
  return null
}

// Re-export readBoundedText from infra so existing consumers that import from
// this path continue to work. The implementation lives in infra/http/text.ts.
export { readBoundedText } from "../../infra/http/text"

export function createRemoteServer(deps: RouteDeps): RemoteServer {
  let server: ReturnType<typeof Bun.serve> | null = null

  // Dynamic routes registered after server construction (e.g. by codexIntegration)
  const dynamicRoutes: Route[] = []

  function registerRoute(route: Route): void {
    dynamicRoutes.push(route)
  }

  function start(): { ok: true } | { ok: false; reason: "port-in-use"; error: Error } {
    try {
      server = Bun.serve({
      port: deps.config.port,
      hostname: deps.config.host,
      idleTimeout: 255, // seconds — max Bun allows; prevents SSE connections from being killed

      async fetch(req: Request): Promise<Response> {
        const requestId = randomUUID()
        const url = new URL(req.url)
        const path = url.pathname
        const boundary = validateBrowserBoundary(req, {
          host: deps.config.host,
          port: deps.config.port,
          tunnelUrl: deps.tunnelUrl,
          allowedHosts: deps.config.allowedHosts,
          allowedOrigins: deps.config.allowedOrigins,
        })
        const respond = (response: Response): Response => {
          const secured = applyBrowserResponseHeaders(response, boundary.ok ? boundary.origin : null)
          const headers = new Headers(secured.headers)
          headers.set("X-Request-ID", requestId)
          return new Response(secured.body, {
            status: secured.status,
            statusText: secured.statusText,
            headers,
          })
        }
        const requestError = (code: string, message: string, status: number): Response =>
          jsonError(code, message, status, CORS_HEADERS, requestId)

        if (!boundary.ok) {
          deps.audit.log("request.rejected", {
            reason: boundary.code,
            method: req.method,
            path,
            ip: getIP(req),
            requestId,
          })
          return respond(requestError("FORBIDDEN", "Forbidden", 403))
        }

        // CORS preflight
        if (req.method === "OPTIONS") {
          return respond(corsPreflightResponse())
        }

        // Check static routes first, then dynamically-registered routes
        let matched = matchRoute(req.method, path)
        if (!matched) {
          for (const route of dynamicRoutes) {
            if (route.method !== req.method) continue
            const routeMatch = path.match(route.pattern)
            if (routeMatch) {
              matched = { route, params: routeMatch.groups ?? {} }
              break
            }
          }
        }

        if (!matched) {
          deps.audit.log("request.notfound", { method: req.method, path, ip: getIP(req), requestId })
          return respond(requestError("NOT_FOUND", "Not found", 404))
        }

        const { route, params } = matched

        // Auth check — "optional" is handled per-handler (SSE)
        if (route.auth === "required") {
          if (!validateToken(req, deps.token)) {
            const ip = getIP(req)
            deps.audit.log("auth.failed", { path, ip, requestId })
            // Also surface via ctx.client.app.log so the user sees 401
            // storms in OpenCode's log panel (not only in the audit log
            // which most users never open). This is the signal that
            // tells you a stale token is being retried by a dashboard
            // that hasn't noticed the server restart.
            // Introduced in 1.13.15 for issue #1 "token inválido" follow-up.
            deps.logger.warn(
              `Auth rejected on ${req.method} ${path} — the client sent a token that does not match the current server token. ` +
              `Usually: a dashboard tab from before the last OpenCode restart. Have the user re-open via /remote.`,
              { path, method: req.method, ip, requestId },
            )
            return respond(requestError("UNAUTHORIZED", "Unauthorized", 401))
          }
          deps.audit.log("request", { method: req.method, path, ip: getIP(req), requestId })
        }

        let handlerRequest = req
        // Buffer mutation bodies through a streaming hard limit, then rebuild
        // the request so handlers can safely call json()/text(). This also
        // covers chunked requests and dishonest Content-Length headers.
        if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
          const sizeError = checkBodySize(req, MAX_REQUEST_BODY_BYTES, requestId)
          if (sizeError) return respond(sizeError)
          let body: Uint8Array<ArrayBuffer> | null
          try {
            body = await readBoundedBytes(req, MAX_REQUEST_BODY_BYTES)
          } catch (err) {
            deps.audit.log("request.body_read_failed", { path, error: String(err), requestId })
            return respond(requestError("INVALID_BODY", "Failed to read request body", 400))
          }
          if (body === null) {
            return respond(jsonError(
              "PAYLOAD_TOO_LARGE",
              `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit`,
              413,
              CORS_HEADERS,
              requestId,
            ))
          }
          handlerRequest = new Request(req, { body: body.byteLength > 0 ? body.buffer : undefined })
        }

        try {
          return respond(await route.handler({ req: handlerRequest, url, params, deps, requestId }))
        } catch (err) {
          deps.audit.log("error", { path, error: String(err), requestId })
          deps.logger.error("HTTP handler failed", { path, requestId, error: String(err) })
          return respond(requestError("INTERNAL_ERROR", "Internal server error", 500))
        }
      },
      })
      return { ok: true }
    } catch (err) {
      if (isEaddrInUse(err)) {
        return { ok: false, reason: "port-in-use", error: err as Error }
      }
      throw err
    }
  }

  function stop(): void {
    server?.stop()
  }

  return { start, stop, registerRoute }
}
