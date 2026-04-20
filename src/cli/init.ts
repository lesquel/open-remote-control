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
const WRAPPER_FILENAME = "opencode-pilot.ts"
const WRAPPER_CONTENT = `// opencode-pilot — auto-generated wrapper.
// Created by \`npx ${PACKAGE_NAME} init\`. Loads the plugin from node_modules.
export { default } from "${PACKAGE_NAME}/server"
`

interface InitResult {
  configDir: string
  pluginsDir: string
  wrapperPath: string
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

  const args =
    installer === "bun" ? ["add", PACKAGE_NAME] : ["install", PACKAGE_NAME]
  const r = spawnSync(installer, args, { cwd: configDir, stdio: "inherit" })
  if (r.status !== 0) {
    console.error(`\n${installer} ${args.join(" ")} failed (exit ${r.status})`)
    return false
  }
  return existsSync(pkgPath)
}

function writeWrapper(pluginsDir: string): string {
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true })
  const wrapperPath = join(pluginsDir, WRAPPER_FILENAME)
  writeFileSync(wrapperPath, WRAPPER_CONTENT)
  return wrapperPath
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
  // Accept any entry that mentions our package — with or without @latest, scoped or unscoped
  const entryRegex = /(^|\/)opencode-pilot(@|$)/i
  const alreadyListed = (arr ?? []).some((e) => entryRegex.test(e))
  if (alreadyListed) return { changed: false }

  // Add a fresh entry (using the package name so OpenCode also loads it via npm
  // resolution as a backup to the wrapper file).
  const next = (arr ?? []).slice()
  next.push(`${PACKAGE_NAME}@latest`)
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
  const wrapperPath = writeWrapper(pluginsDir)
  console.log(`  Wrote wrapper:      ${wrapperPath}`)

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
    wrapperPath,
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
