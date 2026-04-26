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

  // Try main queue first, then codex queue.
  // resolve() returns true when a live waiter was found, false when the ID is stale/unknown.
  const resolved =
    deps.permissionQueue.resolve(params.id, body.action) ||
    deps.codexPermissionQueue.resolve(params.id, body.action)

  if (!resolved) {
    return jsonError("PERMISSION_NOT_FOUND", "Permission ID not found or already resolved", 404, CORS_HEADERS)
  }

  return json({ ok: true }, 200, CORS_HEADERS)
}
