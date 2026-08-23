import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "../src")
const moduleRules: Record<string, readonly string[]> = {
  infra: ["infra"],
  core: ["core", "infra"],
  transport: ["transport", "core", "infra"],
  integrations: ["integrations", "core", "infra"],
  notifications: ["notifications", "core", "infra"],
  dashboard: ["dashboard"],
  tui: ["tui", "core", "infra"],
  // The installer intentionally reuses the dependency-free TUI path helper.
  cli: ["cli", "infra", "tui"],
  server: ["server", "core", "infra", "transport", "integrations", "notifications", "dashboard", "tui", "cli"],
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return []
      return sourceFiles(path)
    }
    if (!/\.(?:ts|js)$/.test(entry.name) || /(?:\.test\.ts|\.d\.ts)$/.test(entry.name)) return []
    return [path]
  })
}

function projectImports(path: string): string[] {
  const source = readFileSync(path, "utf8")
  const imports: string[] = []
  const pattern = /(?:from\s*|import\s*\(\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier) imports.push(specifier)
  }
  return imports
}

describe("source architecture boundaries", () => {
  for (const [module, allowed] of Object.entries(moduleRules)) {
    test(`${module} imports only allowed project modules`, () => {
      const violations: string[] = []
      for (const file of sourceFiles(resolve(root, module))) {
        for (const specifier of projectImports(file)) {
          const target = resolve(dirname(file), specifier)
          const targetRelative = relative(root, target)
          if (targetRelative.startsWith(`..${sep}`) || targetRelative === "..") continue
          const targetModule = targetRelative.split(sep)[0]
          if (targetModule && !allowed.includes(targetModule)) {
            violations.push(`${relative(root, file)} -> ${specifier} (${targetModule})`)
          }
        }
      }
      expect(violations).toEqual([])
    })
  }
})
