// sessions.js — Sessions list, single-session panel, send prompt, abort
import { getState, setState } from './state.js'
import { fetchSessions, createSession as apiCreateSession, sendPrompt as apiSendPrompt, abortSession as apiAbortSession } from './api.js'
import { loadMessages } from './messages.js'
import { loadDiff } from './diff.js'
import { toast } from './toast.js'

// Dynamic import to break circular dependency with multi-view.js
async function addToMultiview(id) {
  const { addToMultiview: fn } = await import('./multi-view.js')
  return fn(id)
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function statusClass(s) {
  if (s === 'busy' || s === 'running') return 'busy'
  if (s === 'error') return 'error'
  return 'idle'
}

export function timeAgo(ts) {
  if (!ts) return ''
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Load & render sessions list ────────────────────────────────────────────

export async function loadSessions(autoSelectMostRecent) {
  try {
    const data = await fetchSessions()
    const sessions = {}
    const statuses = data.statuses ?? {}
    for (const s of (data.sessions ?? [])) sessions[s.id] = s
    setState({ sessions, statuses })
    renderSessions()
    if (autoSelectMostRecent && !getState().activeSession) autoSelect()
    const { multiviewActive } = getState()
    if (multiviewActive) {
      const { renderMultiviewGrid } = await import('./multi-view.js')
      renderMultiviewGrid()
    }
  } catch (_) {
    toast('Failed to load sessions')
  }
}

function autoSelect() {
  const { sessions } = getState()
  const ids = Object.keys(sessions)
  if (!ids.length) return
  const best = ids.reduce((a, b) => {
    const ta = sessions[a]?.time?.updated ?? 0
    const tb = sessions[b]?.time?.updated ?? 0
    return tb > ta ? b : a
  })
  selectSession(best)
}

export function renderSessions() {
  const { sessions, statuses, activeSession, mvPanels } = getState()
  const list = document.getElementById('sessions-list')
  const ids = Object.keys(sessions)

  if (!ids.length) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:.82rem;text-align:center">No sessions yet</div>'
    return
  }

  ids.sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0))
  list.innerHTML = ids.map(id => {
    const s = sessions[id]
    const status = statuses[id] ?? 'idle'
    const title = s.title || id.slice(0, 8)
    const cls = id === activeSession ? 'active' : ''
    const ago = timeAgo(s?.time?.updated)
    const inMV = mvPanels.has(id) ? ' style="border-left-color:var(--warning)"' : ''
    return `<div class="session-item ${cls}" data-id="${id}"${inMV}>
      <div class="session-title">${esc(title)}</div>
      <div class="session-meta">
        <span class="badge badge-${statusClass(status)}">${status}</span>
        ${ago ? `<span class="session-time">${ago}</span>` : ''}
      </div>
    </div>`
  }).join('')

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      const { multiviewActive } = getState()
      if (multiviewActive) {
        addToMultiview(el.dataset.id)
      } else {
        selectSession(el.dataset.id)
      }
    })
  })
}

// ── Select session ─────────────────────────────────────────────────────────

export async function selectSession(id) {
  const { sessions, statuses } = getState()
  setState({ activeSession: id })
  const s = sessions[id]
  const status = statuses[id] ?? 'idle'
  const title = s?.title || id?.slice(0, 8) || 'Session'
  renderSessions()
  updateHeaderSession(title, status)
  updateInfoBar(id, title, status)
  document.getElementById('session-tabs').style.display = ''
  const input = document.getElementById('prompt-input')
  input.disabled = false
  input.placeholder = 'Type a prompt… (Enter to send)'
  await loadMessages(id)
  input.focus()
  // Load diff tab if it's currently active
  if (document.getElementById('diff-tab').classList.contains('active')) {
    loadDiff(id)
  }
}

export function updateHeaderSession(title, status) {
  const label = document.getElementById('header-session-label')
  const badge = document.getElementById('header-status-badge')
  label.innerHTML = `Session: <span>${esc(title)}</span>`
  badge.textContent = status
  badge.className = `badge badge-${statusClass(status)}`
  badge.style.display = ''
}

export function updateInfoBar(id, title, status) {
  const bar = document.getElementById('session-info-bar')
  bar.classList.remove('hidden')
  document.getElementById('info-title').textContent = title
  const statusBadge = document.getElementById('info-status-badge')
  statusBadge.textContent = status
  statusBadge.className = `badge badge-${statusClass(status)}`
  const infoId = document.getElementById('info-id')
  infoId.textContent = id.slice(0, 14) + '…'
  infoId.onclick = () => { navigator.clipboard?.writeText(id); toast('Session ID copied') }
  const abortBtn = document.getElementById('abort-btn')
  if (status === 'busy' || status === 'running') abortBtn.classList.add('visible')
  else abortBtn.classList.remove('visible')
}

// ── Create session ─────────────────────────────────────────────────────────

export async function createSession() {
  try {
    const s = await apiCreateSession()
    if (s?.id) {
      const { sessions, multiviewActive } = getState()
      setState({ sessions: { ...sessions, [s.id]: s } })
      renderSessions()
      if (multiviewActive) {
        addToMultiview(s.id)
      } else {
        selectSession(s.id)
      }
    }
  } catch (_) {
    toast('Failed to create session')
  }
}

// ── Send prompt ────────────────────────────────────────────────────────────

async function sendPrompt() {
  const { activeSession } = getState()
  if (!activeSession) { toast('Select a session first'); return }
  const input = document.getElementById('prompt-input')
  const msg = input.value.trim()
  if (!msg) return
  input.value = ''
  input.style.height = ''
  try {
    await apiSendPrompt(activeSession, msg)
    await loadMessages(activeSession)
  } catch (_) {
    toast('Failed to send prompt')
  }
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById(tab.dataset.tab)?.classList.add('active')
      const { activeSession } = getState()
      if (tab.dataset.tab === 'diff-tab' && activeSession) loadDiff(activeSession)
    })
  })
}

// ── Wire up DOM events ─────────────────────────────────────────────────────

export function initSessions() {
  initTabs()

  document.getElementById('send-btn').addEventListener('click', sendPrompt)

  document.getElementById('prompt-input').addEventListener('keydown', e => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && e.ctrlKey)) {
      e.preventDefault()
      sendPrompt()
    }
  })

  document.getElementById('prompt-input').addEventListener('input', function() {
    this.style.height = ''
    this.style.height = Math.min(this.scrollHeight, 120) + 'px'
  })

  document.getElementById('abort-btn').addEventListener('click', async () => {
    const { activeSession } = getState()
    if (!activeSession) return
    try {
      await apiAbortSession(activeSession)
      toast('Session aborted')
    } catch (_) {
      toast('Failed to abort')
    }
  })

  document.getElementById('header-new-btn').addEventListener('click', createSession)
  document.getElementById('new-session-big').addEventListener('click', createSession)
  document.getElementById('no-session-new-btn').addEventListener('click', createSession)
}
