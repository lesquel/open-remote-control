// ─── Path helpers ─────────────────────────────────────────────────────────────
// Cross-platform config and state directory resolution for opencode-pilot.
// Respects XDG_CONFIG_HOME / XDG_STATE_HOME on Linux/macOS and APPDATA /
// LOCALAPPDATA on Windows.

import { homedir } from "node:os"
import { join } from "node:path"
import { platform } from "node:process"

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
