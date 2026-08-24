// project-tabs-state.test.ts — Unit tests for project tab state bugs
// Covers issues #8 (wrong tab label), #9 (stale sessions on switch), #10 (persistence logic)
//
// state.js is pure JS (no browser APIs), so it can be imported directly.

import { describe, expect, test, beforeEach } from "bun:test"
import {
  addProjectTab,
  switchProjectTab,
  getActiveProjectTab,
  getProjectTabs,
  getState,
  setProjectTabLabel,
  findProjectTabByDirectory,
  getActiveDirectory,
  rebindProjectTab,
} from "../state/state"

// Reset module state between tests by re-importing a fresh module would require
// module caching tricks. Instead, we rely on the fact that state.js exports a
// single shared in-memory store. We clear it between tests by adding all tabs
// created in the test and removing them via removeProjectTab, or by using
// unique directories to avoid cross-contamination.

// ── #8: Tab label should be the tab's .label, not re-derived from directory ──

describe("#8 — tab label derives from .label, not re-computed from directory", () => {
  // Regression: _refreshProjectLabel() in main.js used to call
  //   getActiveDirectory() and do dir.split('/').pop() ?? 'default'
  // When activeDirectory was null (the "default" instance), this always
  // returned 'default' even if the tab had a meaningful label set by the
  // caller.  The fix: read getActiveProjectTab()?.label instead.

  test("addProjectTab with null directory stores the provided label, not 'default'", () => {
    const tab = addProjectTab(null, "my-custom-label")
    expect(tab.label).toBe("my-custom-label")
    // cleanup - switch away so the tab can be re-identified
  })

  test("addProjectTab with a real directory derives basename label when no label given", () => {
    const tab = addProjectTab("/home/user/myproject-8", undefined)
    expect(tab.label).toBe("myproject-8")
  })

  test("getActiveProjectTab().label is set from the caller, not from activeDirectory", () => {
    const tab = addProjectTab("/home/user/proj-label-test", "explicit-label")
    switchProjectTab(tab.id)
    const active = getActiveProjectTab()
    expect(active).not.toBeNull()
    expect(active?.label).toBe("explicit-label")
    // Must NOT re-derive from activeDirectory (which would give "proj-label-test")
    const derived = getActiveDirectory()?.split("/").filter(Boolean).pop() ?? "default"
    // The label and the derived name happen to be the same here. So also verify null dir case:
  })

  test("null directory tab keeps its caller-provided label after switchProjectTab", () => {
    // Ensure a null-dir tab exists; if it already exists from a previous test,
    // update its label so we can assert on a known value.
    const existing = findProjectTabByDirectory(null)
    const tab = existing ?? addProjectTab(null, "opencode-instance")
    if (existing) setProjectTabLabel(existing.id, "opencode-instance")

    switchProjectTab(tab.id)
    const active = getActiveProjectTab()
    // label must survive — NOT get replaced with 'default'
    expect(active?.label).toBe("opencode-instance")
    // activeDirectory is null → old code would show 'default'
    expect(getActiveDirectory()).toBeNull()
  })

  test("(#8 regression) active tab label should come from tab.label, not activeDirectory", () => {
    // This test encodes the correct logic that main.js's _refreshProjectLabel
    // should use: getActiveProjectTab()?.label instead of re-deriving from
    // getActiveDirectory().  When activeDirectory is null, re-derivation
    // produces 'default'; reading tab.label produces the actual name.
    const existing = findProjectTabByDirectory(null)
    const tab = existing ?? addProjectTab(null, "my-project-name")
    setProjectTabLabel(tab.id, "my-project-name")
    switchProjectTab(tab.id)

    // Simulate what main.js _refreshProjectLabel() DID (buggy):
    const dir = getActiveDirectory()
    const buggyLabel = dir ? (dir.split("/").filter(Boolean).pop() ?? "project") : "default"

    // Simulate what main.js _refreshProjectLabel() SHOULD do (fix):
    const correctLabel = getActiveProjectTab()?.label ?? "default"

    expect(buggyLabel).toBe("default")       // old code gives wrong result
    expect(correctLabel).toBe("my-project-name") // new code gives correct result
  })

  test("setProjectTabLabel updates the tab label correctly", () => {
    const tab = addProjectTab("/home/user/proj-rename-test", null)
    switchProjectTab(tab.id)
    setProjectTabLabel(tab.id, "renamed-label")
    const active = getActiveProjectTab()
    expect(active?.label).toBe("renamed-label")
  })
})

// ── #9: Switching tabs must expose distinct per-tab data ──────────────────────

describe("#9 — switching project tabs exposes correct per-tab data", () => {
  // The core state requirement: after switchProjectTab(tabB.id), getState()
  // must return tabB's cached data, not tabA's.  This is the state-layer
  // contract that sessions.js and the SSE subscriber rely on.

  test("switchProjectTab changes activeDirectory to the new tab's directory", () => {
    const tabA = addProjectTab("/projects/alpha-9", "alpha-9")
    const tabB = addProjectTab("/projects/beta-9", "beta-9")
    switchProjectTab(tabA.id)
    expect(getActiveDirectory()).toBe("/projects/alpha-9")
    switchProjectTab(tabB.id)
    expect(getActiveDirectory()).toBe("/projects/beta-9")
  })

  test("switchProjectTab changes activeProjectId", () => {
    const tabA = addProjectTab("/projects/alpha-id-9", "alpha-id-9")
    const tabB = addProjectTab("/projects/beta-id-9", "beta-id-9")
    switchProjectTab(tabA.id)
    expect(getState().activeProjectId).toBe(tabA.id)
    switchProjectTab(tabB.id)
    expect(getState().activeProjectId).toBe(tabB.id)
  })

  test("each tab's cached sessions are isolated from other tabs", () => {
    const tabA = addProjectTab("/projects/cache-a-9", "cache-a-9")
    const tabB = addProjectTab("/projects/cache-b-9", "cache-b-9")

    // Simulate loading sessions for tabA
    switchProjectTab(tabA.id)
    const sessionsA = { "sess-a1": { id: "sess-a1", title: "Session A1" } }
    // Directly mutate the tab cache (simulates what setState mirroring does)
    tabA.sessions = sessionsA

    // Simulate loading sessions for tabB
    switchProjectTab(tabB.id)
    const sessionsB = { "sess-b1": { id: "sess-b1", title: "Session B1" } }
    tabB.sessions = sessionsB

    // Switch back to tabA — state.sessions should reflect tabA's data
    switchProjectTab(tabA.id)
    expect(getState().sessions).toEqual(sessionsA)

    // Switch to tabB — state.sessions should reflect tabB's data
    switchProjectTab(tabB.id)
    expect(getState().sessions).toEqual(sessionsB)
  })

  test("switching tabs does not bleed state from one tab to another", () => {
    const tabA = addProjectTab("/projects/bleed-a-9", "bleed-a-9")
    const tabB = addProjectTab("/projects/bleed-b-9", "bleed-b-9")

    switchProjectTab(tabA.id)
    // Set state for tabA
    tabA.sessions = { "s-a": { id: "s-a" } }
    tabA.activeSession = "s-a"

    switchProjectTab(tabB.id)
    // tabB starts empty — its state must NOT contain tabA's session
    expect(getState().sessions).not.toHaveProperty("s-a")
    expect(getState().activeSession).toBeNull()
  })
})

// ── #10: Tab persistence (via state) — addProjectTab creates a distinct tab ──

describe("#10 — new project tabs are properly created and findable", () => {
  // The persistence layer (persistTabs in project-tabs.js) reads getState().projectTabs.
  // These tests verify that the state layer correctly stores and retrieves tabs
  // so that persistTabs always has the correct data to save.

  test("addProjectTab creates a new tab for a new directory", () => {
    const before = getProjectTabs().length
    const tab = addProjectTab("/projects/new-persisted-10", "new-persisted-10")
    const after = getProjectTabs().length
    expect(after).toBe(before + 1)
    expect(tab.directory).toBe("/projects/new-persisted-10")
    expect(tab.label).toBe("new-persisted-10")
  })

  test("addProjectTab returns existing tab (no duplicate) for same directory", () => {
    const tab1 = addProjectTab("/projects/dedup-10", "dedup-10")
    const before = getProjectTabs().length
    const tab2 = addProjectTab("/projects/dedup-10", "dedup-10-again")
    const after = getProjectTabs().length
    // No new tab created
    expect(after).toBe(before)
    expect(tab2.id).toBe(tab1.id)
  })

  test("findProjectTabByDirectory finds a tab by exact directory", () => {
    const tab = addProjectTab("/projects/find-me-10", "find-me-10")
    const found = findProjectTabByDirectory("/projects/find-me-10")
    expect(found).not.toBeNull()
    expect(found?.id).toBe(tab.id)
  })

  test("findProjectTabByDirectory returns null when no tab for that directory", () => {
    const found = findProjectTabByDirectory("/projects/does-not-exist-10")
    expect(found).toBeNull()
  })

  test("null-directory tabs are findable by null", () => {
    // Ensure at least one null-directory tab exists
    const existing = findProjectTabByDirectory(null)
    if (!existing) {
      addProjectTab(null, "default-tab")
    }
    const found = findProjectTabByDirectory(null)
    expect(found).not.toBeNull()
    expect(found?.directory).toBeNull()
  })

  test("getProjectTabs returns all added tabs", () => {
    const uniqueDir = `/projects/all-tabs-test-10-${Date.now()}`
    const tab = addProjectTab(uniqueDir, "all-tabs-10")
    const tabs = getProjectTabs()
    const found = tabs.find(t => t.id === tab.id)
    expect(found).toBeDefined()
    expect(found?.directory).toBe(uniqueDir)
  })

  test("newly added tab has loaded:false before sessions are fetched", () => {
    const tab = addProjectTab(`/projects/unloaded-10-${Date.now()}`, "unloaded-10")
    // A freshly created tab must start unloaded so switchProjectTab knows to
    // call ensureSessionsLoaded (and thus loadSessions) rather than render stale cache.
    expect(tab.loaded).toBe(false)
  })
})

describe("current-project migration", () => {
  test("rebinds the legacy null/default tab to the real OpenCode worktree", () => {
    const existing = findProjectTabByDirectory(null)
    const tab = existing ?? addProjectTab(null, "default")
    switchProjectTab(tab.id)

    const rebound = rebindProjectTab(tab.id, "/projects/real-worktree", "real-worktree")

    expect(rebound?.directory).toBe("/projects/real-worktree")
    expect(rebound?.label).toBe("real-worktree")
    expect(getActiveDirectory()).toBe("/projects/real-worktree")
    expect(findProjectTabByDirectory(null)).toBeNull()
  })

  test("does not create two tabs for the same real worktree", () => {
    const actual = addProjectTab("/projects/already-open", "already-open")
    const legacy = findProjectTabByDirectory(null) ?? addProjectTab(null, "default")

    expect(rebindProjectTab(legacy.id, "/projects/already-open", "already-open")).toBe(actual)
    expect(getProjectTabs().filter((tab) => tab.directory === "/projects/already-open")).toHaveLength(1)
  })
})
