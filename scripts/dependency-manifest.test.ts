import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("runtime lockfiles pin uuid beyond the vulnerable 13.0.0 release", () => {
  const root = join(import.meta.dir, "..")
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    overrides?: Record<string, string>
  }
  const bunLock = readFileSync(join(root, "bun.lock"), "utf8")
  const npmLock = readFileSync(join(root, "package-lock.json"), "utf8")

  expect(manifest.overrides?.uuid).toBe("13.0.2")
  expect(bunLock).toContain('"uuid": ["uuid@13.0.2"')
  expect(npmLock).toContain('"node_modules/uuid": {\n      "version": "13.0.2"')
})
