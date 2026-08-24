import type { PendingPermission, PermissionContext } from "../../../core/permissions/queue"
import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { extractDirectory } from "./system"

function selectedPermissionDirectory({ url, deps }: Pick<RouteContext, "url" | "deps">): string | undefined | null {
  const directory = extractDirectory(url)
  if (directory === null) return null
  if ("directory" in directory) return directory.directory
  return typeof deps.directory === "string" && deps.directory.length > 0 ? deps.directory : undefined
}

function isInDirectory(permission: PendingPermission, directory: string | undefined): boolean {
  return permission.directory === directory
}

function identity(permission: PendingPermission): string {
  return JSON.stringify([
    permission.integrationID ?? "legacy",
    permission.directory ?? "",
    permission.sessionID ?? "",
    permission.permissionID,
  ])
}

function completeContext(permission: PendingPermission): PermissionContext | undefined {
  if (
    !permission.integrationID ||
    !permission.projectID ||
    !permission.directory ||
    !permission.sessionID
  ) return undefined
  return {
    integrationID: permission.integrationID,
    projectID: permission.projectID,
    directory: permission.directory,
    sessionID: permission.sessionID,
  }
}

function matchesResponse(
  permission: PendingPermission,
  permissionID: string,
  directory: string | undefined,
  body: PermissionBody,
): boolean {
  return permission.permissionID === permissionID &&
    isInDirectory(permission, directory) &&
    (body.integrationID === undefined || permission.integrationID === body.integrationID) &&
    (body.sessionID === undefined || permission.sessionID === body.sessionID)
}

export async function listPermissions({ url, deps }: RouteContext): Promise<Response> {
  const selectedDirectory = selectedPermissionDirectory({ url, deps })
  if (selectedDirectory === null) return jsonError("INVALID_DIRECTORY", "Invalid directory", 400, CORS_HEADERS)

  // Permission IDs are only unique inside their integration/project/session
  // context. Never coalesce the global queues by raw ID.
  const queued = [...deps.permissionQueue.pending(), ...deps.codexPermissionQueue.pending()]
    .filter((permission) => isInDirectory(permission, selectedDirectory))
  const byIdentity = new Map(queued.map((permission) => [identity(permission), permission]))

  if (deps.attentionService && selectedDirectory) {
    try {
      const native = await deps.attentionService.listPermissions(selectedDirectory)
      for (const permission of native) {
        const item: PendingPermission = {
          permissionID: permission.id,
          createdAt: Date.now(),
          resolved: false,
          integrationID: "opencode",
          projectID: selectedDirectory,
          directory: selectedDirectory,
          title: permission.permission,
          sessionID: permission.sessionID,
          type: permission.permission,
          pattern: permission.patterns.join(" "),
          metadata: { ...permission.metadata, integrationID: "opencode", projectID: selectedDirectory, directory: selectedDirectory, sessionID: permission.sessionID },
        }
        if (!byIdentity.has(identity(item))) byIdentity.set(identity(item), item)
      }
    } catch (error) {
      deps.logger.warn("Could not list native OpenCode permissions", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return json([...byIdentity.values()], 200, CORS_HEADERS)
}

interface PermissionBody {
  action: "allow" | "deny"
  /** Supplied by current dashboards; absent only for backward-compatible clients. */
  integrationID?: string
  /** Prevents an old response from resolving another request with the same ID. */
  sessionID?: string
}

function validOptionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 256)
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
    return jsonError("INVALID_ACTION", "action must be 'allow' or 'deny'", 400, CORS_HEADERS)
  }
  if (!validOptionalString(body.integrationID) || !validOptionalString(body.sessionID)) {
    return jsonError("INVALID_PERMISSION_CONTEXT", "Permission context must contain valid identifiers", 400, CORS_HEADERS)
  }

  const selectedDirectory = selectedPermissionDirectory({ url, deps })
  if (selectedDirectory === null) return jsonError("INVALID_DIRECTORY", "Invalid directory", 400, CORS_HEADERS)

  const matches = [deps.permissionQueue, deps.codexPermissionQueue].flatMap((queue) =>
    queue.pending()
      .filter((permission) => matchesResponse(permission, params.id, selectedDirectory, body))
      .map((permission) => ({ queue, permission })),
  )
  if (matches.length > 1) {
    return jsonError("AMBIGUOUS_PERMISSION_ID", "Permission context matches multiple requests", 409, CORS_HEADERS)
  }

  if (matches.length === 1) {
    const match = matches[0]
    const context = completeContext(match.permission)
    const resolved = context
      ? match.queue.resolve(params.id, body.action, context)
      : match.queue.resolve(params.id, body.action)
    if (!resolved) {
      return jsonError("PERMISSION_NOT_FOUND", "Permission ID expired before it could be resolved", 404, CORS_HEADERS)
    }
    deps.audit.log("permission.responded", {
      permissionID: params.id,
      action: body.action,
      integrationID: match.permission.integrationID,
      projectID: match.permission.projectID,
      directory: match.permission.directory,
      sessionID: match.permission.sessionID,
    })
    return json({ ok: true }, 200, CORS_HEADERS)
  }

  // Native OpenCode attention remains directory-scoped. It may only be selected
  // by an OpenCode context, never by a raw ID belonging to another integration.
  if (deps.attentionService && selectedDirectory && (body.integrationID === undefined || body.integrationID === "opencode")) {
    try {
      const native = await deps.attentionService.listPermissions(selectedDirectory)
      const permission = native.find((item) => item.id === params.id && (body.sessionID === undefined || item.sessionID === body.sessionID))
      if (permission) {
        await deps.attentionService.replyPermission(
          params.id,
          body.action === "allow" ? "once" : "reject",
          selectedDirectory,
        )
        deps.audit.log("permission.responded", {
          permissionID: params.id,
          action: body.action,
          integrationID: "opencode",
          projectID: selectedDirectory,
          directory: selectedDirectory,
          sessionID: permission.sessionID,
        })
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

  return jsonError("PERMISSION_NOT_FOUND", "Permission ID not found or already resolved", 404, CORS_HEADERS)
}
