#!/usr/bin/env bun
// prepublish-guard.ts — fails `npm publish` / `bun publish` if package.json
// has been polluted by the upstream OpenCode dev hook, which silently:
//   - adds "@lesquel/opencode-pilot" to its own dependencies (self-ref)
//   - pins "@opencode-ai/plugin" to whatever version is locally installed
//
// Both of those break consumers:
//   - self-ref makes `npm install @lesquel/opencode-pilot` fail or loop
//   - a pinned SDK locks the plugin to an old OpenCode version, so users
//     running newer OpenCode builds silently lose the TUI

import { readFileSync } from "node:fs"
import { join } from "node:path"

const PKG_NAME = "@lesquel/opencode-pilot"
const SDK_NAME = "@opencode-ai/plugin"
const ROOT = new URL("..", import.meta.url)
const PKG_PATH = join(ROOT.pathname, "package.json")

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const problems: string[] = []

if (pkg.dependencies && PKG_NAME in pkg.dependencies) {
  problems.push(
    `dependencies contains self-reference "${PKG_NAME}: ${pkg.dependencies[PKG_NAME]}". ` +
      `Remove it before publishing — the upstream OpenCode dev hook adds this automatically.`,
  )
}

const sdkRange =
  pkg.dependencies?.[SDK_NAME] ?? pkg.devDependencies?.[SDK_NAME]
if (sdkRange && sdkRange !== "latest" && sdkRange !== "*") {
  problems.push(
    `${SDK_NAME} is pinned to "${sdkRange}". Set it to "latest" so the plugin ` +
      `keeps pace with OpenCode's fast SDK release cadence.`,
  )
}

if (problems.length > 0) {
  console.error("\n  ✖ prepublish guard failed:\n")
  for (const p of problems) {
    console.error(`    - ${p}`)
  }
  console.error("\n  Fix package.json and re-run publish.\n")
  process.exit(1)
}

console.log("  ✓ prepublish guard passed")
