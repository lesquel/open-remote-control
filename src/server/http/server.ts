import { validateToken, getIP } from "./auth"
import { CORS_HEADERS, corsPreflightResponse } from "./cors"
import { jsonError } from "./json"
import { matchRoute } from "./routes"
import type { RouteDeps } from "./routes"

export interface RemoteServer {
  start(): void
  stop(): void
}

export function createRemoteServer(deps: RouteDeps): RemoteServer {
  let server: ReturnType<typeof Bun.serve> | null = null

  function start(): void {
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
            deps.audit.log("auth.failed", { path, ip: getIP(req) })
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
  }

  function stop(): void {
    server?.stop()
  }

  return { start, stop }
}
