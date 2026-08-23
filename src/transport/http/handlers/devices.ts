import type { DeviceRole } from "../../../core/devices/store"
import { PilotError } from "../../../core/errors"
import { CORS_HEADERS } from "../middlewares/cors"
import { json, jsonError } from "../middlewares/json"
import type { RouteContext } from "../routes"

const PAIRING_TTL_MS = 5 * 60_000
const MAX_DEVICE_NAME_LENGTH = 80

function isRole(value: unknown): value is DeviceRole {
  return value === "read-only" || value === "interactive" || value === "operator" || value === "admin"
}

async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_DEVICE_NAME_LENGTH
}

function storeUnavailable(): Response {
  return jsonError("DEVICE_AUTH_UNAVAILABLE", "Device authentication is unavailable", 503, CORS_HEADERS)
}

export async function listDevices({ deps }: RouteContext): Promise<Response> {
  if (!deps.deviceStore) return storeUnavailable()
  return json({ devices: deps.deviceStore.list() }, 200, CORS_HEADERS)
}

export async function updateDevice({ req, params, deps }: RouteContext): Promise<Response> {
  if (!deps.deviceStore) return storeUnavailable()
  const body = await readObject(req)
  if (!body) return jsonError("INVALID_JSON", "Request body must be a JSON object", 400, CORS_HEADERS)
  const name = body.name
  const role = body.role
  if (name === undefined && role === undefined) {
    return jsonError("INVALID_DEVICE_UPDATE", "Provide name or role", 400, CORS_HEADERS)
  }
  if (name !== undefined && !validName(name)) {
    return jsonError("INVALID_DEVICE_NAME", `Device name must be between 1 and ${MAX_DEVICE_NAME_LENGTH} characters`, 400, CORS_HEADERS)
  }
  if (role !== undefined && !isRole(role)) {
    return jsonError("INVALID_DEVICE_ROLE", "Invalid device role", 400, CORS_HEADERS)
  }
  const device = deps.deviceStore.update(params.id, {
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(role !== undefined ? { role } : {}),
  })
  if (!device) return jsonError("DEVICE_NOT_FOUND", "Device not found", 404, CORS_HEADERS)
  deps.audit.log("device.updated", { deviceId: device.id, role: device.role })
  return json({ device }, 200, CORS_HEADERS)
}

export async function revokeDevice({ params, deps, principal }: RouteContext): Promise<Response> {
  if (!deps.deviceStore) return storeUnavailable()
  if (!deps.deviceStore.revoke(params.id)) {
    return jsonError("DEVICE_NOT_FOUND", "Device not found or already revoked", 404, CORS_HEADERS)
  }
  deps.audit.log("device.revoked", {
    deviceId: params.id,
    selfRevocation: principal?.kind === "device" && principal.id === params.id,
  })
  return json({ ok: true }, 200, CORS_HEADERS)
}

export async function createPairing({ req, deps, principal }: RouteContext): Promise<Response> {
  if (!deps.deviceStore) return storeUnavailable()
  const body = await readObject(req)
  if (!body) return jsonError("INVALID_JSON", "Request body must be a JSON object", 400, CORS_HEADERS)
  if (!isRole(body.role)) {
    return jsonError("INVALID_DEVICE_ROLE", "Pairing requires a valid device role", 400, CORS_HEADERS)
  }
  const pairing = deps.deviceStore.createPairing({ role: body.role, ttlMs: PAIRING_TTL_MS })
  deps.audit.log("pairing.created", {
    role: body.role,
    expiresAt: pairing.expiresAt,
    principalId: principal?.id,
  })
  return json({ pairingToken: pairing.token, expiresAt: pairing.expiresAt }, 201, CORS_HEADERS)
}

export async function redeemPairing({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.deviceStore) return storeUnavailable()
  const body = await readObject(req)
  if (!body) return jsonError("INVALID_JSON", "Request body must be a JSON object", 400, CORS_HEADERS)
  if (typeof body.pairingToken !== "string" || !validName(body.name)) {
    return jsonError("INVALID_PAIRING_REQUEST", "Pairing token and device name are required", 400, CORS_HEADERS)
  }
  try {
    const issued = deps.deviceStore.redeemPairing({
      token: body.pairingToken,
      name: body.name.trim(),
    })
    if (!issued) return jsonError("PAIRING_REJECTED", "Pairing token is invalid, expired, or already used", 401, CORS_HEADERS)
    deps.audit.log("pairing.redeemed", { deviceId: issued.device.id, role: issued.device.role })
    return json(issued, 201, CORS_HEADERS)
  } catch (error) {
    if (error instanceof PilotError) {
      return jsonError(error.code, error.message, error.httpStatus, CORS_HEADERS)
    }
    throw error
  }
}
