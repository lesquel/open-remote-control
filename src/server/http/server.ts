import { validateToken, getIP } from "./auth"
import { CORS_HEADERS, corsPreflightResponse } from "./cors"
import { jsonError } from "./json"
import { matchRoute } from "./routes"
import type { RouteDeps } from "./routes"

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
}

function isEaddrInUse(err: unknown): boolean {
  if (!err) return false
  const anyErr = err as { code?: string; message?: string }
  if (anyErr.code === "EADDRINUSE") return true
  return typeof anyErr.message === "string" && /EADDRINUSE|address already in use|port is already in use/i.test(anyErr.message)
}

export function createRemoteServer(deps: RouteDeps): RemoteServer {
  let server: ReturnType<typeof Bun.serve> | null = null

  function start(): { ok: true } | { ok: false; reason: "port-in-use"; error: Error } {
    try {
      server = Bun.serve({
      port: deps.config.port,
      hostname: deps.config.host,
      idleTimeout: 255, // seconds — max Bun allows; prevents SSE connections from being killed

      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const path = url.pathname

        // CORS preflight
        if (req.method === "OPTIONS") {
          return corsPreflightResponse()
        }

        const matched = matchRoute(req.method, path)

        if (!matched) {
          deps.audit.log("request.notfound", { method: req.method, path, ip: getIP(req) })
          return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
        }

        const { route, params } = matched

        // Auth check — "optional" is handled per-handler (SSE)
        if (route.auth === "required") {
          if (!validateToken(req, deps.token)) {
            const ip = getIP(req)
            deps.audit.log("auth.failed", { path, ip })
            // Also surface via ctx.client.app.log so the user sees 401
            // storms in OpenCode's log panel (not only in the audit log
            // which most users never open). This is the signal that
            // tells you a stale token is being retried by a dashboard
            // that hasn't noticed the server restart.
            // Introduced in 1.13.15 for issue #1 "token inválido" follow-up.
            deps.logger.warn(
              `Auth rejected on ${req.method} ${path} — the client sent a token that does not match the current server token. ` +
              `Usually: a dashboard tab from before the last OpenCode restart. Have the user re-open via /remote.`,
              { path, method: req.method, ip },
            )
            return jsonError("UNAUTHORIZED", "Unauthorized", 401, CORS_HEADERS)
          }
          deps.audit.log("request", { method: req.method, path, ip: getIP(req) })
        }

        try {
          return await route.handler({ req, url, params, deps })
        } catch (err) {
          deps.audit.log("error", { path, error: String(err) })
          return jsonError("INTERNAL_ERROR", "Internal server error", 500, CORS_HEADERS)
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

  return { start, stop }
}
