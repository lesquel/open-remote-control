#!/usr/bin/env bun
// init.ts — One-command installer for opencode-pilot.
//
// Usage: npx @lesquel/opencode-pilot init
//        bunx @lesquel/opencode-pilot init
//
// What it does (v1.13+):
//   1. Locate the user's OpenCode config dir (XDG_CONFIG_HOME / ~/.config/opencode / etc.)
//   2. Ensure the @lesquel/opencode-pilot package is installed there (npm/bun add @latest)
//   3. Add a SINGLE spec "@lesquel/opencode-pilot@latest" to opencode.json::plugin.
//      OpenCode's loader reads package.json::exports ("./server" and "./tui")
//      and wires BOTH the server (dashboard) and the tui (slash commands)
//      from the same npm spec. No wrappers needed.
//   4. CLEANUP: remove stale wrappers and stale subpath entries left behind
//      by earlier (<=1.12.x) installs, which caused:
//        - duplicate server start (port 4097 collision)
//        - TUI wrapper rejected by OpenCode's server loader
//        - stray "@lesquel/opencode-pilot/tui" npm spec that never resolved
//   5. Invalidate OpenCode's package cache for our plugin so it re-fetches
//      the new version on next launch.
//
// This is intentionally a single file with no dependencies beyond node:fs/os/path
// and node:child_process, so it works the second the user runs `npx`.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const PACKAGE_NAME = "@lesquel/opencode-pilot"

// Files left behind by v1.11.x–v1.12.x installs. We remove them on every
// re-run so upgraded installs don't keep loading duplicate plugins.
const STALE_WRAPPER_FILENAMES = ["opencode-pilot.ts", "opencode-pilot-tui.ts"]

interface InitResult {
  configDir: string
  cleanedWrappers: string[]
  cleanedCache: string[]
  installed: boolean
  installer: string | null
  serverConfigChanged: boolean
  tuiConfigChanged: boolean
}

function locateOpencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return join(xdg, "opencode")
  if (platform() === "win32") {
    const appdata = process.env.APPDATA
    if (appdata) return join(appdata, "opencode")
  }
  return join(homedir(), ".config", "opencode")
}

// OpenCode caches resolved npm plugin packages here. When the user upgrades
// our package, the cache must be invalidated or the TUI loader keeps loading
// the old version. Best-effort: we just remove our package's subtree.
function locateOpencodeCacheDirs(): string[] {
  const paths: string[] = []
  const xdgCache = process.env.XDG_CACHE_HOME
  if (xdgCache) paths.push(join(xdgCache, "opencode", "packages"))
  if (platform() === "darwin") {
    paths.push(join(homedir(), "Library", "Caches", "opencode", "packages"))
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) paths.push(join(localAppData, "opencode", "packages"))
  }
  paths.push(join(homedir(), ".cache", "opencode", "packages"))
  return Array.from(new Set(paths))
}

function detectInstaller(configDir: string): string | null {
  if (existsSync(join(configDir, "bun.lock"))) return "bun"
  if (existsSync(join(configDir, "package-lock.json"))) return "npm"
  if (which("bun")) return "bun"
  if (which("npm")) return "npm"
  return null
}

function which(cmd: string): boolean {
  const r = spawnSync(platform() === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
  })
  return r.status === 0
}

// Detect whether an OpenCode process is currently running on this machine.
// We use this to refuse cache deletion while the plugin is live — the plugin
// reads dashboard files (sw.js, sse.js, etc.) from the cache on every HTTP
// request, so wiping the cache mid-flight produces a 404 storm and leaves
// the user's browser pinned to whatever it cached previously.
function isOpencodeRunning(): boolean {
  if (platform() === "win32") {
    const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq opencode.exe"], {
      encoding: "utf8",
    })
    return r.stdout?.toLowerCase().includes("opencode.exe") ?? false
  }
  const r = spawnSync("pgrep", ["-f", "opencode"], { stdio: "pipe" })
  return r.status === 0
}

function ensurePackageInstalled(configDir: string, installer: string): boolean {
  const pkgPath = join(configDir, "node_modules", PACKAGE_NAME, "package.json")

  // Need a package.json in configDir for the installer to work
  const cfgPkgPath = join(configDir, "package.json")
  if (!existsSync(cfgPkgPath)) {
    writeFileSync(
      cfgPkgPath,
      JSON.stringify({ private: true, dependencies: {} }, null, 2) + "\n",
    )
  }

  // Always pin @latest so re-running init upgrades a stale install. Without
  // this, bun add / npm install of an already-installed package is a no-op
  // and users miss our new releases.
  //
  // We also bump @opencode-ai/plugin to @latest because OpenCode releases
  // new SDK versions frequently (1.3 → 1.14 in a short period) and a stale
  // SDK in node_modules makes our plugin fail silently at TUI load time.
  const specs = [`${PACKAGE_NAME}@latest`, `@opencode-ai/plugin@latest`]
  const args = installer === "bun" ? ["add", ...specs] : ["install", ...specs]
  const r = spawnSync(installer, args, { cwd: configDir, stdio: "inherit" })
  if (r.status !== 0) {
    console.error(`\n${installer} ${args.join(" ")} failed (exit ${r.status})`)
    return false
  }
  return existsSync(pkgPath)
}

// Remove stale wrapper files from <configDir>/plugins/. Earlier installs
// (<=1.12.x) wrote these because we assumed a TUI wrapper was needed. But
// OpenCode's server-plugin loader validates EVERY file under plugins/ as a
// server plugin, so a TUI wrapper re-exporting {id, tui} gets rejected with
// "must default export an object with server()". Plus the server wrapper
// collided with the npm-spec load, causing "port 4097 in use".
function cleanupStaleWrappers(configDir: string): string[] {
  const pluginsDir = join(configDir, "plugins")
  if (!existsSync(pluginsDir)) return []
  const removed: string[] = []
  for (const filename of STALE_WRAPPER_FILENAMES) {
    const target = join(pluginsDir, filename)
    if (!existsSync(target)) continue
    try {
      rmSync(target, { force: true })
      removed.push(target)
    } catch {
      // Best-effort — user can delete manually if perms block us.
    }
  }
  return removed
}

// Remove our stale cache from OpenCode's package cache so the next launch
// re-fetches the new version from npm. Without this, OpenCode may keep
// serving a previously cached version even after `bun add @latest` updated
// the node_modules copy.
//
// OpenCode stores each npm plugin by the FULL spec string, so the cached
// directory for "@lesquel/opencode-pilot@latest" lives at
// "<cache>/@lesquel/opencode-pilot@latest" (spec suffix included). Same
// for pinned variants like "@latest", "@1.12.7", or broken subpath
// attempts like "/tui". We enumerate the "@lesquel/" dir and nuke every
// directory whose name starts with "opencode-pilot" to cover all variants
// in one pass.
function cleanupStaleCache(cacheDirs: string[]): string[] {
  const [scope, basePkg] = PACKAGE_NAME.split("/") // ["@lesquel", "opencode-pilot"]
  const removed: string[] = []
  for (const cacheDir of cacheDirs) {
    const scopeDir = join(cacheDir, scope)
    if (!existsSync(scopeDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(scopeDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      // Match any variant: plain name, "@version", "@latest", "/tui", etc.
      if (entry !== basePkg && !entry.startsWith(`${basePkg}@`) && !entry.startsWith(`${basePkg}/`)) {
        continue
      }
      const target = join(scopeDir, entry)
      try {
        rmSync(target, { recursive: true, force: true })
        removed.push(target)
      } catch {
        // Best-effort — user can delete manually if perms block us.
      }
    }
  }
  return removed
}

// OpenCode uses TWO separate config files for plugins:
//   - opencode.json::plugin → read by the server-plugin loader
//     (src/plugin/index.ts). Handles `server(ctx)` exports.
//   - tui.json::plugin → read by the TUI-plugin loader
//     (src/cli/cmd/tui/plugin/runtime.ts). Handles `tui(api)` exports.
//
// Having a spec in ONE is not enough: the server loader doesn't register
// slash commands, and the TUI loader doesn't spin up the HTTP server.
// Our plugin ships BOTH (`exports["./server"]` and `exports["./tui"]`),
// so we write our canonical spec into BOTH configs. OpenCode's shared
// loader then picks the right entrypoint per-config based on kind.
const CANONICAL_SPEC = `${PACKAGE_NAME}@latest`
const STALE_ENTRY_REGEX = /(^|\/)opencode-pilot(@|\/|$)/i

function ensurePluginEntry(
  configDir: string,
  filename: string,
  schemaUrl: string,
): { changed: boolean; created?: boolean; warning?: string } {
  const cfgPath = join(configDir, filename)
  const exists = existsSync(cfgPath)

  let cfg: Record<string, unknown> = {}
  if (exists) {
    let raw: string
    try {
      raw = readFileSync(cfgPath, "utf8")
    } catch (err) {
      return { changed: false, warning: `could not read ${cfgPath}: ${err}` }
    }

    try {
      cfg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {
        changed: false,
        warning: `${cfgPath} is not valid JSON. Skipping; rerun after fixing it.`,
      }
    }
  }

  const existing = Array.isArray(cfg.plugin) ? (cfg.plugin as string[]) : []
  // Drop any stale opencode-pilot entry (subpath variants, pinned versions,
  // short names) so the canonical "@lesquel/opencode-pilot@latest" stays
  // the only one in the array.
  const next = existing.filter(
    (e) => typeof e !== "string" || !STALE_ENTRY_REGEX.test(e),
  )
  next.push(CANONICAL_SPEC)

  const sameAsBefore =
    exists &&
    existing.length === next.length &&
    existing.every((e, i) => e === next[i])
  if (sameAsBefore) return { changed: false }

  if (!exists && Object.keys(cfg).length === 0) {
    cfg = { $schema: schemaUrl, plugin: next }
  } else {
    cfg.plugin = next
  }

  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n")
  return { changed: true, created: !exists }
}

function main(): InitResult {
  console.log(`\n  ${PACKAGE_NAME} — installer\n`)

  const configDir = locateOpencodeConfigDir()
  console.log(`  OpenCode config dir: ${configDir}`)
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })

  const installer = detectInstaller(configDir)
  if (!installer) {
    console.error(
      "\n  Neither bun nor npm is on PATH. Install one of them and re-run this command.",
    )
    process.exit(1)
  }

  console.log(`  Using installer: ${installer}`)
  const installed = ensurePackageInstalled(configDir, installer)
  if (!installed) {
    console.error(`\n  Install failed. Try manually:`)
    console.error(`    cd ${configDir} && ${installer} add ${PACKAGE_NAME}`)
    process.exit(1)
  }

  const cleanedWrappers = cleanupStaleWrappers(configDir)
  for (const p of cleanedWrappers) {
    console.log(`  Removed stale wrapper: ${p}`)
  }

  // Cache cleanup is ONLY safe when OpenCode isn't running — the live plugin
  // reads dashboard assets from that same cache on every request. Deleting
  // it while OpenCode is alive produces a 404 storm on the dashboard until
  // the user restarts OpenCode. We refuse the delete and tell the user.
  let cleanedCache: string[] = []
  if (isOpencodeRunning()) {
    console.log(
      `  Skipped cache invalidation: OpenCode appears to be running.\n` +
        `  Fully quit OpenCode (pkill -f opencode / kill the window) and\n` +
        `  re-run \`npx @lesquel/opencode-pilot@latest init\` to flush the\n` +
        `  stale cache. Without this, OpenCode keeps loading a previously\n` +
        `  cached version of the plugin.`,
    )
  } else {
    cleanedCache = cleanupStaleCache(locateOpencodeCacheDirs())
    for (const p of cleanedCache) {
      console.log(`  Invalidated cache:  ${p}`)
    }
  }

  const serverCfg = ensurePluginEntry(
    configDir,
    "opencode.json",
    "https://opencode.ai/config.json",
  )
  if (serverCfg.changed) {
    console.log(
      `  Updated opencode.json plugin array (for dashboard server)` +
        (serverCfg.created ? " [created]" : ""),
    )
  } else if (serverCfg.warning) {
    console.log(`  Note: ${serverCfg.warning}`)
  }

  const tuiCfg = ensurePluginEntry(
    configDir,
    "tui.json",
    "https://opencode.ai/tui.json",
  )
  if (tuiCfg.changed) {
    console.log(
      `  Updated tui.json plugin array (for slash commands)` +
        (tuiCfg.created ? " [created]" : ""),
    )
  } else if (tuiCfg.warning) {
    console.log(`  Note: ${tuiCfg.warning}`)
  }

  console.log(`\n  Done.`)
  console.log(`  Next steps:`)
  console.log(`    1. Close ALL running OpenCode sessions (fully quit).`)
  console.log(`    2. Reopen OpenCode from any project: \`opencode\`.`)
  console.log(`    3. A toast "OpenCode Pilot — Remote control plugin loaded" should appear.`)
  console.log(`    4. Type \`/remo\` + <Tab> — slash commands /remote, /dashboard,`)
  console.log(`       /pilot, /pilot-token, /remote-control should autocomplete.`)
  console.log(`    5. Click the gear (⚙) in the dashboard → Plugin configuration`)
  console.log(`       to set tunnel, Telegram, VAPID, etc.\n`)

  return {
    configDir,
    cleanedWrappers,
    cleanedCache,
    installed,
    installer,
    serverConfigChanged: serverCfg.changed,
    tuiConfigChanged: tuiCfg.changed,
  }
}

const args = process.argv.slice(2)
const command = args[0] ?? "init"

if (command === "init") {
  main()
} else if (command === "--help" || command === "-h" || command === "help") {
  console.log(`Usage: npx ${PACKAGE_NAME} init`)
  console.log(`       Installs and wires the plugin into your OpenCode config.`)
  process.exit(0)
} else if (command === "--version" || command === "-v") {
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string }
    console.log(pkg.version)
  } catch {
    console.log("unknown")
  }
  process.exit(0)
} else {
  console.error(`Unknown command: ${command}`)
  console.error(`Try: npx ${PACKAGE_NAME} init`)
  process.exit(1)
}
