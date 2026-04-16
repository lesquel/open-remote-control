// sse.js — SSE connection, reconnect logic, and event dispatch
import { getState, setState } from './state.js'
import { loadSessions, renderSessions, updateHeaderSession, updateInfoBar } from './sessions.js'
import { loadMessages } from './messages.js'
import { loadMVMessages, updateMVPanelStatus, renderMultiviewGrid } from './multi-view.js'
import { handlePermissionRequested, handlePermissionResolved } from './permissions.js'

let eventSource = null
let reconnectTimer = null

const SSE_EVENTS = [
  'session.updated',
  'session.created',
  'session.deleted',
  'message.created',
  'message.updated',
  'permission.requested',
  'permission.resolved',
  'status.changed',
]

export function connect() {
  const { token, serverUrl } = getState()
  if (!token) return

  if (eventSource) eventSource.close()

  const dot = document.getElementById('conn-dot')
  const base = serverUrl || ''
  const url = `${base}/events?token=${encodeURIComponent(token)}`
  eventSource = new EventSource(url)

  eventSource.onopen = () => {
    dot.className = 'dot connected'
    dot.title = 'Connected'
    setState({ sse: { connected: true } })
    loadSessions(true)
  }

  eventSource.onerror = () => {
    dot.className = 'dot error'
    dot.title = 'Disconnected'
    setState({ sse: { connected: false } })
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

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

async function handleEvent(ev) {
  const t = ev.type ?? ''
  const d = ev.data ?? ev
  const { activeSession, multiviewActive, mvPanels, sessions } = getState()

  if (t.startsWith('session')) {
    loadSessions()
  }

  if (t === 'message.created' || t === 'message.updated') {
    if (activeSession && !multiviewActive) {
      loadMessages(activeSession)
    }
    if (d?.sessionId && mvPanels.has(d.sessionId)) {
      loadMVMessages(d.sessionId)
    }
  }

  if (t === 'permission.requested') {
    handlePermissionRequested(d)
  }

  if (t === 'permission.resolved') {
    handlePermissionResolved(d)
  }

  if (t === 'status.changed' && d.sessionId && d.status) {
    const statuses = { ...getState().statuses, [d.sessionId]: d.status }
    setState({ statuses })
    renderSessions()
    if (d.sessionId === activeSession) {
      const s = sessions[d.sessionId]
      const title = s?.title || d.sessionId.slice(0, 8)
      updateHeaderSession(title, d.status)
      updateInfoBar(d.sessionId, title, d.status)
    }
    updateMVPanelStatus(d.sessionId, d.status)
  }
}
