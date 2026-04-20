import { dirname, join } from "path"
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "fs"
import { homedir } from "os"

export interface PilotState {
  token: string
  port: number
  host: string
  startedAt: number
  pid: number
}

// Per-project state file. Written for backward compat and for tooling that
// looks at project-scoped state. TUI no longer relies on this because
// process.cwd() in the TUI plugin doesn't necessarily match the server's
// ctx.directory (different projects can open different instances, and
// workspaces like `~/Desktop` usually don't have a `.opencode/` folder at
// all — in which case the bare writeFileSync used to ENOENT and silently
// break the whole server boot).
function projectStatePath(directory: string): string {
  return join(directory, ".opencode", "pilot-state.json")
}

// Global state file. The pilot HTTP server binds to a single port (4097 by
// default), so there is at most one running server per machine. Writing the
// current state to a predictable global location lets the TUI plugin —
// which may be running with a different cwd than the server plugin — read
// it without guessing the workspace path.
export function globalStatePath(): string {
  return join(homedir(), ".opencode-pilot", "pilot-state.json")
}

function safeMkdir(path: string) {
  try {
    mkdirSync(path, { recursive: true })
  } catch {
    // ignore — best-effort; writeFile below will surface a clearer error
  }
}

function safeWrite(path: string, content: string): boolean {
  try {
    safeMkdir(dirname(path))
    writeFileSync(path, content)
    return true
  } catch {
    return false
  }
}

function safeRead(path: string): PilotState | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PilotState
  } catch {
    return null
  }
}

export function writeState(directory: string, state: PilotState): void {
  const json = JSON.stringify(state, null, 2)
  // Best-effort dual write. If the project .opencode/ dir can't be created
  // (permissions, read-only FS, etc.) we still succeed on the global path,
  // which is what the TUI reads anyway.
  safeWrite(projectStatePath(directory), json)
  safeWrite(globalStatePath(), json)
}

/**
 * Update the token in an existing state file (used by token rotation).
 * If the state file doesn't exist, creates it with the new token and the
 * provided fallback values.
 */
export function updateStateToken(directory: string, newToken: string): void {
  const existing = readState(directory)
  if (existing) {
    writeState(directory, { ...existing, token: newToken })
  }
}

export function readState(directory: string): PilotState | null {
  // Prefer the project path for callers that know the workspace (the server
  // itself). Fall back to the global file for completeness.
  return safeRead(projectStatePath(directory)) ?? safeRead(globalStatePath())
}

/**
 * Read the state from the canonical global location. Used by the TUI plugin
 * which doesn't reliably know the workspace directory.
 */
export function readGlobalState(): PilotState | null {
  return safeRead(globalStatePath())
}

export function clearState(directory: string): void {
  for (const path of [projectStatePath(directory), globalStatePath()]) {
    try {
      unlinkSync(path)
    } catch {
      // already gone or never written
    }
  }
}
