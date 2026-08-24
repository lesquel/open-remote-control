import { describe, expect, test } from "bun:test"
import { currentProjectDirectory, projectLabel } from "../state/project-context"

describe("initial project context", () => {
  test("uses the OpenCode project's worktree instead of a global null directory", () => {
    expect(currentProjectDirectory({ worktree: "/projects/pilot" })).toBe("/projects/pilot")
  })

  test("accepts compatible path and root fields", () => {
    expect(currentProjectDirectory({ path: "/projects/path-shape" })).toBe("/projects/path-shape")
    expect(currentProjectDirectory({ root: "/projects/root-shape" })).toBe("/projects/root-shape")
  })

  test("rejects missing or non-absolute project directories", () => {
    expect(currentProjectDirectory(null)).toBeNull()
    expect(currentProjectDirectory({ worktree: "relative/path" })).toBeNull()
  })

  test("labels the tab from the real project instead of default", () => {
    expect(projectLabel({ name: "Pilot", worktree: "/projects/pilot" }, "/projects/pilot")).toBe("Pilot")
    expect(projectLabel({}, "/projects/pilot")).toBe("pilot")
  })
})
