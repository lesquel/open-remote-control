import type { RouteContext } from "../routes"
import { jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { MSG } from "../../../core/strings"
import { authenticateCredential, deviceStreamTag } from "../authentication"
import { getBearerToken } from "../../../infra/http/auth"

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}

export async function streamEvents({ req, url, deps, principal }: RouteContext): Promise<Response> {
  const authenticated = principal ?? authenticateCredential(
    getBearerToken(req) ?? url.searchParams.get("token"),
    deps,
  )
  if (!authenticated) {
    deps.audit.log("auth.failed", { path: "/events", ip: getIP(req) })
    return jsonError("UNAUTHORIZED", MSG.UNAUTHORIZED_BANNER, 401, CORS_HEADERS)
  }

  deps.audit.log("sse.connected", { ip: getIP(req) })
  return deps.eventBus.createSSEResponse(
    CORS_HEADERS,
    url.searchParams.get("lastEventId"),
    authenticated.kind === "device" ? deviceStreamTag(authenticated.id) : undefined,
  )
}
