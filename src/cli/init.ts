#!/usr/bin/env bun
// init.ts — One-command installer for opencode-pilot.
//
// Usage: npx @lesquel/opencode-pilot init
//        bunx @lesquel/opencode-pilot init
//
// What it does:
//   1. Locate the user's OpenCode config dir (XDG_CONFIG_HOME / ~/.config/opencode / etc.)
//   2. Ensure the @lesquel/opencode-pilot package is installed there (npm/bun add)
//   3. Drop a wrapper file at <config>/plugins/opencode-pilot.ts so OpenCode
//      loads it reliably regardless of opencode.json plugin-array quirks.
//   4. Print next steps.
//
// This is intentionally a single file with no dependencies beyond node:fs/os/path
// and node:child_process, so it works the second the user runs `npx`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const PACKAGE_NAME = "@lesquel/opencode-pilot"
const PLUGIN_ID = "opencode-pilot"

// OpenCode separates server and TUI plugins (PluginModule.tui = never,
// TuiPluginModule.server = never). We ship two wrappers — one for each.
const WRAPPERS: ReadonlyArray<{ filename: string; content: string }> = [
  {
    filename: "opencode-pilot.ts",
    content: `// opencode-pilot — auto-generated server wrapper.
// Created by \`npx ${PACKAGE_NAME} init\`. Loads the HTTP+SSE dashboard.
export { default } from "${PACKAGE_NAME}/server"
`,
  },
  {
    filename: "opencode-pilot-tui.ts",
    content: `// opencode-pilot-tui — auto-generated TUI wrapper.
// Created by \`npx ${PACKAGE_NAME} init\`. Loads the slash commands
// (/remote, /pilot, /dashboard, /pilot-token).
export { default } from "${PACKAGE_NAME}/tui"
`,
  },
]

interface InitResult {
  configDir: string
  pluginsDir: string
  wrapperPaths: string[]
  installed: boolean
  installer: string | null
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

function detectInstaller(configDir: string): string | null {
  // Prefer bun if there's a bun.lock; npm if package-lock.json; fallback to bun.
  if (existsSync(join(configDir, "bun.lock"))) return "bun"
  if (existsSync(join(configDir, "package-lock.json"))) return "npm"
  // No lockfile yet — pick whichever binary is on PATH.
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

function ensurePackageInstalled(configDir: string, installer: string): boolean {
  const pkgPath = join(configDir, "node_modules", PACKAGE_NAME, "package.json")
  if (existsSync(pkgPath)) return true

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

function writeWrappers(pluginsDir: string): string[] {
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true })
  const written: string[] = []
  for (const { filename, content } of WRAPPERS) {
    const wrapperPath = join(pluginsDir, filename)
    writeFileSync(wrapperPath, content)
    written.push(wrapperPath)
  }
  return written
}

function ensureOpencodeJsonPluginEntry(configDir: string): {
  changed: boolean
  warning?: string
} {
  const cfgPath = join(configDir, "opencode.json")
  if (!existsSync(cfgPath)) return { changed: false }

  let raw: string
  try {
    raw = readFileSync(cfgPath, "utf8")
  } catch (err) {
    return { changed: false, warning: `could not read ${cfgPath}: ${err}` }
  }

  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(raw)
  } catch {
    return {
      changed: false,
      warning: `${cfgPath} is not valid JSON. Skipping; the wrapper file in plugins/ is enough.`,
    }
  }

  const arr = Array.isArray(cfg.plugin) ? (cfg.plugin as string[]) : null

  // OpenCode loads ONE export per plugin entry. The package's main is the
  // server module; the TUI lives at the /tui sub-export. We need BOTH listed
  // separately so server (banner, dashboard) AND tui (slash commands) load.
  const wantedEntries = [`${PACKAGE_NAME}@latest`, `${PACKAGE_NAME}/tui`]
  const existing = arr ?? []
  const entryRegex = /(^|\/)opencode-pilot(@|\/|$)/i
  const next = existing.filter((e) => !entryRegex.test(e))
  next.push(...wantedEntries)

  // No-op if exactly the same set is already there
  const sameAsBefore =
    existing.length === next.length &&
    existing.every((e, i) => e === next[i])
  if (sameAsBefore) return { changed: false }

  cfg.plugin = next
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n")
  return { changed: true }
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

  const pluginsDir = join(configDir, "plugins")
  const wrapperPaths = writeWrappers(pluginsDir)
  for (const p of wrapperPaths) {
    console.log(`  Wrote wrapper:      ${p}`)
  }

  const cfgUpdate = ensureOpencodeJsonPluginEntry(configDir)
  if (cfgUpdate.changed) {
    console.log(`  Updated opencode.json plugin array (added ${PACKAGE_NAME}@latest)`)
  } else if (cfgUpdate.warning) {
    console.log(`  Note: ${cfgUpdate.warning}`)
  }

  console.log(`\n  Done.`)
  console.log(`  Next steps:`)
  console.log(`    1. Restart OpenCode (close and reopen any running session).`)
  console.log(`    2. Open the URL printed in the banner, or scan the QR.`)
  console.log(`    3. Click the gear (⚙) → Plugin configuration to set tunnel,`)
  console.log(`       Telegram, VAPID, etc.\n`)

  return {
    configDir,
    pluginsDir,
    wrapperPaths,
    installed,
    installer,
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
  // Read our own package.json for the version
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
