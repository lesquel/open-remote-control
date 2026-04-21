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
  /**
   * True when cache invalidation was skipped because OpenCode was running.
   * The caller exits nonzero so scripts/CI notice the partial success.
   * Introduced in 1.13.13 for issue #1 — users were re-running init without
   * quitting OpenCode, getting a "Done" message, and still loading the old
   * cached plugin from `~/.cache/opencode/packages/`.
   */
  cacheInvalidationSkipped: boolean
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
//
// **Critical**: we use `pgrep -x opencode` (exact process-name match), NOT
// `pgrep -f opencode` (full command-line substring match).
//
// `-f` matched:
//   - The init process itself (`bunx @lesquel/opencode-pilot@latest init`
//     contains the string "opencode")
//   - Any shell running in a directory whose path contains "opencode"
//     (e.g. our own dev checkout at `~/proyectos/plugin-opencode/…`)
//   - Editors with files open under such a path
//
// So v1.13.13 reported "OpenCode is running" for basically every user and
// produced the red "CACHE NOT REFRESHED" banner + exit 2 on CLEAN installs,
// defeating its own purpose. The -x flag fixes this by matching only
// processes whose executable name is exactly `opencode`.
//
// We also exclude the current process and its parent on the off-chance a
// user's OpenCode wrapper script renames its argv[0] — the wrapper's PID
// would be our parent, and we do NOT want to self-detect.
/** @internal — exported only for testing. Do not call from non-test code. */
export function isOpencodeRunning(): boolean {
  if (platform() === "win32") {
    // `tasklist /FI "IMAGENAME eq opencode.exe"` already filters by image
    // name, not command line, so this path was never affected by the bug.
    const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq opencode.exe"], {
      encoding: "utf8",
    })
    return r.stdout?.toLowerCase().includes("opencode.exe") ?? false
  }
  const r = spawnSync("pgrep", ["-x", "opencode"], { encoding: "utf8" })
  if (r.status !== 0) return false
  const selfPids = new Set<number>([process.pid, process.ppid])
  const foreignPids = (r.stdout ?? "")
    .split("\n")
    .map((line) => parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && !selfPids.has(pid))
  return foreignPids.length > 0
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
  const cacheInvalidationSkipped = isOpencodeRunning()
  if (!cacheInvalidationSkipped) {
    cleanedCache = cleanupStaleCache(locateOpencodeCacheDirs())
    for (const p of cleanedCache) {
      console.log(`  Invalidated cache:  ${p}`)
    }
  }
  // The loud banner is printed at the END of main() (after config writes)
  // so the user sees it as the last thing on screen — and we exit nonzero
  // so CI / scripts / humans don't miss it.

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

  if (cacheInvalidationSkipped) {
    printCacheSkipBanner()
  } else {
    console.log(`\n  Done.`)
    console.log(`  Next steps:`)
    console.log(`    1. Close ALL running OpenCode sessions (fully quit).`)
    console.log(`    2. Reopen OpenCode from any project: \`opencode\`.`)
    console.log(`    3. A toast "OpenCode Pilot — Remote control plugin loaded" should appear.`)
    console.log(`    4. Type \`/remo\` + <Tab> — slash commands /remote, /dashboard,`)
    console.log(`       /pilot, /pilot-token, /remote-control should autocomplete.`)
    console.log(`    5. Click the gear (⚙) in the dashboard → Plugin configuration`)
    console.log(`       to set tunnel, Telegram, VAPID, etc.\n`)
  }

  return {
    configDir,
    cleanedWrappers,
    cleanedCache,
    installed,
    installer,
    serverConfigChanged: serverCfg.changed,
    tuiConfigChanged: tuiCfg.changed,
    cacheInvalidationSkipped,
  }
}

// Visible banner printed at the end of init when we detected a running
// OpenCode process. We use ANSI red only when stdout is a TTY so CI logs
// stay readable and pipes to `tee` don't get escape-code noise.
function printCacheSkipBanner(): void {
  const isTTY = Boolean(process.stdout.isTTY)
  const red = isTTY ? "\x1b[1;31m" : ""
  const yellow = isTTY ? "\x1b[1;33m" : ""
  const reset = isTTY ? "\x1b[0m" : ""
  const bar = "━".repeat(72)
  console.log("")
  console.log(`${red}${bar}${reset}`)
  console.log(`${red}  !! CONFIG WRITTEN — BUT PLUGIN CACHE NOT REFRESHED !!${reset}`)
  console.log(`${red}${bar}${reset}`)
  console.log("")
  console.log(`${yellow}  OpenCode is currently running. The plugin package cache under${reset}`)
  console.log(`${yellow}  ~/.cache/opencode/packages/ was NOT invalidated — OpenCode will${reset}`)
  console.log(`${yellow}  keep loading the previously-installed version until you flush it.${reset}`)
  console.log("")
  console.log(`  Required steps:`)
  console.log("")
  console.log(`    1. Quit every OpenCode window / session:`)
  console.log(`         pkill -f opencode     # Linux / macOS`)
  console.log(`         (or close every terminal window running opencode)`)
  console.log("")
  console.log(`    2. Re-run this installer so cache invalidation succeeds:`)
  console.log(`         bunx @lesquel/opencode-pilot@latest init`)
  console.log("")
  console.log(`    3. Reopen OpenCode.`)
  console.log("")
  console.log(`${red}  Exiting with code 2 so CI/scripts notice this is NOT a success.${reset}`)
  console.log(`${red}${bar}${reset}`)
  console.log("")
}

// ─── uninstall ──────────────────────────────────────────────────────────────
// User-requested in 1.13.15. Reverses every side effect `init` had:
//   1. Remove the plugin spec from opencode.json and tui.json.
//   2. Uninstall the npm package from the OpenCode config dir.
//   3. Invalidate the plugin package cache (same rules as init —
//      refuse if OpenCode is running).
//   4. Remove stale wrapper files and `~/.opencode-pilot/` state/banner.
//   5. Unless `--keep-config`, also delete `~/.opencode-pilot/config.json`
//      so reinstalling starts from defaults.
// Leaves browser-side cache (service worker, localStorage) untouched —
// those live per-browser and there's no way to clean them from the CLI.
// We print explicit instructions for the user to run manually.

interface UninstallResult {
  configDir: string
  pluginEntriesRemoved: { opencode: boolean; tui: boolean }
  packageRemoved: boolean
  cleanedCache: string[]
  cleanedWrappers: string[]
  cleanedState: string[]
  cacheInvalidationSkipped: boolean
  keptConfig: boolean
}

function removePluginEntry(
  configDir: string,
  filename: string,
): boolean {
  const cfgPath = join(configDir, filename)
  if (!existsSync(cfgPath)) return false
  let raw: string
  try {
    raw = readFileSync(cfgPath, "utf8")
  } catch {
    return false
  }
  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return false
  }
  const existing = Array.isArray(cfg.plugin) ? (cfg.plugin as string[]) : []
  const next = existing.filter(
    (e) => typeof e !== "string" || !STALE_ENTRY_REGEX.test(e),
  )
  if (next.length === existing.length) return false
  cfg.plugin = next
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n")
  return true
}

function removePackage(configDir: string, installer: string): boolean {
  const pkgPath = join(configDir, "node_modules", PACKAGE_NAME, "package.json")
  if (!existsSync(pkgPath)) return false
  const args = installer === "bun" ? ["remove", PACKAGE_NAME] : ["uninstall", PACKAGE_NAME]
  const r = spawnSync(installer, args, { cwd: configDir, stdio: "inherit" })
  return r.status === 0
}

function cleanupStateDir(keepConfig: boolean): string[] {
  const removed: string[] = []
  const dir = join(homedir(), ".opencode-pilot")
  if (!existsSync(dir)) return removed

  const ephemeral = ["pilot-state.json", "pilot-banner.txt"]
  for (const file of ephemeral) {
    const target = join(dir, file)
    if (existsSync(target)) {
      try {
        rmSync(target, { force: true })
        removed.push(target)
      } catch {
        // Best-effort
      }
    }
  }

  if (!keepConfig) {
    const cfg = join(dir, "config.json")
    if (existsSync(cfg)) {
      try {
        rmSync(cfg, { force: true })
        removed.push(cfg)
      } catch {
        // Best-effort
      }
    }
    // Remove the directory only if now empty (avoids nuking user extras).
    try {
      const leftovers = readdirSync(dir)
      if (leftovers.length === 0) {
        rmSync(dir, { recursive: true, force: true })
        removed.push(dir)
      }
    } catch {
      // ignore
    }
  }

  return removed
}

function uninstall(keepConfig: boolean): UninstallResult {
  console.log(`\n  ${PACKAGE_NAME} — uninstaller\n`)

  const configDir = locateOpencodeConfigDir()
  console.log(`  OpenCode config dir: ${configDir}`)

  const pluginEntriesRemoved = {
    opencode: existsSync(configDir) ? removePluginEntry(configDir, "opencode.json") : false,
    tui: existsSync(configDir) ? removePluginEntry(configDir, "tui.json") : false,
  }
  if (pluginEntriesRemoved.opencode) console.log(`  Removed plugin entry from opencode.json`)
  if (pluginEntriesRemoved.tui) console.log(`  Removed plugin entry from tui.json`)

  let packageRemoved = false
  const installer = existsSync(configDir) ? detectInstaller(configDir) : null
  if (installer) {
    packageRemoved = removePackage(configDir, installer)
    if (packageRemoved) console.log(`  Uninstalled package via ${installer}`)
  } else if (existsSync(join(configDir, "node_modules", PACKAGE_NAME))) {
    console.log(
      `  Note: package is installed at ${join(configDir, "node_modules", PACKAGE_NAME)} ` +
        `but no installer (bun/npm) found on PATH — remove manually.`,
    )
  }

  const cleanedWrappers = cleanupStaleWrappers(configDir)
  for (const p of cleanedWrappers) {
    console.log(`  Removed stale wrapper: ${p}`)
  }

  let cleanedCache: string[] = []
  const cacheInvalidationSkipped = isOpencodeRunning()
  if (!cacheInvalidationSkipped) {
    cleanedCache = cleanupStaleCache(locateOpencodeCacheDirs())
    for (const p of cleanedCache) {
      console.log(`  Invalidated cache:  ${p}`)
    }
  }

  const cleanedState = cleanupStateDir(keepConfig)
  for (const p of cleanedState) {
    console.log(`  Removed state file: ${p}`)
  }

  console.log(`\n  Uninstall complete.`)
  console.log(`\n  Remaining cleanup (manual, per-browser):`)
  console.log(`    1. Open the dashboard's origin in each browser`)
  console.log(`       (usually http://127.0.0.1:4097)`)
  console.log(`    2. DevTools → Application → Storage → "Clear site data"`)
  console.log(`    3. This removes the stored token and unregisters`)
  console.log(`       the PWA service worker.\n`)

  if (cacheInvalidationSkipped) {
    console.log(
      `  Heads up: OpenCode is currently running, so the plugin package\n` +
        `  cache under ~/.cache/opencode/packages/ was NOT cleaned up.\n` +
        `  Fully quit OpenCode and re-run \`bunx ${PACKAGE_NAME} uninstall\`\n` +
        `  to finish the job.\n`,
    )
  }

  return {
    configDir,
    pluginEntriesRemoved,
    packageRemoved,
    cleanedCache,
    cleanedWrappers,
    cleanedState,
    cacheInvalidationSkipped,
    keptConfig: keepConfig,
  }
}

// ─── doctor ─────────────────────────────────────────────────────────────────
// Diagnostic command — prints a status report. Zero side effects.
// Helps users (and us, when triaging issues) answer "is opencode-pilot
// actually set up correctly on this machine?" in under 2 seconds.

interface DoctorFinding {
  label: string
  ok: boolean | "warn"
  detail?: string
}

function doctorCheckPackageInstalled(configDir: string): DoctorFinding {
  const pkgPath = join(configDir, "node_modules", PACKAGE_NAME, "package.json")
  if (!existsSync(pkgPath)) {
    return {
      label: "Plugin package installed in OpenCode config dir",
      ok: false,
      detail: `Not found at ${pkgPath}. Run \`bunx ${PACKAGE_NAME} init\`.`,
    }
  }
  let version = "unknown"
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }
    if (typeof pkg.version === "string") version = pkg.version
  } catch {
    // fall through
  }
  return {
    label: "Plugin package installed in OpenCode config dir",
    ok: true,
    detail: `version ${version} at ${pkgPath}`,
  }
}

function doctorCheckPluginEntry(
  configDir: string,
  filename: string,
): DoctorFinding {
  const cfgPath = join(configDir, filename)
  if (!existsSync(cfgPath)) {
    return {
      label: `${filename} plugin entry`,
      ok: false,
      detail: `${cfgPath} does not exist`,
    }
  }
  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>
  } catch {
    return {
      label: `${filename} plugin entry`,
      ok: false,
      detail: `Invalid JSON at ${cfgPath}`,
    }
  }
  const list = Array.isArray(cfg.plugin) ? (cfg.plugin as string[]) : []
  const hasEntry = list.some(
    (e) => typeof e === "string" && STALE_ENTRY_REGEX.test(e),
  )
  if (!hasEntry) {
    return {
      label: `${filename} plugin entry`,
      ok: false,
      detail: `${cfgPath} does not reference ${PACKAGE_NAME}`,
    }
  }
  return {
    label: `${filename} plugin entry`,
    ok: true,
    detail: list.filter((e) => typeof e === "string" && STALE_ENTRY_REGEX.test(e)).join(", "),
  }
}

function doctorCheckOpencodeRunning(): DoctorFinding {
  const running = isOpencodeRunning()
  return {
    label: "OpenCode process running",
    ok: running ? "warn" : true,
    detail: running
      ? "yes — cache invalidation during init/uninstall will be skipped until you quit OpenCode"
      : "no",
  }
}

async function doctorCheckHealthEndpoint(): Promise<DoctorFinding> {
  const port = Number(process.env.PILOT_PORT) || 4097
  const host = process.env.PILOT_HOST || "127.0.0.1"
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 500)
    try {
      const res = await fetch(`http://${host}:${port}/health`, { signal: ctrl.signal })
      if (!res.ok) {
        return {
          label: `Pilot /health on ${host}:${port}`,
          ok: false,
          detail: `HTTP ${res.status} — something else may be on the port`,
        }
      }
      const body = (await res.json()) as {
        version?: unknown
        services?: { sdk?: unknown }
      }
      const looksLikePilot =
        typeof body?.services?.sdk === "string" && typeof body?.version === "string"
      if (!looksLikePilot) {
        return {
          label: `Pilot /health on ${host}:${port}`,
          ok: false,
          detail: `Responded, but not with pilot's /health shape — another process owns this port`,
        }
      }
      return {
        label: `Pilot /health on ${host}:${port}`,
        ok: true,
        detail: `version ${body.version as string} responding`,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return {
      label: `Pilot /health on ${host}:${port}`,
      ok: "warn",
      detail: `Not responding — OpenCode may be off, or the plugin failed to load`,
    }
  }
}

function doctorCheckStateFile(): DoctorFinding {
  const path = join(homedir(), ".opencode-pilot", "pilot-state.json")
  if (!existsSync(path)) {
    return {
      label: "Global pilot-state.json",
      ok: false,
      detail: `Missing at ${path}`,
    }
  }
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      port?: unknown
      host?: unknown
      pid?: unknown
    }
    return {
      label: "Global pilot-state.json",
      ok: true,
      detail: `host=${String(state.host)} port=${String(state.port)} pid=${String(state.pid)}`,
    }
  } catch (err) {
    return {
      label: "Global pilot-state.json",
      ok: false,
      detail: `Unreadable: ${(err as Error).message}`,
    }
  }
}

function printFinding(f: DoctorFinding): void {
  const isTTY = Boolean(process.stdout.isTTY)
  const green = isTTY ? "\x1b[32m" : ""
  const red = isTTY ? "\x1b[31m" : ""
  const yellow = isTTY ? "\x1b[33m" : ""
  const reset = isTTY ? "\x1b[0m" : ""
  const icon = f.ok === true ? `${green}✓${reset}` : f.ok === "warn" ? `${yellow}!${reset}` : `${red}✗${reset}`
  console.log(`  ${icon}  ${f.label}`)
  if (f.detail) {
    console.log(`       ${f.detail}`)
  }
}

async function doctor(): Promise<DoctorFinding[]> {
  console.log(`\n  ${PACKAGE_NAME} — doctor\n`)

  const configDir = locateOpencodeConfigDir()
  console.log(`  OpenCode config dir: ${configDir}\n`)

  const findings: DoctorFinding[] = [
    doctorCheckPackageInstalled(configDir),
    doctorCheckPluginEntry(configDir, "opencode.json"),
    doctorCheckPluginEntry(configDir, "tui.json"),
    doctorCheckOpencodeRunning(),
    await doctorCheckHealthEndpoint(),
    doctorCheckStateFile(),
  ]

  for (const f of findings) printFinding(f)
  console.log("")

  const anyFail = findings.some((f) => f.ok === false)
  if (anyFail) {
    console.log(`  Some checks failed. See detail lines above.`)
    console.log(`  Full troubleshooting: docs/TROUBLESHOOTING.md on GitHub.\n`)
  } else {
    console.log(`  All checks passed.\n`)
  }

  return findings
}

// CLI entrypoint — only executes when this file is run directly (e.g.
// `bunx @lesquel/opencode-pilot init`), not when imported from a test.
// Guarded with `import.meta.main` so exporting internals for testing
// (see `isOpencodeRunning`) doesn't re-run the installer as a side effect.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const command = args[0] ?? "init"

  if (command === "init") {
    const result = main()
    if (result.cacheInvalidationSkipped) {
      process.exit(2)
    }
  } else if (command === "uninstall") {
    const keepConfig = args.includes("--keep-config")
    const result = uninstall(keepConfig)
    if (result.cacheInvalidationSkipped) {
      process.exit(2)
    }
  } else if (command === "doctor") {
    const findings = await doctor()
    if (findings.some((f) => f.ok === false)) {
      process.exit(1)
    }
  } else if (command === "--help" || command === "-h" || command === "help") {
    console.log(`Usage: npx ${PACKAGE_NAME} <command>`)
    console.log(``)
    console.log(`Commands:`)
    console.log(`  init                       Install and wire the plugin into OpenCode config.`)
    console.log(`  uninstall [--keep-config]  Remove plugin config, package, cache, and state.`)
    console.log(`                             --keep-config preserves ~/.opencode-pilot/config.json.`)
    console.log(`  doctor                     Print diagnostic status report. Zero side effects.`)
    console.log(`  --version, -v              Print version.`)
    console.log(`  --help, -h                 Print this help.`)
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
    console.error(`Try: npx ${PACKAGE_NAME} --help`)
    process.exit(1)
  }
}
