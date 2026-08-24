import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { extractDirectory } from "./system"

export async function listPermissions({ url, deps }: RouteContext): Promise<Response> {
  // Merge pending items from both the main dashboard queue and the Codex hook queue.
  const queued = [...deps.permissionQueue.pending(), ...deps.codexPermissionQueue.pending()]
  const byId = new Map(queued.map((permission) => [permission.permissionID, permission]))
  const directory = extractDirectory(url)
  if (directory === null) return jsonError("INVALID_DIRECTORY", "Invalid directory", 400, CORS_HEADERS)
  const selectedDirectory = "directory" in directory ? directory.directory : undefined
  if (deps.attentionService) {
    try {
      const native = await deps.attentionService.listPermissions(selectedDirectory)
      for (const permission of native) {
        if (byId.has(permission.id)) continue
        byId.set(permission.id, {
          permissionID: permission.id,
          createdAt: Date.now(),
          resolved: false,
          title: permission.permission,
          sessionID: permission.sessionID,
          type: permission.permission,
          pattern: permission.patterns.join(" "),
          metadata: permission.metadata,
        })
      }
    } catch (error) {
      deps.logger.warn("Could not list native OpenCode permissions", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const all = [...byId.values()]
  return json(all, 200, CORS_HEADERS)
}

interface PermissionBody {
  action: "allow" | "deny"
}

export async function respondPermission({
  req,
  url,
  params,
  deps,
}: RouteContext): Promise<Response> {
  let body: PermissionBody
  try {
    body = (await req.json()) as PermissionBody
  } catch {
    return jsonError("INVALID_JSON", "Request body must be valid JSON", 400, CORS_HEADERS)
  }
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
  if (matchingQueues.length > 1) {
    return jsonError("AMBIGUOUS_PERMISSION_ID", "Permission ID matches multiple integrations", 409, CORS_HEADERS)
  }

  if (matchingQueues.length === 0 && deps.attentionService) {
    const directory = extractDirectory(url)
    if (directory === null) return jsonError("INVALID_DIRECTORY", "Invalid directory", 400, CORS_HEADERS)
    const selectedDirectory = "directory" in directory ? directory.directory : undefined
    try {
      const native = await deps.attentionService.listPermissions(selectedDirectory)
      if (native.some((permission) => permission.id === params.id)) {
        await deps.attentionService.replyPermission(
          params.id,
          body.action === "allow" ? "once" : "reject",
          selectedDirectory,
        )
        return json({ ok: true }, 200, CORS_HEADERS)
      }
    } catch (error) {
      deps.logger.error("Could not resolve native OpenCode permission", {
        permissionID: params.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return jsonError("SDK_ERROR", "Could not resolve OpenCode permission", 502, CORS_HEADERS)
    }
  }

  if (matchingQueues.length === 0) {
    return jsonError("PERMISSION_NOT_FOUND", "Permission ID not found or already resolved", 404, CORS_HEADERS)
  }

  const queue = matchingQueues[0]
  if (!queue || !queue.resolve(params.id, body.action)) {
    return jsonError("PERMISSION_NOT_FOUND", "Permission ID expired before it could be resolved", 404, CORS_HEADERS)
  }

  return json({ ok: true }, 200, CORS_HEADERS)
}
