// ─── Path helpers ─────────────────────────────────────────────────────────────
// Cross-platform config and state directory resolution for opencode-pilot.
// Respects XDG_CONFIG_HOME / XDG_STATE_HOME on Linux/macOS and APPDATA /
// LOCALAPPDATA on Windows.

import { homedir } from "node:os"
import { join } from "node:path"
import { platform } from "node:process"
import { existsSync } from "fs"

export const PLUGIN_DIR_NAME = ".opencode-pilot"

export function getPluginConfigDir(): string {
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    return join(appData, "opencode-pilot")
  }
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return join(xdg, "opencode-pilot")
  return join(homedir(), PLUGIN_DIR_NAME)
}

export function getPluginStateDir(): string {
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(local, "opencode-pilot")
  }
  const xdg = process.env.XDG_STATE_HOME
  if (xdg) return join(xdg, "opencode-pilot")
  return join(homedir(), PLUGIN_DIR_NAME)
}

export function configFile(name: string): string {
  return join(getPluginConfigDir(), name)
}

export function stateFile(name: string): string {
  return join(getPluginStateDir(), name)
}

// ─── Project-state gating ──────────────────────────────────────────────────────
// Moved here from core/state/store.ts so infra/ modules (banner/writer.ts) can
// use these helpers without importing from core/ (which would violate the
// "infra is the absolute bottom" dependency rule).

/** Controls when per-project files are written to `<directory>/.opencode/`.
 *  - `off`:    Never write per-project files. Global writes are unaffected.
 *  - `auto`:   Write per-project files only when `.opencode/` already exists.
 *  - `always`: Always write per-project files, creating `.opencode/` if needed.
 */
export type ProjectStateMode = "off" | "auto" | "always"

/**
 * Decide whether per-project files should be written to `<directory>/.opencode/`.
 * - `off`:    Always returns false (skip project writes entirely).
 * - `always`: Always returns true (create `.opencode/` if absent).
 * - `auto`:   Returns true only when `<directory>/.opencode/` already exists.
 *             Never creates the directory as a side effect.
 */
export function shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean {
  if (mode === "off") return false
  if (mode === "always") return true
  // auto: only write if the directory is a valid non-empty string and .opencode/ exists
  if (typeof directory !== "string" || directory.length === 0) return false
  return existsSync(join(directory, ".opencode"))
}
