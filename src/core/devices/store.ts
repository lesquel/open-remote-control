import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import type { Logger } from "../../infra/logger/index"
import { writePrivateFile } from "../../infra/fs/private-file"
import { stateFile } from "../../infra/paths/index"
import { PilotError } from "../errors"

const DEVICE_STATE_VERSION = 1
const DEVICE_CREDENTIAL_PREFIX = "pd1"
const PAIRING_TOKEN_PREFIX = "pp1"
const MAX_DEVICE_NAME_LENGTH = 80
const MAX_PAIRINGS = 16
const MAX_PAIRING_TTL_MS = 10 * 60_000
const LAST_ACTIVE_WRITE_INTERVAL_MS = 60_000

export type DeviceRole = "read-only" | "interactive" | "operator" | "admin"

export type DeviceCapability =
  | "status.read"
  | "sessions.read"
  | "sessions.write"
  | "prompts.send"
  | "permissions.read"
  | "permissions.approve"
  | "permissions.deny"
  | "files.read"
  | "diff.read"
  | "notifications.manage"
  | "settings.read"
  | "settings.write"
  | "devices.manage"
  | "auth.rotate"

const READ_ONLY_CAPABILITIES: readonly DeviceCapability[] = [
  "status.read",
  "sessions.read",
  "permissions.read",
  "files.read",
  "diff.read",
  "settings.read",
  "notifications.manage",
]

const INTERACTIVE_CAPABILITIES: readonly DeviceCapability[] = [
  ...READ_ONLY_CAPABILITIES,
  "sessions.write",
  "prompts.send",
]

const OPERATOR_CAPABILITIES: readonly DeviceCapability[] = [
  ...INTERACTIVE_CAPABILITIES,
  "permissions.approve",
  "permissions.deny",
]

const ADMIN_CAPABILITIES: readonly DeviceCapability[] = [
  ...OPERATOR_CAPABILITIES,
  "settings.write",
  "devices.manage",
  "auth.rotate",
]

export function capabilitiesForRole(role: DeviceRole): readonly DeviceCapability[] {
  switch (role) {
    case "read-only": return [...READ_ONLY_CAPABILITIES]
    case "interactive": return [...INTERACTIVE_CAPABILITIES]
    case "operator": return [...OPERATOR_CAPABILITIES]
    case "admin": return [...ADMIN_CAPABILITIES]
  }
}

export interface Device {
  id: string
  name: string
  role: DeviceRole
  capabilities: readonly DeviceCapability[]
  createdAt: number
  lastActiveAt: number
  expiresAt: number | null
  revokedAt: number | null
}

interface StoredDevice {
  id: string
  name: string
  role: DeviceRole
  tokenHash: string
  createdAt: number
  lastActiveAt: number
  expiresAt: number | null
  revokedAt: number | null
}

interface StoredDeviceState {
  version: typeof DEVICE_STATE_VERSION
  devices: StoredDevice[]
}

interface PendingPairing {
  tokenHash: string
  role: DeviceRole
  expiresAt: number
  createdAt: number
}

export interface IssuedDevice {
  device: Device
  credential: string
}

export interface DeviceStore {
  issue(input: { name: string; role: DeviceRole; expiresAt?: number | null }): IssuedDevice
  authenticate(credential: string): Device | null
  list(): Device[]
  update(id: string, patch: { name?: string; role?: DeviceRole }): Device | null
  revoke(id: string): boolean
  createPairing(input: { role: DeviceRole; ttlMs: number }): { token: string; expiresAt: number }
  redeemPairing(input: { token: string; name: string }): IssuedDevice | null
  filePath(): string
}

export interface DeviceStoreDeps {
  logger: Logger
  filePath?: string
  now?: () => number
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

function hashesEqual(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
}

function isRole(value: unknown): value is DeviceRole {
  return value === "read-only" || value === "interactive" || value === "operator" || value === "admin"
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function nullableTimestamp(value: unknown): value is number | null {
  return value === null || finiteTimestamp(value)
}

function sanitizeName(name: string): string {
  const sanitized = name.trim()
  if (sanitized.length === 0 || sanitized.length > MAX_DEVICE_NAME_LENGTH) {
    throw new PilotError(
      "INVALID_DEVICE_NAME",
      `Device name must be between 1 and ${MAX_DEVICE_NAME_LENGTH} characters`,
      400,
    )
  }
  return sanitized
}

function sanitizeStoredDevice(value: unknown): StoredDevice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string" || record.id.length === 0 || record.id.length > 128 ||
    typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > MAX_DEVICE_NAME_LENGTH ||
    !isRole(record.role) ||
    typeof record.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
    !finiteTimestamp(record.createdAt) ||
    !finiteTimestamp(record.lastActiveAt) ||
    !nullableTimestamp(record.expiresAt) ||
    !nullableTimestamp(record.revokedAt)
  ) return null

  return {
    id: record.id,
    name: record.name.trim(),
    role: record.role,
    tokenHash: record.tokenHash,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  }
}

function publicDevice(device: StoredDevice): Device {
  return {
    id: device.id,
    name: device.name,
    role: device.role,
    capabilities: capabilitiesForRole(device.role),
    createdAt: device.createdAt,
    lastActiveAt: device.lastActiveAt,
    expiresAt: device.expiresAt,
    revokedAt: device.revokedAt,
  }
}

function parseCredential(credential: string): { id: string; secret: string } | null {
  const parts = credential.split(".")
  if (parts.length !== 3 || parts[0] !== DEVICE_CREDENTIAL_PREFIX) return null
  const [, id, secret] = parts
  if (!id || id.length > 128 || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null
  return { id, secret }
}

export function createDeviceStore(deps: DeviceStoreDeps): DeviceStore {
  const path = deps.filePath ?? stateFile("devices.json")
  const now = deps.now ?? Date.now
  const devices = new Map<string, StoredDevice>()
  const pairings = new Map<string, PendingPairing>()
  let futureVersion: number | null = null

  function load(): void {
    if (!existsSync(path)) return
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new PilotError("INVALID_DEVICE_STATE", "Device state must be an object")
      }
      const record = parsed as Record<string, unknown>
      if (typeof record.version === "number" && record.version > DEVICE_STATE_VERSION) {
        futureVersion = record.version
        deps.logger.warn("device-store: unsupported future state version; preserving file", {
          version: record.version,
          path,
        })
        return
      }
      if (record.version !== DEVICE_STATE_VERSION || !Array.isArray(record.devices)) {
        throw new PilotError("INVALID_DEVICE_STATE", "Device state has an unsupported schema")
      }
      for (const candidate of record.devices) {
        const device = sanitizeStoredDevice(candidate)
        if (device) devices.set(device.id, device)
      }
    } catch (error) {
      deps.logger.warn("device-store: failed to read, treating as empty", {
        path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function persist(): void {
    if (futureVersion !== null) {
      throw new PilotError(
        "UNSUPPORTED_DEVICE_STATE_VERSION",
        `Cannot overwrite unsupported device state version ${futureVersion}`,
        409,
      )
    }
    const state: StoredDeviceState = {
      version: DEVICE_STATE_VERSION,
      devices: [...devices.values()],
    }
    writePrivateFile(path, `${JSON.stringify(state, null, 2)}\n`)
  }

  function issue(input: { name: string; role: DeviceRole; expiresAt?: number | null }): IssuedDevice {
    if (!isRole(input.role)) throw new PilotError("INVALID_DEVICE_ROLE", "Invalid device role", 400)
    const timestamp = now()
    const expiresAt = input.expiresAt ?? null
    if (expiresAt !== null && (!finiteTimestamp(expiresAt) || expiresAt <= timestamp)) {
      throw new PilotError("INVALID_DEVICE_EXPIRY", "Device expiry must be in the future", 400)
    }
    const id = randomUUID()
    const secret = randomBytes(32).toString("base64url")
    const stored: StoredDevice = {
      id,
      name: sanitizeName(input.name),
      role: input.role,
      tokenHash: hashSecret(secret),
      createdAt: timestamp,
      lastActiveAt: timestamp,
      expiresAt,
      revokedAt: null,
    }
    devices.set(id, stored)
    try {
      persist()
    } catch (error) {
      devices.delete(id)
      throw error
    }
    return { device: publicDevice(stored), credential: `${DEVICE_CREDENTIAL_PREFIX}.${id}.${secret}` }
  }

  function authenticate(credential: string): Device | null {
    const parsed = parseCredential(credential)
    if (!parsed) return null
    const device = devices.get(parsed.id)
    const timestamp = now()
    if (!device || device.revokedAt !== null || (device.expiresAt !== null && device.expiresAt <= timestamp)) {
      return null
    }
    if (!hashesEqual(hashSecret(parsed.secret), device.tokenHash)) return null

    if (timestamp - device.lastActiveAt >= LAST_ACTIVE_WRITE_INTERVAL_MS) {
      device.lastActiveAt = timestamp
      try {
        persist()
      } catch (error) {
        deps.logger.warn("device-store: failed to persist last activity", {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return publicDevice(device)
  }

  function list(): Device[] {
    return [...devices.values()]
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(publicDevice)
  }

  function revoke(id: string): boolean {
    const device = devices.get(id)
    if (!device || device.revokedAt !== null) return false
    device.revokedAt = now()
    try {
      persist()
      return true
    } catch (error) {
      device.revokedAt = null
      throw error
    }
  }

  function update(id: string, patch: { name?: string; role?: DeviceRole }): Device | null {
    const device = devices.get(id)
    if (!device || device.revokedAt !== null) return null
    const previous = { ...device }
    if (patch.name !== undefined) device.name = sanitizeName(patch.name)
    if (patch.role !== undefined) {
      if (!isRole(patch.role)) throw new PilotError("INVALID_DEVICE_ROLE", "Invalid device role", 400)
      device.role = patch.role
    }
    try {
      persist()
      return publicDevice(device)
    } catch (error) {
      devices.set(id, previous)
      throw error
    }
  }

  function prunePairings(timestamp: number): void {
    for (const [key, pairing] of pairings) {
      if (pairing.expiresAt <= timestamp) pairings.delete(key)
    }
    while (pairings.size >= MAX_PAIRINGS) {
      const oldest = [...pairings.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
      if (!oldest) break
      pairings.delete(oldest[0])
    }
  }

  function createPairing(input: { role: DeviceRole; ttlMs: number }): { token: string; expiresAt: number } {
    if (!isRole(input.role)) throw new PilotError("INVALID_DEVICE_ROLE", "Invalid device role", 400)
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_PAIRING_TTL_MS) {
      throw new PilotError("INVALID_PAIRING_TTL", "Pairing TTL must be between 1 ms and 10 minutes", 400)
    }
    const timestamp = now()
    prunePairings(timestamp)
    const secret = randomBytes(32).toString("base64url")
    const token = `${PAIRING_TOKEN_PREFIX}.${secret}`
    const tokenHash = hashSecret(token)
    const expiresAt = timestamp + input.ttlMs
    pairings.set(tokenHash, { tokenHash, role: input.role, createdAt: timestamp, expiresAt })
    return { token, expiresAt }
  }

  function redeemPairing(input: { token: string; name: string }): IssuedDevice | null {
    const timestamp = now()
    prunePairings(timestamp)
    if (!/^pp1\.[A-Za-z0-9_-]{43}$/.test(input.token)) return null
    const key = hashSecret(input.token)
    const pairing = pairings.get(key)
    if (!pairing || pairing.expiresAt <= timestamp || !hashesEqual(key, pairing.tokenHash)) return null
    pairings.delete(key)
    return issue({ name: input.name, role: pairing.role })
  }

  function filePath(): string {
    return path
  }

  load()
  return { issue, authenticate, list, update, revoke, createPairing, redeemPairing, filePath }
}
