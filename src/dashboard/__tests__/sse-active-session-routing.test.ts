// sse-active-session-routing.test.ts — Regression tests for issue #17
//
// P0 regression: commit 909e52f added a background loadSessions(false) in the
// already-loaded tab path of switchProjectTab (project-tabs.js). That call
// fires concurrently with SSE events and calls setState({ sessions }) without
// autoSelectMostRecent, so if activeSession is null at that moment (e.g. the
// tab was switched to before any session was selected), it stays null. The SSE
// handleEvent guard `if (activeSession && !multiviewActive)` then skips
// loadMessages entirely — AI responses never render.
//
// These tests exercise the state-layer contract that handleEvent depends on:
//   1. setState({ sessions }) must preserve activeSession (not clear it).
//   2. A tab's cached activeSession must survive switchProjectTab for that tab.
//   3. After setState({ sessions }) without autoSelect, getState().activeSession
//      must equal the session that was active before the call.
//
// state.js is pure JS (no browser APIs), so it can be imported directly.

import { describe, expect, test } from "bun:test"
import {
  addProjectTab,
  switchProjectTab,
  getActiveProjectTab,
  getState,
  setState,
  findProjectTabByDirectory,
} from "../state/state"

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueDir(suffix: string) {
  return `/projects/sse-routing-${suffix}-${Date.now()}`
}

// ── #17 — activeSession must survive concurrent setState({ sessions }) ────────

describe("#17 regression — activeSession routing for SSE handleEvent", () => {
  // ── FAILING test (proves the regression) ────────────────────────────────────
  // The already-loaded tab path in switchProjectTab fires
  // loadSessions(false) in the background. That function calls
  // setState({ sessions, statuses }) WITHOUT calling autoSelect() because
  // autoSelectMostRecent is false.
  //
  // If the tab's cached activeSession is null AND sessions are available,
  // switchProjectTab restores null via syncActiveTabToState(). The background
  // loadSessions(false) then runs setState({ sessions }) without fixing the
  // null — so when SSE fires message.updated (isFinal), handleEvent reads
  // null from getState().activeSession and skips loadMessages entirely.
  //
  // EXPECTED (after fix): remove the background loadSessions(false) call so
  // the already-loaded path never silently races with SSE events. The SSE
  // onopen handler and session.* event handler already guarantee freshness.
  //
  // HOW THIS MAPS TO THE STATE LAYER:
  // switchProjectTab(id) in state.js always calls syncActiveTabToState(),
  // which sets state.activeSession = tab.activeSession ?? null.
  // If tab.activeSession is null (no session cached for that tab), the
  // resulting state.activeSession = null breaks SSE routing.
  // After the fix, the already-loaded path in project-tabs.js no longer fires
  // the background loadSessions(false); instead it relies on SSE session.* events
  // which call loadSessions() and subsequently auto-select the best session when
  // needed. The already-loaded branch now also explicitly calls loadSessions(true)
  // when state.activeSession is null after the tab switch, guaranteeing SSE routing.

  test("(#17 FAILING) tab switch for already-loaded tab with null activeSession must still expose a session to SSE routing", () => {
    // Arrange: an already-loaded tab with sessions cached but no session selected
    const dir = uniqueDir("failing-17")
    const tab = addProjectTab(dir, "failing-17")
    // Populate the tab's session cache directly (simulates the "already loaded" state)
    tab.sessions = { "sess-fail-17": { id: "sess-fail-17", title: "My Session" } }
    tab.loaded = true
    // Critically: tab.activeSession = null (was never set — user never clicked on a session)

    // Act: switch to this tab (as project-tabs.js does for already-loaded tabs)
    switchProjectTab(tab.id)

    // After switchProjectTab, syncActiveTabToState() runs and restores
    // tab.activeSession = null into state.activeSession. The background
    // loadSessions(false) (the #9 addition) then fires setState({ sessions })
    // WITHOUT calling autoSelect(), leaving state.activeSession = null.
    //
    // Simulate the background loadSessions(false) completing (no autoSelect):
    setState({ sessions: tab.sessions, statuses: {} })

    // Assert: SSE routing requires activeSession to be non-null when sessions exist.
    // This FAILS with the current code because neither switchProjectTab nor the
    // background loadSessions(false) auto-selects a session for an already-loaded tab.
    //
    // After the fix (remove background loadSessions(false), use loadSessions(true)
    // when activeSession is null), this assertion must pass.
    expect(getState().activeSession).not.toBeNull()  // FAILS: stays null
  })
  // Core contract: handleEvent in sse.js reads getState().activeSession at
  // the top of every call. If that value is null when message.updated (isFinal)
  // arrives, the `if (activeSession && !multiviewActive)` guard is false and
  // loadMessages is never called — the AI response is silently dropped.

  test("setState({ sessions }) does not clear activeSession", () => {
    // Arrange: tab with an active session
    const dir = uniqueDir("preserve-active")
    const tab = addProjectTab(dir, "preserve-active")
    switchProjectTab(tab.id)
    setState({ activeSession: "sess-preserve-1" })

    expect(getState().activeSession).toBe("sess-preserve-1")

    // Act: simulate background loadSessions(false) completing — it calls
    // setState({ sessions, statuses }) without touching activeSession.
    const freshSessions = { "sess-preserve-1": { id: "sess-preserve-1", title: "My Chat" } }
    setState({ sessions: freshSessions, statuses: { "sess-preserve-1": "idle" } })

    // Assert: activeSession must survive the sessions overwrite
    expect(getState().activeSession).toBe("sess-preserve-1")
  })

  test("active tab's cached activeSession survives setState({ sessions })", () => {
    // The tab-level cache must also agree with getState().activeSession so
    // a subsequent switchProjectTab restores the correct value.
    const dir = uniqueDir("tab-cache")
    const tab = addProjectTab(dir, "tab-cache")
    switchProjectTab(tab.id)
    setState({ activeSession: "sess-tab-cache-1" })

    const freshSessions = { "sess-tab-cache-1": { id: "sess-tab-cache-1", title: "Chat" } }
    setState({ sessions: freshSessions })

    // Both the top-level mirror and the tab's own cache must agree
    expect(getState().activeSession).toBe("sess-tab-cache-1")
    expect(getActiveProjectTab()?.activeSession).toBe("sess-tab-cache-1")
  })

  test("multiple consecutive setState({ sessions }) calls preserve activeSession", () => {
    // Simulates rapid session.* SSE events each triggering loadSessions():
    // every call produces setState({ sessions }) — none should clear the
    // user's current selection.
    const dir = uniqueDir("multi-load")
    const tab = addProjectTab(dir, "multi-load")
    switchProjectTab(tab.id)
    setState({ activeSession: "sess-multi-1" })

    for (let i = 0; i < 5; i++) {
      setState({ sessions: { "sess-multi-1": { id: "sess-multi-1", title: `Load ${i}` } } })
    }

    expect(getState().activeSession).toBe("sess-multi-1")
    expect(getActiveProjectTab()?.activeSession).toBe("sess-multi-1")
  })

  test("switchProjectTab for an already-loaded tab preserves activeSession from cache", () => {
    // When switchProjectTab(id) runs for an already-loaded tab, state.js calls
    // syncActiveTabToState() which restores tab.activeSession into state.
    // This must equal what was previously cached via setState({ activeSession }).
    const dir = uniqueDir("loaded-switch")
    const tab = addProjectTab(dir, "loaded-switch")
    switchProjectTab(tab.id)
    setState({ activeSession: "sess-loaded-1" })

    // Simulate tab marked as loaded (project-tabs.js sets tab.loaded = true
    // after ensureSessionsLoaded, and main.js sets it after loadSessions(true))
    const activeTab = getActiveProjectTab()!
    activeTab.loaded = true

    // Simulate the switchProjectTab state.js call for same tab
    // (project-tabs.js calls stateSwitchTab which calls syncActiveTabToState)
    switchProjectTab(tab.id)

    // The restored state must match what was cached
    expect(getState().activeSession).toBe("sess-loaded-1")
    expect(getActiveProjectTab()?.activeSession).toBe("sess-loaded-1")
  })

  // ── The FAILING scenario from #17 ─────────────────────────────────────────
  // This test encodes the exact contract that breaks when background
  // loadSessions(false) is called with autoSelectMostRecent=false while
  // activeSession is null.
  //
  // Before the fix: the background loadSessions(false) fires setState({ sessions })
  // WITHOUT calling autoSelect(), leaving activeSession=null even though sessions
  // are available. Any subsequent SSE message.updated event then hits the
  // `if (activeSession && !multiviewActive)` guard with null → false → no render.
  //
  // After the fix (remove background loadSessions): the tab cache always has the
  // previously-selected session restored by syncActiveTabToState(), so the SSE
  // handler always sees a non-null activeSession for a tab that had one.

  test("(#17 regression) setState({ sessions }) WITHOUT autoSelect must not leave activeSession null when a session existed before", () => {
    // Arrange: tab has a session selected
    const dir = uniqueDir("regression-17")
    const tab = addProjectTab(dir, "regression-17")
    switchProjectTab(tab.id)

    // User selected a session
    setState({ sessions: { "sess-r17": { id: "sess-r17", title: "AI Chat" } } })
    setState({ activeSession: "sess-r17" })
    expect(getState().activeSession).toBe("sess-r17")

    // Act: simulate what the background loadSessions(false) does.
    // It calls setState({ sessions, statuses }) without autoSelect.
    // Even if it fetches a fresh list (possibly with more/fewer sessions),
    // activeSession must survive.
    const refreshedSessions = {
      "sess-r17": { id: "sess-r17", title: "AI Chat" },
      "sess-other": { id: "sess-other", title: "Other" },
    }
    setState({ sessions: refreshedSessions, statuses: { "sess-r17": "idle" } })

    // Assert: activeSession must NOT be null after the background refresh
    // (The SSE handleEvent guard `if (activeSession && !multiviewActive)` needs
    // this to be non-null to call loadMessages and render AI responses.)
    expect(getState().activeSession).toBe("sess-r17")

    // The tab cache must also be consistent — a future switchProjectTab call
    // will restore this to state via syncActiveTabToState.
    expect(getActiveProjectTab()?.activeSession).toBe("sess-r17")
  })

  test("(#17 regression) SSE routing: active tab's session must equal state.activeSession after setState({ sessions })", () => {
    // This invariant is what sse.js handleEvent depends on:
    //   const { activeSession } = getState()    ← reads state
    //   if (activeSession && !multiviewActive)  ← must be truthy for a session tab
    //     loadMessages(activeSession)           ← renders AI response
    //
    // If state.activeSession diverges from getActiveProjectTab().activeSession,
    // a future switchProjectTab restores the wrong value and SSE routing breaks.

    const dir = uniqueDir("invariant-17")
    const tab = addProjectTab(dir, "invariant-17")
    switchProjectTab(tab.id)
    setState({ sessions: { "sess-inv": { id: "sess-inv" } } })
    setState({ activeSession: "sess-inv" })

    // Simulate background loadSessions effects (multiple setState calls)
    setState({ sessions: { "sess-inv": { id: "sess-inv", title: "Updated title" } } })
    setState({ sessionMeta: { "sess-inv": { lastModel: "gpt-4", lastProvider: "openai" } } })

    // The invariant that SSE routing depends on:
    const stateSession = getState().activeSession
    const tabSession   = getActiveProjectTab()?.activeSession

    expect(stateSession).toBe("sess-inv")   // SSE handler reads this
    expect(tabSession).toBe("sess-inv")     // future switchProjectTab restores this
    expect(stateSession).toBe(tabSession)   // they must agree
  })
})
