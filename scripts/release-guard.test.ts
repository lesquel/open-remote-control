import { describe, expect, test } from "bun:test"
import { validateReleaseTag } from "./release-guard"

describe("validateReleaseTag", () => {
  test("accepts the exact stable package version", () => {
    expect(validateReleaseTag("v1.21.1", "1.21.1")).toEqual([])
  })

  test("accepts the exact prerelease package version", () => {
    expect(validateReleaseTag("v2.0.0-rc.1", "2.0.0-rc.1")).toEqual([])
  })

  test("rejects a tag for a different package version", () => {
    expect(validateReleaseTag("v1.21.2", "1.21.1")).toContain(
      'release tag "v1.21.2" does not match package version "1.21.1"',
    )
  })

  test.each(["1.21.1", "release-1.21.1", "v1.21", "vnext", ""])(
    "rejects malformed release tag %s",
    (tag) => expect(validateReleaseTag(tag, "1.21.1").length).toBeGreaterThan(0),
  )
})
