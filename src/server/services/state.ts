import { dirname, join } from "path"
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "fs"
import { stateFile } from "../util/paths"

/** Controls when per-project files are written to `<directory>/.opencode/`.
 *  - `off`:    Never write per-project files. Global writes are unaffected.
 *  - `auto`:   Write per-project files only when `.opencode/` already exists.
 *  - `always`: Always write per-project files, creating `.opencode/` if needed.
 */
export type ProjectStateMode = "off" | "auto" | "always"

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
  return stateFile("pilot-state.json")
}

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

function safeMkdir(path: string) {
  try {
    mkdirSync(path, { recursive: true })
  } catch {
    // ignore — best-effort; writeFile below will surface a clearer error
  }
}

/**
 * Per-path write outcome. `ok:false` callers can surface `error` to the user
 * (or the OpenCode log panel) so silent ENOENT / EACCES on `~/.opencode-pilot/`
 * stop looking like "server not running" in the TUI.
 */
export interface WriteOutcome {
  path: string
  ok: boolean
  error?: string
}

/**
 * Structured dual-write result. Before 1.13.13 writeState returned `void` and
 * every error was swallowed silently — a user with an unwritable
 * `~/.opencode-pilot/` directory saw no evidence of the problem, only the
 * TUI toast saying the server was not running. This shape lets the caller
 * (`activatePrimary`) log a clear diagnostic when either path fails.
 */
export interface WriteStateResult {
  /** null when `directory` was invalid and we could not even compute the project path. */
  project: WriteOutcome | null
  global: WriteOutcome
}

function writeOne(path: string, content: string): WriteOutcome {
  try {
    safeMkdir(dirname(path))
    writeFileSync(path, content)
    return { path, ok: true }
  } catch (err) {
    return { path, ok: false, error: (err as Error)?.message ?? String(err) }
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

/**
 * Best-effort dual write. Each path is isolated — an invalid `directory`
 * (undefined, empty, or something `join` refuses) no longer aborts the global
 * write, which is the one the TUI reads as of 1.13.x. Returns a
 * {@link WriteStateResult} so callers can log/act on partial failures.
 *
 * @param mode Controls per-project writes. Defaults to `"auto"` so existing
 *   call sites (tests, token rotation) continue to work without changes.
 *   Pass `config.projectStateMode` from index.ts to respect user intent.
 */
export function writeState(
  directory: string,
  state: PilotState,
  mode: ProjectStateMode = "auto",
): WriteStateResult {
  const json = JSON.stringify(state, null, 2)

  let project: WriteOutcome | null = null

  if (shouldWriteProjectState(directory, mode)) {
    try {
      // projectStatePath can throw if directory is falsy or not a string in a
      // future OpenCode SDK change. We isolate the failure so the global write
      // below still runs — the TUI reads the global file, so that's the one
      // that matters.
      const ppath = projectStatePath(directory)
      project = writeOne(ppath, json)
    } catch (err) {
      project = {
        path: "<invalid-directory>",
        ok: false,
        error: (err as Error)?.message ?? String(err),
      }
    }
  }

  const global = writeOne(globalStatePath(), json)

  return { project, global }
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
