import { chmodSync, existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { arch, platform } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

const PACKAGE_NAME = "@lesquel/opencode-pilot"
const PILOT_ENTRY = /(^|\/)opencode-pilot(@|\/|$)/i

interface RuntimeState {
  host?: unknown
  port?: unknown
  token?: unknown
}

interface BundleOptions {
  configDir: string
  statePath: string
  packageVersion: string
  fetchImpl?: FetchLike
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function parseObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function pluginRegistered(configDir: string, filename: string): boolean {
  const config = parseObject(join(configDir, filename))
  return Array.isArray(config?.plugin) && config.plugin.some(
    (entry) => typeof entry === "string" && PILOT_ENTRY.test(entry),
  )
}

function normalizeLoopbackHost(value: unknown): string {
  if (value === "0.0.0.0" || value === "::") return "127.0.0.1"
  return typeof value === "string" && value ? value : "127.0.0.1"
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : null
}

function safeRuntimeSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const pilot = record(data.pilot)
  const pilotRuntime = record(pilot.runtime)
  const listener = record(data.listener)
  const tunnel = record(listener.tunnel)
  const runtime = record(data.runtime)
  const sdk = record(runtime.sdk)
  const sessions = record(runtime.sessions)
  const notifications = record(runtime.notifications)
  const devices = record(runtime.devices)
  const auth = record(data.authentication)
  const sources = record(record(data.configuration).sources)
  const safeSources = Object.fromEntries(Object.entries(sources).flatMap(([key, source]) =>
    typeof source === "string" && ["default", "shell-env", "settings-store", "env-file"].includes(source)
      ? [[key, source]]
      : [],
  ))
  const errors = Array.isArray(data.recentErrors) ? data.recentErrors : []
  const components = Array.from(new Set(errors.flatMap((error) => {
    if (!error || typeof error !== "object") return []
    const component = (error as Record<string, unknown>).component
    return typeof component === "string" ? [component] : []
  }))).slice(0, 20)

  return {
    pilot: {
      version: scalar(pilot.version),
      uptimeSeconds: scalar(pilot.uptimeSeconds),
      runtime: { name: scalar(pilotRuntime.name), version: scalar(pilotRuntime.version) },
    },
    listener: {
      port: scalar(listener.port),
      tunnel: { provider: scalar(tunnel.provider), status: scalar(tunnel.status) },
    },
    authentication: { kind: scalar(auth.kind), role: scalar(auth.role) },
    runtime: {
      sdk: { status: scalar(sdk.status), version: scalar(sdk.version) },
      sseClients: scalar(runtime.sseClients),
      pendingPermissions: scalar(runtime.pendingPermissions),
      sessions: { total: scalar(sessions.total), active: scalar(sessions.active) },
      integrations: Array.isArray(runtime.integrations)
        ? runtime.integrations.filter((item): item is string => typeof item === "string").slice(0, 20)
        : [],
      notifications: {
        telegram: scalar(notifications.telegram),
        push: scalar(notifications.push),
        pushSubscriptions: scalar(notifications.pushSubscriptions),
      },
      devices: { total: scalar(devices.total) },
    },
    configuration: { sources: safeSources },
    recentErrorSummary: { count: errors.length, components },
  }
}

async function fetchRuntimeDiagnostics(
  state: RuntimeState | null,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown> | null> {
  if (!state || typeof state.port !== "number" || typeof state.token !== "string") return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_000)
  try {
    const host = normalizeLoopbackHost(state.host)
    const response = await fetchImpl(`http://${host}:${state.port}/diagnostics`, {
      headers: { Authorization: `Bearer ${state.token}` },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return safeRuntimeSnapshot(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function buildSupportBundle(options: BundleOptions): Promise<Record<string, unknown>> {
  const packagePath = join(options.configDir, "node_modules", PACKAGE_NAME, "package.json")
  const installedPackage = parseObject(packagePath)
  const state = parseObject(options.statePath) as RuntimeState | null
  const settingsPath = join(dirname(options.statePath), "config.json")
  const settingsExists = existsSync(settingsPath)
  const settingsReadable = !settingsExists || parseObject(settingsPath) !== null

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: {
      runningVersion: options.packageVersion,
      installed: installedPackage !== null,
      installedVersion: typeof installedPackage?.version === "string" ? installedPackage.version : null,
    },
    platform: { os: platform(), arch: arch() },
    runtime: { bun: Bun.version, node: process.versions.node },
    installation: {
      configDirectoryExists: existsSync(options.configDir),
      serverPluginRegistered: pluginRegistered(options.configDir, "opencode.json"),
      tuiPluginRegistered: pluginRegistered(options.configDir, "tui.json"),
      stateFile: { exists: existsSync(options.statePath), readable: state !== null },
      settingsFile: { exists: settingsExists, readable: settingsReadable },
    },
    liveDiagnostics: await fetchRuntimeDiagnostics(state, options.fetchImpl ?? fetch),
  }
}

export function writePrivateBundle(path: string, bundle: Record<string, unknown>): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing file: ${path}`)
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(bundle, null, 2) + "\n", { mode: 0o600, flag: "wx" })
  try {
    if (platform() !== "win32") chmodSync(temporary, 0o600)
    // Linking a complete temporary inode publishes atomically and fails if a
    // concurrent process created the destination after the existsSync check.
    linkSync(temporary, path)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* best-effort temporary cleanup */ }
    throw error
  }
  try { unlinkSync(temporary) } catch { /* final bundle is already safely published */ }
}
