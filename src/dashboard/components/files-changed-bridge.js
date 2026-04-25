// files-changed-bridge.js — Singleton bridge so sessions.js can call the panel
// without a circular dependency (sessions → bridge → panel, not sessions → panel → sessions).

/** @type {{ refresh: Function, debouncedRefresh: Function, destroy: Function } | null} */
let _panel = null

/**
 * Called by main.js after the panel is constructed.
 */
export function registerFilesChangedPanel(panel) {
  _panel = panel
}

/**
 * Called by sessions.js selectSession.
 */
export function refreshFilesChanged(sessionId) {
  _panel?.refresh(sessionId)?.catch(() => {})
}

/**
 * Called by sse.js when a file-editing tool completes.
 */
export function debouncedRefreshFilesChanged(sessionId) {
  _panel?.debouncedRefresh(sessionId)
}
