// state.js — Single source of truth for app state with simple pub/sub
const listeners = new Map() // key → Set<callback>

const state = {
  token: null,
  serverUrl: "",     // empty = same-origin (embedded); set to tunnel URL in standalone mode
  sessions: {},      // id → session object
  statuses: {},      // id → status string
  sessionMeta: {},   // id → { lastModel?: string, lastProvider?: string, lastAgent?: string }
  agentFilter: "",   // "" = all; otherwise exact agent/mode string
  activeSession: null,
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

export function getState() {
  return state
}

export function setState(patch) {
  Object.assign(state, patch)
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
