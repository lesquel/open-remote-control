import type { RouteContext } from "../routes"
import { jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { validateToken, safeEqual } from "../middlewares/auth"
import { MSG } from "../../../core/strings"

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}

export async function streamEvents({ req, url, deps }: RouteContext): Promise<Response> {
  const queryToken = url.searchParams.get("token")
  const headerValid = validateToken(req, deps.token)
  // Timing-safe compare for ?token= path — mirrors the Bearer path in validateToken
  const queryValid = queryToken !== null && safeEqual(queryToken, deps.token)

  if (!headerValid && !queryValid) {
    deps.audit.log("auth.failed", { path: "/events", ip: getIP(req) })
    return jsonError("UNAUTHORIZED", MSG.UNAUTHORIZED_BANNER, 401, CORS_HEADERS)
  }

  deps.audit.log("sse.connected", { ip: getIP(req) })
  return deps.eventBus.createSSEResponse(CORS_HEADERS)
}
