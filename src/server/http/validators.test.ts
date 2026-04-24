// Tests for validateSettingsPatch in src/server/http/validators.ts.
// Only covers the projectStateMode additions for the project-state-opt-in change.

import { describe, expect, test } from "bun:test"
import { validateSettingsPatch } from "./validators"

// ── Batch 6: projectStateMode validation ─────────────────────────────────────

describe("validateSettingsPatch — projectStateMode", () => {
  test("accepts 'always'", () => {
    const result = validateSettingsPatch({ projectStateMode: "always" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.projectStateMode).toBe("always")
  })

  test("accepts 'off'", () => {
    const result = validateSettingsPatch({ projectStateMode: "off" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.projectStateMode).toBe("off")
  })

  test("accepts 'auto'", () => {
    const result = validateSettingsPatch({ projectStateMode: "auto" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.projectStateMode).toBe("auto")
  })

  test("rejects 'sometimes' with error naming projectStateMode", () => {
    const result = validateSettingsPatch({ projectStateMode: "sometimes" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("projectStateMode")
  })

  test("rejects numeric 123 with error", () => {
    const result = validateSettingsPatch({ projectStateMode: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("projectStateMode")
  })
})
