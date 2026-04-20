// sse.js — SSE connection with exponential backoff reconnect
import { getState, setState, appendPartDelta, clearStreamingMessage, subscribe } from './state.js'
import { loadSessions, renderSessions, updateHeaderSession, updateInfoBar, refreshSessionMeta } from './sessions.js'
import {
  loadMessages,
  applyStreamingDelta,
  removeStreamingCursor,
  showTypingIndicator,
  reconcileOptimisticUserMessage,
  ensureTextPartSurface,
  replacePartInDom,
} from './messages.js'
import { loadMVMessages, updateMVPanelStatus, renderMultiviewGrid } from './multi-view.js'
import { handlePermissionRequested, handlePermissionResolved } from './permissions.js'
import { onSubagentSpawned } from './subagents.js'
import { isFileEditingToolEvent } from './files-changed.js'
import { debouncedRefreshFilesChanged } from './files-changed-bridge.js'
import { buildApiUrl } from './api.js'
import { EVENTS, LIMITS } from './constants.js'
import { playNotifySound } from './notif-sound.js'

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
  EVENTS.MESSAGE_PART_DELTA,
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

  // ── Streaming deltas: incremental tokens for text / reasoning fields ─────
  // The SDK emits `message.part.delta` per token with { sessionID, messageID,
  // partID, field, delta }. This drives the typewriter effect. A separate
  // `message.part.updated` event emits snapshots for NON-text parts (tools
  // moving pending → running → completed) — handled below.
  if (t === EVENTS.MESSAGE_PART_DELTA) {
    const sessionId = d?.sessionID ?? ev.properties?.sessionID
    const messageId = d?.messageID ?? ev.properties?.messageID
    const partId    = d?.partID    ?? ev.properties?.partID
    const field     = d?.field     ?? ev.properties?.field
    const delta     = d?.delta     ?? ev.properties?.delta

    if (typeof delta !== 'string' || delta.length === 0) return
    if (sessionId !== activeSession || multiviewActive) {
      // Still accumulate for background sessions so a later switch has
      // the full text, but don't touch the DOM.
      appendPartDelta(sessionId, messageId, partId, delta)
      return
    }
    // Only apply to text fields; reasoning could also be streamed but we
    // currently render reasoning via snapshots only.
    if (field === 'text') {
      appendPartDelta(sessionId, messageId, partId, delta)
      // Guarantee a DOM surface — the first delta normally lands before
      // message.created (assistant) has rendered its bubble.
      ensureTextPartSurface(partId, messageId)
      applyStreamingDelta(partId, delta)
    }
    return
  }

  // ── Snapshot: full part state (tool pending → running → completed) ──────
  // Emitted for every state transition on non-text parts. We use this to
  // hot-swap the specific tool node in the DOM so the status icon, args,
  // and output update live — WITHOUT wiping the transcript (which would
  // drop any in-flight text deltas from the delta stream).
  if (t === EVENTS.MESSAGE_PART_UPDATED) {
    const part = d?.part ?? ev.properties?.part
    const sessionId = part?.sessionID
    if (!part || sessionId !== activeSession || multiviewActive) return
    replacePartInDom(part)
    return
  }

  if (t === EVENTS.MESSAGE_CREATED || t === EVENTS.MESSAGE_UPDATED) {
    // The SDK ONLY emits message.updated — message.created is never sent.
    // A single message fires many `message.updated` events during a turn
    // (user msg created, assistant msg init with empty content, assistant
    // final with tokens + cost, and user msg re-emitted with summary). We
    // must NOT re-fetch + full re-render on every one of those, because
    // `loadMessages → renderMessages` does `box.innerHTML = …` which blows
    // away in-flight text deltas (the typewriter). Instead:
    //   • user message → reconcile the optimistic bubble (or load once if
    //     no optimistic node exists).
    //   • assistant message → only full-reload when the message is final
    //     (`info.time.completed` set, or `info.finish` present). During
    //     streaming, rely on ensureTextPartSurface + applyStreamingDelta
    //     plus replacePartInDom for non-text parts.
    const info = ev.properties?.info ?? d?.info ?? d ?? {}
    const msgRole = info.role ?? d?.role ?? null
    const messageId = info.id ?? d?.id ?? d?.messageId ?? null
    const evtSessionId =
      ev.properties?.sessionID ?? ev.properties?.sessionId ?? d?.sessionID ?? d?.sessionId ?? null
    const isAssistant = msgRole === 'assistant'
    const isUser = msgRole === 'user'
    const isFinal =
      info?.time?.completed != null ||
      (isAssistant && typeof info?.finish === 'string' && info.finish.length > 0)

    if (t === EVENTS.MESSAGE_UPDATED && isFinal) {
      if (evtSessionId && messageId) {
        clearStreamingMessage(evtSessionId, messageId)
        if (evtSessionId === activeSession) {
          removeStreamingCursor(messageId)
        }
      }
    }

    // ── v1.9: sound + browser notification on assistant turn completion ──────
    // Only fire once the turn is actually done, not on intermediate updates.
    if (t === EVENTS.MESSAGE_UPDATED && isAssistant && isFinal && document.hidden) {
      const { settings } = getState()
      if (settings.sound) playNotifySound()
      if (settings.notif && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const { sessions } = getState()
          const sessionTitle = evtSessionId ? (sessions[evtSessionId]?.title ?? null) : null
          const body = sessionTitle ? `Response ready in "${sessionTitle}"` : 'Agent response ready'
          const n = new Notification('OpenCode Pilot', {
            body,
            icon: './icons/icon.svg',
            tag: 'pilot-msg-' + (evtSessionId ?? Date.now()),
          })
          n.onclick = () => {
            window.focus()
            if (evtSessionId) {
              import('./sessions.js').then(m => m.selectSession(evtSessionId)).catch(() => {})
            }
            n.close()
          }
        } catch (_) {}
      }
    }

    if (activeSession && !multiviewActive) {
      if (isUser) {
        // User message update: reconcile the optimistic bubble with the
        // real id, or load once if there's no pending optimistic node
        // (e.g. message came from another device / TUI / API).
        const hasPending = !!document.querySelector('.message.user[data-pending="1"]')
        if (hasPending) {
          if (messageId) reconcileOptimisticUserMessage(messageId)
        } else if (!document.querySelector(`.message.user[data-message-id="${messageId}"]`)) {
          loadMessages(activeSession)
        }
        // If the user message node is already in the DOM, do nothing —
        // intermediate user updates (e.g. summary attached) don't need a
        // re-render and would wipe streaming deltas.
      } else if (isAssistant) {
        if (isFinal) {
          // End of turn: do the full re-render so markdown, tool states,
          // and agent badges render from the canonical server snapshot.
          loadMessages(activeSession)
        } else if (!document.querySelector(`.message.assistant[data-message-id="${messageId}"]`)) {
          // Assistant message just initialised but we have no bubble yet.
          // Show a typing indicator; the first delta will replace it via
          // ensureTextPartSurface.
          showTypingIndicator()
        }
        // Intermediate assistant updates with an existing bubble: ignore.
        // Deltas + replacePartInDom drive the streaming DOM.
      }
    }
    if (evtSessionId && mvPanels.has(evtSessionId)) {
      loadMVMessages(evtSessionId)
    }
    // Refresh label strip and usage indicator on message events
    if (evtSessionId === activeSession || !evtSessionId) {
      window.__refreshLabelStrip?.()
      window.__refreshUsageIndicator?.()
      window.__agentPanel?.refresh?.()
    }
    // Refresh session meta for this session so sessions list shows fresh model/cost
    // Only on final updates — intermediate ones carry partial/stale token counts.
    if (t === EVENTS.MESSAGE_UPDATED && evtSessionId && isFinal) {
      refreshSessionMeta(evtSessionId)
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
