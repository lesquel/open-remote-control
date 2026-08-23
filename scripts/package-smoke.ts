import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  version: string
}
const installRoot = mkdtempSync(join(tmpdir(), "opencode-pilot-package-smoke-"))
let tarballPath: string | null = null

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

try {
  const packOutput: unknown = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts"], root))
  const packed = Array.isArray(packOutput)
    ? packOutput[0]
    : packOutput && typeof packOutput === "object"
      ? Object.values(packOutput)[0]
      : null
  const metadata = packed && typeof packed === "object" ? packed as Record<string, unknown> : {}
  const filename = metadata.filename
  if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
    throw new Error("npm pack did not return a tarball filename")
  }
  const packedPaths = Array.isArray(metadata.files)
    ? metadata.files.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return []
        const path = (entry as Record<string, unknown>).path
        return typeof path === "string" ? [path] : []
      })
    : []
  const internalFiles = packedPaths.filter((path) =>
    path.endsWith(".test.ts") ||
    path.endsWith(".d.ts") ||
    path.endsWith("/AGENTS.md") ||
    path.includes("/__tests__/"),
  )
  if (internalFiles.length > 0) {
    throw new Error(`Package contains internal-only files: ${internalFiles.join(", ")}`)
  }
  tarballPath = join(root, filename)

  writeFileSync(join(installRoot, "package.json"), JSON.stringify({ private: true }))
  run("npm", ["install", "--ignore-scripts", tarballPath], installRoot)

  const executable = process.platform === "win32"
    ? join(installRoot, "node_modules", ".bin", "opencode-pilot.cmd")
    : join(installRoot, "node_modules", ".bin", "opencode-pilot")
  const version = run(executable, ["--version"], installRoot)
  if (version !== packageJson.version) {
    throw new Error(`Packed CLI reported ${version}; expected ${packageJson.version}`)
  }
  console.log(`✓ package smoke passed: ${packageJson.name}@${version}`)
} finally {
  rmSync(installRoot, { recursive: true, force: true })
  if (tarballPath) {
    try { unlinkSync(tarballPath) } catch { /* best-effort cleanup after a failed pack/install */ }
  }
}
