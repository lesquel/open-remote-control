// paths.ts — XDG-aware path helpers for the TUI and CLI.
//
// This file intentionally duplicates the logic from src/infra/paths/index.ts.
// Reason: the TUI and CLI run in a different deployment context from the server
// plugin. Importing across that boundary would create a hard coupling that
// breaks when the two modules are loaded in separate Bun instances or bundled
// independently. Keeping the logic here ensures the TUI/CLI remain self-contained.

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
