import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"

export async function listPermissions({ deps }: RouteContext): Promise<Response> {
  // Merge pending items from both the main dashboard queue and the Codex hook queue.
  const all = [...deps.permissionQueue.pending(), ...deps.codexPermissionQueue.pending()]
  return json(all, 200, CORS_HEADERS)
}

interface PermissionBody {
  action: "allow" | "deny"
}

export async function respondPermission({
  req,
  params,
  deps,
}: RouteContext): Promise<Response> {
  const body = (await req.json()) as PermissionBody
  if (!body.action || !["allow", "deny"].includes(body.action)) {
    return jsonError(
      "INVALID_ACTION",
      "action must be 'allow' or 'deny'",
      400,
      CORS_HEADERS,
    )
  }

  deps.audit.log("permission.responded", {
    permissionID: params.id,
    action: body.action,
  })

  const matchingQueues = [deps.permissionQueue, deps.codexPermissionQueue]
    .filter((queue) => queue.pending().some((permission) => permission.permissionID === params.id))
  if (matchingQueues.length === 0) {
    return jsonError("PERMISSION_NOT_FOUND", "Permission ID not found or already resolved", 404, CORS_HEADERS)
  }
  if (matchingQueues.length > 1) {
    return jsonError("AMBIGUOUS_PERMISSION_ID", "Permission ID matches multiple integrations", 409, CORS_HEADERS)
  }

  const queue = matchingQueues[0]
  if (!queue || !queue.resolve(params.id, body.action)) {
    return jsonError("PERMISSION_NOT_FOUND", "Permission ID expired before it could be resolved", 404, CORS_HEADERS)
  }

  return json({ ok: true }, 200, CORS_HEADERS)
}
