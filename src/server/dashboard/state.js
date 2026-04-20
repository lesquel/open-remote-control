// state.js — Single source of truth for app state with simple pub/sub
const listeners = new Map() // key → Set<callback>

const state = {
  token: null,
  serverUrl: "",     // empty = same-origin (embedded); set to tunnel URL in standalone mode

  // ── Project tabs (v1.11) ──
  // Each tab has its own cached view state so switching between projects is instant.
  // The top-level `sessions/statuses/sessionMeta/activeSession` slots below are
  // a live mirror of the *active* tab — kept in sync via syncActiveTabToState().
  // Existing modules continue to read those slots without changes.
  projectTabs: [],     // Array<{ id, directory, label, sessions, statuses, sessionMeta, activeSession }>
  activeProjectId: null,

  sessions: {},      // id → session object  (mirror of active tab)
  statuses: {},      // id → status string   (mirror of active tab)
  sessionMeta: {},   // id → { lastModel?: string, lastProvider?: string, lastAgent?: string }  (mirror of active tab)
  agentFilter: "",   // "" = all; otherwise exact agent/mode string
  activeSession: null, // (mirror of active tab)
  activeDirectory: null, // string | null — null = default (current OpenCode instance dir)
  multiviewActive: false,
  mvPanels: new Set(), // sessionIds open in multi-view
  pendingPerms: [],
  todos: [],         // Array<{ id, content, status: 'pending'|'in_progress'|'completed' }>
  settings: {
    sound: false,
    notif: false,
    theme: false,    // false = dark
    tools: true,
    showReasoning: false,  // Feature C: expand reasoning blocks by default
  },
  sse: { connected: false },
}

// ── activeDirectory getter/setter ─────────────────────────────────────────

export function getActiveDirectory() {
  return state.activeDirectory
}

export function setActiveDirectory(dir) {
  state.activeDirectory = dir ?? null
  notifyAll()
}

// ── Project tabs (v1.11) ─────────────────────────────────────────────────
// Tabs are the user-visible "open projects". Each tab caches its own session
// list so switching is instant (no refetch). Persistence lives in main.js.

let _tabIdCounter = 0
function nextTabId() {
  _tabIdCounter += 1
  return `tab-${Date.now().toString(36)}-${_tabIdCounter}`
}

function defaultTabLabel(directory) {
  if (!directory) return 'default'
  const parts = String(directory).split('/').filter(Boolean)
  return parts[parts.length - 1] || directory
}

/**
 * Find a tab by directory string. Tabs with `null` directory match `null`.
 */
export function findProjectTabByDirectory(directory) {
  const dir = directory ?? null
  return state.projectTabs.find(t => (t.directory ?? null) === dir) ?? null
}

export function getProjectTabs() {
  return state.projectTabs
}

export function getActiveProjectTab() {
  if (!state.activeProjectId) return null
  return state.projectTabs.find(t => t.id === state.activeProjectId) ?? null
}

/**
 * Create a fresh tab object for the given directory. Caller is responsible for
 * appending it to state.projectTabs and (typically) calling switchProjectTab.
 * If a tab for this directory already exists, returns the existing one instead
 * of creating a duplicate.
 */
export function addProjectTab(directory, label) {
  const dir = directory ?? null
  const existing = findProjectTabByDirectory(dir)
  if (existing) return existing
  const tab = {
    id:        nextTabId(),
    directory: dir,
    label:     label || defaultTabLabel(dir),
    sessions:      {},
    statuses:      {},
    sessionMeta:   {},
    activeSession: null,
    loaded:        false, // becomes true once sessions have been fetched at least once
  }
  state.projectTabs = [...state.projectTabs, tab]
  notifyAll()
  return tab
}

/**
 * Remove a tab by id. If the removed tab was active, the caller should pick a
 * new active tab and call switchProjectTab(newId) (or pass null if none left).
 * Returns the removed tab or null if not found.
 */
export function removeProjectTab(id) {
  const idx = state.projectTabs.findIndex(t => t.id === id)
  if (idx === -1) return null
  const [removed] = state.projectTabs.splice(idx, 1)
  state.projectTabs = [...state.projectTabs] // new array reference for any subscribers
  notifyAll()
  return removed
}

/**
 * Switch the active tab. Updates activeProjectId, activeDirectory, and mirrors
 * the tab's cached session data into the top-level state slots so existing
 * modules (sessions.js, label-strip.js, …) read the right project's data.
 *
 * Pass `null` to clear (no active tab).
 */
export function switchProjectTab(id) {
  if (id === null) {
    state.activeProjectId = null
    state.activeDirectory = null
    state.sessions      = {}
    state.statuses      = {}
    state.sessionMeta   = {}
    state.activeSession = null
    notifyAll()
    return null
  }
  const tab = state.projectTabs.find(t => t.id === id)
  if (!tab) return null
  state.activeProjectId = tab.id
  state.activeDirectory = tab.directory ?? null
  syncActiveTabToState()
  return tab
}

/**
 * Mirror the active tab's cached data into the top-level state slots used by
 * sessions.js, label-strip, multi-view, etc. Call after mutating an active
 * tab's data, or right after switchProjectTab().
 */
export function syncActiveTabToState() {
  const tab = getActiveProjectTab()
  if (!tab) {
    state.sessions      = {}
    state.statuses      = {}
    state.sessionMeta   = {}
    state.activeSession = null
  } else {
    state.sessions      = tab.sessions      ?? {}
    state.statuses      = tab.statuses      ?? {}
    state.sessionMeta   = tab.sessionMeta   ?? {}
    state.activeSession = tab.activeSession ?? null
  }
  notifyAll()
}

/**
 * Mirror current top-level state slots BACK into the active tab's cache.
 * Call after a write that mutated the top-level slots (loadSessions,
 * selectSession, deleteSession, etc.) so the cache stays current and
 * switching away/back doesn't lose data.
 */
export function syncStateToActiveTab() {
  const tab = getActiveProjectTab()
  if (!tab) return
  tab.sessions      = state.sessions
  tab.statuses      = state.statuses
  tab.sessionMeta   = state.sessionMeta
  tab.activeSession = state.activeSession
}

/**
 * Update the label of a tab (e.g. when the user renames it or after we learn
 * a friendlier name from /projects).
 */
export function setProjectTabLabel(id, label) {
  const tab = state.projectTabs.find(t => t.id === id)
  if (!tab) return
  tab.label = label
  notifyAll()
}

export function getState() {
  return state
}

// Keys that, when patched, should also be mirrored back into the active tab's
// cache so switching tabs preserves data (sessions list, active selection, …).
const _TAB_MIRRORED_KEYS = ['sessions', 'statuses', 'sessionMeta', 'activeSession']

export function setState(patch) {
  Object.assign(state, patch)
  // Mirror tab-scoped fields back into the active tab's cache so the cached
  // copy stays in sync with what UI modules just wrote.
  const tab = getActiveProjectTab()
  if (tab) {
    for (const k of _TAB_MIRRORED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        tab[k] = state[k]
      }
    }
  }
  notifyAll()
}

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(callback)
  return () => listeners.get(key).delete(callback)
}

// ── Streaming deltas (Feature B) ─────────────────────────────────────────
// In-memory buffer for parts currently receiving streaming deltas.
// Keyed by partId → { sessionId, messageId, text }
const _streamingParts = {}

/**
 * Append a text delta to an in-progress message part.
 * @param {string} sessionId
 * @param {string} messageId
 * @param {string} partId
 * @param {string} delta
 * @returns {boolean} - true if delta was applied
 */
export function appendPartDelta(sessionId, messageId, partId, delta) {
  if (!delta) return false
  if (!_streamingParts[partId]) {
    _streamingParts[partId] = { sessionId, messageId, text: '' }
  }
  _streamingParts[partId].text += delta
  return true
}

/**
 * Clear streaming state for a completed message (call when message.updated arrives).
 * @param {string} sessionId
 * @param {string} messageId
 */
export function clearStreamingMessage(sessionId, messageId) {
  for (const partId of Object.keys(_streamingParts)) {
    const p = _streamingParts[partId]
    if (p.sessionId === sessionId && p.messageId === messageId) {
      delete _streamingParts[partId]
    }
  }
}

/**
 * Get the current accumulated streaming text for a part, or null if not streaming.
 * @param {string} partId
 * @returns {string|null}
 */
export function getStreamingPartText(partId) {
  return _streamingParts[partId]?.text ?? null
}

/**
 * Check whether a part is currently streaming.
 * @param {string} partId
 * @returns {boolean}
 */
export function isPartStreaming(partId) {
  return partId in _streamingParts
}

function notifyAll() {
  for (const [, set] of listeners) {
    for (const cb of set) cb(state)
  }
}
