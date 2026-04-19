// multi-view.js — Multi-session split view
import { getState, setState } from './state.js'
import { fetchMessages, sendPrompt as apiSendPrompt } from './api.js'
import { statusClass, sessionAgent, agentBadgeClass } from './sessions.js'
import { normalizeMessage, renderMessageIntoPanel } from './messages.js'
import { getModel, getProvider, agentColorFromName, getAgent } from './references.js'
import { toast } from './toast.js'
import { STORAGE_KEYS, AGENT_BADGE_CLASS } from './constants.js'

const STORAGE_KEY_PANELS = STORAGE_KEYS.MV_PANELS
const STORAGE_KEY_ACTIVE = STORAGE_KEYS.MV_ACTIVE

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
  const agent = sessionAgent(s)
  const agentColor = agent ? (getAgent(agent)?.color || agentColorFromName(agent)) : null
  const agentBadgeHtml = agent
    ? (agentColor
      ? `<span class="agent-badge ${AGENT_BADGE_CLASS.compact} ${AGENT_BADGE_CLASS.dynamic}" style="--agent-color:${agentColor};border-color:${agentColor}40;color:${agentColor}" title="${esc(agent)}">${esc(agent)}</span>`
      : `<span class="agent-badge ${AGENT_BADGE_CLASS.compact} ${agentBadgeClass(agent)}" title="${esc(agent)}">${esc(agent)}</span>`)
    : ''

  const panel = document.createElement('div')
  panel.className = 'mv-panel'
  panel.dataset.sessionId = id
  panel.innerHTML = `
    <div class="mv-header">
      <span class="mv-status-dot badge-${statusClass(status)}" id="mv-dot-${id}" title="${esc(status)}"></span>
      <span class="mv-title" title="${esc(title)}">${esc(title)}</span>
      ${agentBadgeHtml}
      <span class="badge badge-${statusClass(status)} mv-badge" id="mv-badge-${id}">${status}</span>
      <button class="mv-close" title="Close panel">✕</button>
    </div>
    <div class="mv-strip" id="mv-strip-${id}" style="display:none"></div>
    <div class="mv-messages" id="mv-msgs-${id}">
      <div class="mv-loading" style="color:var(--text-dim);font-size:.78rem;text-align:center;padding:12px">Loading…</div>
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

// Track in-flight loads so rapid SSE-driven reloads don't stomp each other.
const _mvLoadInFlight = new Map() // id -> Promise

/**
 * Render an error state in the given mv-messages box with a Retry button.
 * @param {HTMLElement} box - the mv-msgs-{id} element
 * @param {string} id - session id (used to wire the retry button)
 */
function _showMVError(box, id) {
  box.innerHTML = '<div class="mv-error">Failed to load \xb7 <button class="mv-retry">Retry</button></div>'
  const retryBtn = box.querySelector('.mv-retry')
  if (retryBtn) {
    retryBtn.addEventListener('click', () => loadMVMessages(id))
  }
}

export async function loadMVMessages(id) {
  const box = document.getElementById(`mv-msgs-${id}`)
  if (!box) return
  // Serialize per-panel loads
  if (_mvLoadInFlight.has(id)) return _mvLoadInFlight.get(id)

  const p = (async () => {
    // Resolve the session's directory — a pinned session may belong to a
    // different project than the current activeDirectory. We pass its own
    // directory explicitly so fetchMessages hits the right instance.
    const { sessions } = getState()
    const sessionDir = sessions[id]?.directory ?? undefined
    const fetchOpts = sessionDir !== undefined ? { directory: sessionDir } : {}

    try {
      const raw = await fetchMessages(id, fetchOpts)
      const rawArr = Array.isArray(raw) ? raw : []
      try {
        const normalized = rawArr.map(normalizeMessage)
        updateMVHeaderLabels(id, normalized)
        // Use the shared single-session renderer so multi-view matches the
        // main view (text parts, tool calls, reasoning blocks, agent badge).
        renderMessageIntoPanel(box, rawArr, { compact: true, scrollToBottom: true })
      } catch (renderErr) {
        console.error('[pilot:mv] render error pane=%s session=%s', id, id, renderErr)
        _showMVError(box, id)
      }
    } catch (err) {
      console.error('[pilot:mv] fetch error pane=%s session=%s status=%s', id, id, err?.status ?? '?', err)
      _showMVError(box, id)
    }
  })().finally(() => {
    _mvLoadInFlight.delete(id)
  })

  _mvLoadInFlight.set(id, p)
  return p
}

function updateMVHeaderLabels(id, normalizedMsgs) {
  const stripEl = document.getElementById(`mv-strip-${id}`)
  if (!stripEl) return
  const lastAssistant = [...normalizedMsgs].reverse().find(m => m.role === 'assistant')
  const agentName  = lastAssistant?.mode ?? null
  const modelId    = lastAssistant?.modelID ?? null
  const providerId = lastAssistant?.providerID ?? null
  const modelLabel    = modelId    ? (getModel(modelId)?.name ?? modelId)       : ''
  const providerLabel = providerId ? (getProvider(providerId)?.name ?? providerId) : ''
  const agentParts = []
  if (agentName) {
    const color = getAgent(agentName)?.color || agentColorFromName(agentName)
    agentParts.push(`<span class="mv-strip-agent" style="color:${color}">${esc(agentName)}</span>`)
  }
  if (modelLabel) agentParts.push(`<span class="mv-strip-sep">·</span><span class="mv-strip-model">${esc(modelLabel)}</span>`)
  if (providerLabel) agentParts.push(`<span class="mv-strip-sep">·</span><span class="mv-strip-provider">${esc(providerLabel)}</span>`)
  stripEl.innerHTML = agentParts.join(' ')
  stripEl.style.display = agentParts.length ? '' : 'none'
}

export function updateMVPanelStatus(id, status) {
  const badge = document.getElementById(`mv-badge-${id}`)
  if (badge) {
    badge.textContent = status
    badge.className = `badge badge-${statusClass(status)} mv-badge`
  }
  const dot = document.getElementById(`mv-dot-${id}`)
  if (dot) {
    dot.className = `mv-status-dot badge-${statusClass(status)}`
    dot.title = status
  }
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
