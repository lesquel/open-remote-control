import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("CI runs for chained pull requests instead of declaring an invalid permission", () => {
  const workflow = readFileSync(join(import.meta.dir, "..", ".github", "workflows", "ci.yml"), "utf8")
  const triggersStart = workflow.indexOf("\non:\n")
  const pullRequestTrigger = workflow.indexOf("\n  pull_request:\n", triggersStart)
  const permissionsStart = workflow.indexOf("\npermissions:\n")

  expect(triggersStart).toBeGreaterThanOrEqual(0)
  expect(pullRequestTrigger).toBeGreaterThan(triggersStart)
  expect(pullRequestTrigger).toBeLessThan(permissionsStart)
  expect(workflow.slice(permissionsStart)).not.toContain("\n  pull_request:\n")
})
