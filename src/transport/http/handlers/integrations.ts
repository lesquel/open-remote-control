import { CORS_HEADERS } from "../middlewares/cors"
import { json } from "../middlewares/json"
import type { RouteContext } from "../routes"

export async function listIntegrations({ deps }: RouteContext): Promise<Response> {
  return json({
    protocolVersion: 1,
    integrations: deps.integrations ?? [],
  }, 200, CORS_HEADERS)
}
