// Tests for validators/settings.ts.
// Covers projectStateMode (project-state-opt-in) and hookToken (codex-hooks-bridge).

import { describe, expect, test } from "bun:test"
import { validateSettingsPatch } from "./settings"

// ── Batch 6: projectStateMode validation ─────────────────────────────────────

// ── Phase 11: hookToken validation ───────────────────────────────────────────

describe("validateSettingsPatch — hookToken", () => {
  test("(a) { hookToken: 'abc' } is valid", () => {
    const result = validateSettingsPatch({ hookToken: "abc" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.hookToken).toBe("abc")
  })

  test("(b) { hookToken: null } is valid (clear)", () => {
    const result = validateSettingsPatch({ hookToken: null })
    expect(result.ok).toBe(true)
  })

  test("(c) { hookToken: 123 } → validation error", () => {
    const result = validateSettingsPatch({ hookToken: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("hookToken")
  })

  test("(d) { hookToken: '' } → validation error (empty string rejected)", () => {
    const result = validateSettingsPatch({ hookToken: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("hookToken")
  })
})

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
