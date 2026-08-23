#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function validateReleaseTag(tag: string, packageVersion: string): string[] {
  const problems: string[] = []
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    problems.push(`release tag "${tag}" is not a supported vX.Y.Z tag`)
  }
  if (tag !== `v${packageVersion}`) {
    problems.push(`release tag "${tag}" does not match package version "${packageVersion}"`)
  }
  return problems
}

if (import.meta.main) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ""
  const root = new URL("..", import.meta.url)
  const pkg = JSON.parse(readFileSync(join(root.pathname, "package.json"), "utf8")) as {
    version?: unknown
  }
  const packageVersion = typeof pkg.version === "string" ? pkg.version : ""
  const problems = validateReleaseTag(tag, packageVersion)
  if (problems.length > 0) {
    console.error("\n  ✖ release guard failed:\n")
    for (const problem of problems) console.error(`    - ${problem}`)
    process.exit(1)
  }
  console.log(`  ✓ release tag ${tag} matches package version ${packageVersion}`)
}
