// sse.js — SSE connection with exponential backoff reconnect
import { getState, setState, appendPartDelta, clearStreamingMessage, subscribe } from './state.js'
import { loadSessions, renderSessions, updateHeaderSession, updateInfoBar } from './sessions.js'
import { loadMessages, applyStreamingDelta, removeStreamingCursor } from './messages.js'
import { loadMVMessages, updateMVPanelStatus, renderMultiviewGrid } from './multi-view.js'
import { handlePermissionRequested, handlePermissionResolved } from './permissions.js'
import { onSubagentSpawned } from './subagents.js'
import { isFileEditingToolEvent } from './files-changed.js'
import { debouncedRefreshFilesChanged } from './files-changed-bridge.js'
import { buildApiUrl } from './api.js'
import { EVENTS, LIMITS } from './constants.js'

let eventSource = null
let reconnectTimer = null
// Backoff state: starts at 1s, doubles to max 30s, resets on successful open
let backoffMs = LIMITS.SSE_BACKOFF_MIN_MS
const BACKOFF_MIN = LIMITS.SSE_BACKOFF_MIN_MS
const BACKOFF_MAX = LIMITS.SSE_BACKOFF_MAX_MS

// Tooltip metadata for the SSE dot
let _lastConnectTime = null
let _reconnectAttempts = 0

const SSE_EVENTS = [
  EVENTS.SESSION_UPDATED,
  EVENTS.SESSION_CREATED,
  EVENTS.SESSION_DELETED,
  EVENTS.MESSAGE_CREATED,
  EVENTS.MESSAGE_UPDATED,
  EVENTS.MESSAGE_PART_UPDATED,
  EVENTS.PERMISSION_REQUESTED,
  EVENTS.PERMISSION_RESOLVED,
  EVENTS.STATUS_CHANGED,
  EVENTS.TODO_UPDATED,
]

/**
 * Update the connection indicator in the header.
 * status: 'connected' | 'reconnecting' | 'disconnected'
 */
function setConnectionStatus(status) {
  const dot = document.getElementById('conn-dot')
  const label = document.getElementById('conn-label')
  if (!dot) return

  dot.className = 'conn-dot ' + status

  if (label) {
    if (status === 'connected') {
      label.textContent = ''
      label.className = 'conn-label'
    } else if (status === 'reconnecting') {
      label.textContent = 'reconnecting…'
      label.className = 'conn-label reconnecting'
    } else {
      label.textContent = 'offline'
      label.className = 'conn-label'
    }
  }

  // Update tooltip with last connect time + reconnect attempt count
  const timeStr = _lastConnectTime
    ? `Last connected: ${new Date(_lastConnectTime).toLocaleTimeString()}`
    : 'Never connected'
  const attemptsStr = _reconnectAttempts > 0
    ? ` · Reconnect attempts: ${_reconnectAttempts}`
    : ''
  dot.title = `SSE: ${status} · ${timeStr}${attemptsStr}`
}

export function connect() {
  const { token } = getState()
  if (!token) return

  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  // Build /events URL via api.js so activeDirectory is appended when set
  // and serverUrl (tunnel) is respected. Then append the token.
  const base = buildApiUrl('/events')
  const sep = base.includes('?') ? '&' : '?'
  const url = `${base}${sep}token=${encodeURIComponent(token)}`
  eventSource = new EventSource(url)

  eventSource.onopen = () => {
    backoffMs = BACKOFF_MIN          // reset backoff on successful connection
    _lastConnectTime = Date.now()
    _reconnectAttempts = 0
    setConnectionStatus('connected')
    setState({ sse: { connected: true } })
    loadSessions(true)
  }

  eventSource.onerror = () => {
    setConnectionStatus('reconnecting')
    setState({ sse: { connected: false } })
    eventSource.close()
    eventSource = null
    scheduleReconnect()
  }

  eventSource.onmessage = e => {
    try { handleEvent(JSON.parse(e.data)) } catch (_) {}
  }

  // Named event types
  SSE_EVENTS.forEach(name => {
    eventSource.addEventListener(name, e => {
      try { handleEvent({ type: name, data: JSON.parse(e.data) }) } catch (_) {}
    })
  })
}

// When activeDirectory changes, close the current stream and reconnect so the
// new URL (?directory=…) takes effect. The backend event bus is global, but
// reconnecting keeps the SSE URL in sync and gives a clean state.
let _lastSSEDirectory = null
subscribe('sse-dir', (state) => {
  const dir = state.activeDirectory ?? null
  if (dir === _lastSSEDirectory) return
  _lastSSEDirectory = dir
  // Only reconnect if we already have a live connection
  if (eventSource) {
    eventSource.close()
    eventSource = null
    connect()
  }
})

function scheduleReconnect() {
  if (reconnectTimer) return
  _reconnectAttempts++
  setConnectionStatus('reconnecting')  // update tooltip with new attempt count
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
    // Double the backoff for next failure, capped at BACKOFF_MAX
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX)
  }, backoffMs)
}

async function handleEvent(ev) {
  const t = ev.type ?? ''
  const d = ev.data ?? ev
  // Track last event for debug modal (B6/B7)
  window.__debugSseLastEvent = { type: t, ts: new Date().toISOString() }
  const { activeSession, multiviewActive, mvPanels, sessions } = getState()

  if (t.startsWith('session')) {
    loadSessions()
  }

  // ── Feature B: streaming delta for text parts ──────────────────────────
  if (t === EVENTS.MESSAGE_PART_UPDATED) {
    // ev.data has { part, delta? } — delta is the incremental text chunk
    const part = d?.part ?? ev.properties?.part
    const delta = d?.delta ?? ev.properties?.delta
    const sessionId = part?.sessionID
    const messageId = part?.messageID
    const partId = part?.id

    if (part?.type === 'text' && typeof delta === 'string' && delta.length > 0) {
      // Accumulate delta in state
      appendPartDelta(sessionId, messageId, partId, delta)
      // Update DOM directly if this session is the active one
      if (sessionId === activeSession && !multiviewActive) {
        applyStreamingDelta(partId, delta)
      }
    }
    // Fallback: if no delta field, do nothing here — message.updated will re-render
    return
  }

  if (t === EVENTS.MESSAGE_CREATED || t === EVENTS.MESSAGE_UPDATED) {
    // On message.updated: clear streaming state for this message (it's complete)
    if (t === EVENTS.MESSAGE_UPDATED) {
      const sessionId = d?.sessionId ?? ev.properties?.sessionID
      const messageId = d?.id ?? d?.messageId ?? ev.properties?.id
      if (sessionId && messageId) {
        clearStreamingMessage(sessionId, messageId)
        // Remove blinking cursor if present
        if (sessionId === activeSession) {
          removeStreamingCursor(messageId)
        }
      }
    }

    if (activeSession && !multiviewActive) {
      loadMessages(activeSession)
    }
    if (d?.sessionId && mvPanels.has(d.sessionId)) {
      loadMVMessages(d.sessionId)
    }
    // Refresh label strip and usage indicator on message events
    if (d?.sessionId === activeSession || !d?.sessionId) {
      window.__refreshLabelStrip?.()
      window.__refreshUsageIndicator?.()
      window.__agentPanel?.refresh?.()
    }
  }

  if (t === EVENTS.PERMISSION_REQUESTED) {
    handlePermissionRequested(d)
    // Dispatch for push-notifications module
    window.dispatchEvent(new CustomEvent('pilot:permission:pending', { detail: d }))
  }

  if (t === EVENTS.PERMISSION_RESOLVED) {
    handlePermissionResolved(d)
  }

  if (t === EVENTS.TODO_UPDATED) {
    window.dispatchEvent(new CustomEvent('pilot:todo:updated', { detail: d }))
  }

  if (t === EVENTS.PILOT_SUBAGENT_SPAWNED) {
    // Pilot events carry payload under .properties (not .data)
    onSubagentSpawned(ev.properties ?? d)
  }

  // Debounced diff refresh when a file-editing tool completes
  if (t === EVENTS.PILOT_TOOL_COMPLETED || t === EVENTS.TOOL_COMPLETED) {
    const payload = ev.properties ?? d
    if (isFileEditingToolEvent(payload)) {
      if (activeSession) debouncedRefreshFilesChanged(activeSession)
      // Also refresh multi-view panels belonging to the session that emitted the event
      const toolSessionId = payload?.sessionID ?? payload?.sessionId ?? null
      if (toolSessionId && mvPanels?.has?.(toolSessionId)) {
        loadMVMessages(toolSessionId)
      }
    }
  }

  if (t === EVENTS.STATUS_CHANGED && d.sessionId && d.status) {
    const statuses = { ...getState().statuses, [d.sessionId]: d.status }
    setState({ statuses })
    renderSessions()
    if (d.sessionId === activeSession) {
      const s = sessions[d.sessionId]
      const title = s?.title || d.sessionId.slice(0, 8)
      updateHeaderSession(title, d.status)
      updateInfoBar(d.sessionId, title, d.status, s)
    }
    updateMVPanelStatus(d.sessionId, d.status)
  }

  if (t === EVENTS.VCS_BRANCH_UPDATED) {
    window.__rightPanelSetBranch?.(ev.properties?.branch ?? ev.branch ?? d?.branch ?? null)
  }

  if (t === EVENTS.LSP_UPDATED) {
    // Refresh references (which re-fetches /lsp/status) then re-render the right panel
    window.__refreshReferences?.().then(() => {
      window.__refreshRightPanel?.()
    }).catch(() => {})
  }
}
