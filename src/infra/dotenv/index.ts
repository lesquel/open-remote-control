// dotenv.ts — minimal .env loader (no deps).
//
// OpenCode does not automatically load the plugin's .env into process.env,
// so the plugin has to do it itself. We search several plausible locations
// and merge into process.env without overwriting variables that are already
// set (so explicit env vars from the shell still win).
//
// Search order:
//   1. process.cwd()/.env
//   2. plugin install dir / .env (resolved relative to this file)
//   3. plugin install dir's parent / .env (when running via `bun src/server/index.ts`)
//
// Returns the path of the file that was loaded (or null if none).

import { existsSync } from "node:fs"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface DotenvResult {
  loaded: string | null
  applied: string[]
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let val = line.slice(eq + 1).trim()
    // Strip surrounding quotes (single or double)
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function pluginDir(): string {
  // src/infra/dotenv/index.ts → plugin root is 3 levels up
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "..", "..", "..")
}

export function loadDotEnv(): DotenvResult {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(pluginDir(), ".env"),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch {
      continue
    }
    const parsed = parseEnv(text)
    const applied: string[] = []
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v
        applied.push(k)
      }
    }
    return { loaded: path, applied }
  }
  return { loaded: null, applied: [] }
}
