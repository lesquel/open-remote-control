import { join } from "path"
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "fs"

export interface PilotState {
  token: string
  port: number
  host: string
  startedAt: number
  pid: number
}

function getStatePath(directory: string): string {
  return join(directory, ".opencode", "pilot-state.json")
}

export function writeState(directory: string, state: PilotState): void {
  const path = getStatePath(directory)
  writeFileSync(path, JSON.stringify(state, null, 2))
}

export function readState(directory: string): PilotState | null {
  const path = getStatePath(directory)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PilotState
  } catch {
    return null
  }
}

export function clearState(directory: string): void {
  const path = getStatePath(directory)
  try {
    unlinkSync(path)
  } catch {}
}
