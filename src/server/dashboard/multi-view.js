// multi-view.js — Multi-session split view
import { getState, setState } from './state.js'
import { fetchMessages, sendPrompt as apiSendPrompt } from './api.js'
import { statusClass } from './sessions.js'
import { toast } from './toast.js'

const STORAGE_KEY_PANELS = 'pilot_mvpanels'
const STORAGE_KEY_ACTIVE = 'pilot_mvactive'

// ── Persistence ────────────────────────────────────────────────────────────

export function loadMVState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY_PANELS) || '[]')
    const mvPanels = new Set(saved)
    const multiviewActive = sessionStorage.getItem(STORAGE_KEY_ACTIVE) === '1' && mvPanels.size > 0
    setState({ mvPanels, multiviewActive })
    if (multiviewActive) {
      document.getElementById('multiview-btn').style.background = 'rgba(0,217,255,.15)'
    }
  } catch (_) {}
}

export function saveMVState() {
  const { mvPanels, multiviewActive } = getState()
  sessionStorage.setItem(STORAGE_KEY_PANELS, JSON.stringify([...mvPanels]))
  sessionStorage.setItem(STORAGE_KEY_ACTIVE, multiviewActive ? '1' : '0')
}

// ── Show / hide ────────────────────────────────────────────────────────────

export function showMultiview() {
  document.getElementById('single-view').style.display = 'none'
  const grid = document.getElementById('multiview-grid')
  grid.classList.add('active')
  renderMultiviewGrid()
}

export function hideMultiview() {
  document.getElementById('single-view').style.display = 'flex'
  document.getElementById('multiview-grid').classList.remove('active')
}

// ── Grid rendering ─────────────────────────────────────────────────────────

export function renderMultiviewGrid() {
  const { mvPanels } = getState()
  const grid = document.getElementById('multiview-grid')
  grid.innerHTML = ''
  mvPanels.forEach(id => grid.appendChild(createMVPanel(id)))

  const addBtn = document.createElement('button')
  addBtn.id = 'mv-add-btn'
  addBtn.textContent = '+ Add session'
  addBtn.addEventListener('click', openSessionPicker)
  grid.appendChild(addBtn)
}

export function addToMultiview(id) {
  const { mvPanels } = getState()
  if (mvPanels.has(id)) { toast('Already in view'); return }
  const next = new Set(mvPanels)
  next.add(id)
  setState({ mvPanels: next })
  saveMVState()
  renderMultiviewGrid()
  // Re-render sessions list to show MV highlight
  import('./sessions.js').then(m => m.renderSessions())
}

function removeFromMultiview(id) {
  const { mvPanels } = getState()
  const next = new Set(mvPanels)
  next.delete(id)
  setState({ mvPanels: next })
  saveMVState()
  renderMultiviewGrid()
  import('./sessions.js').then(m => m.renderSessions())
}

// ── Panel creation ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createMVPanel(id) {
  const { sessions, statuses } = getState()
  const s = sessions[id]
  const status = statuses[id] ?? 'idle'
  const title = s?.title || id.slice(0, 8)

  const panel = document.createElement('div')
  panel.className = 'mv-panel'
  panel.dataset.sessionId = id
  panel.innerHTML = `
    <div class="mv-header">
      <span class="mv-title">${esc(title)}</span>
      <span class="badge badge-${statusClass(status)} mv-badge" id="mv-badge-${id}">${status}</span>
      <button class="mv-close" title="Close panel">✕</button>
    </div>
    <div class="mv-messages" id="mv-msgs-${id}">
      <div style="color:var(--text-dim);font-size:.78rem">Loading…</div>
    </div>
    <div class="mv-input-row">
      <input class="mv-input" placeholder="Type a prompt…" id="mv-input-${id}">
      <button class="mv-send" id="mv-send-${id}">↑</button>
    </div>`

  panel.querySelector('.mv-close').addEventListener('click', () => removeFromMultiview(id))

  const sendBtn = panel.querySelector(`#mv-send-${id}`)
  const inp = panel.querySelector(`#mv-input-${id}`)

  const doSend = async () => {
    const msg = inp.value.trim()
    if (!msg) return
    inp.value = ''
    try {
      await apiSendPrompt(id, msg)
      await loadMVMessages(id)
    } catch (_) {
      toast('Failed to send')
    }
  }

  sendBtn.addEventListener('click', doSend)
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSend() })

  loadMVMessages(id)
  return panel
}

export async function loadMVMessages(id) {
  const box = document.getElementById(`mv-msgs-${id}`)
  if (!box) return
  const { settings } = getState()
  try {
    const msgs = await fetchMessages(id)
    if (!msgs.length) {
      box.innerHTML = '<div style="color:var(--text-dim);font-size:.78rem">No messages yet.</div>'
      return
    }
    box.innerHTML = msgs.map(m => {
      const role = m.role ?? 'assistant'
      const parts = m.parts ?? []
      const text = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('\n').trim()
      const hasTools = parts.some(p => p.type === 'tool-invocation' || p.type === 'tool')
      return `<div class="mv-msg ${role}">
        <div class="mv-msg-role">${role}</div>
        ${text ? `<div class="mv-msg-body">${esc(text)}</div>` : ''}
        ${hasTools && settings.tools ? `<div style="font-size:.7rem;color:var(--text-dim);padding:2px 0">[tool calls]</div>` : ''}
      </div>`
    }).join('')
    box.scrollTop = box.scrollHeight
  } catch (_) {}
}

export function updateMVPanelStatus(id, status) {
  const badge = document.getElementById(`mv-badge-${id}`)
  if (!badge) return
  badge.textContent = status
  badge.className = `badge badge-${statusClass(status)} mv-badge`
}

// ── Session picker integration ─────────────────────────────────────────────

function openSessionPicker() {
  import('./shortcuts.js').then(m => m.openSessionPicker())
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initMultiView() {
  document.getElementById('multiview-btn').addEventListener('click', () => {
    const { multiviewActive } = getState()
    const next = !multiviewActive
    setState({ multiviewActive: next })
    document.getElementById('multiview-btn').style.background = next ? 'rgba(0,217,255,.15)' : ''
    if (next) showMultiview()
    else hideMultiview()
    saveMVState()
  })
}
