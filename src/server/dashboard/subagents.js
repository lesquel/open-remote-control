// subagents.js — Render and refresh the subagents (child sessions) panel
import { getState } from './state.js'
import { getSessionChildren } from './api.js'
import { toast } from './toast.js'

const PANEL_ID = 'subagents-panel'
const COLLAPSED_KEY = 'pilot_subagents_collapsed'

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Pick a human-readable agent/mode label from a child session.
 * Falls back to "agent" when nothing is available.
 */
function childAgent(s) {
  if (!s) return 'agent'
  const raw = s.mode ?? s.agent ?? null
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof raw.name === 'string') return raw.name
  return 'agent'
}

function childTitle(s) {
  return s?.title || (s?.id ? s.id.slice(0, 14) : 'subagent')
}

/**
 * Render the subagents panel for a parent sessionId given the children array.
 */
function renderPanel(parentId, children) {
  const panel = document.getElementById(PANEL_ID)
  if (!panel) return

  if (!Array.isArray(children) || children.length === 0) {
    panel.style.display = 'none'
    panel.innerHTML = ''
    return
  }

  const collapsed = localStorage.getItem(COLLAPSED_KEY) === '1'
  panel.style.display = ''
  panel.className = 'subagents-panel' + (collapsed ? ' collapsed' : '')

  const items = children.map((c) => {
    const id = c?.id ?? ''
    const title = esc(childTitle(c))
    const agent = esc(childAgent(c))
    return `
      <div class="subagent-item" data-id="${esc(id)}">
        <div class="subagent-item-main">
          <div class="subagent-item-top">
            <span class="subagent-item-title">${title}</span>
            <span class="agent-badge agent-badge--custom">${agent}</span>
          </div>
          <code class="subagent-item-id" title="Click to copy">${esc(id)}</code>
        </div>
        <div class="subagent-item-actions">
          <button class="subagent-open" data-action="open" data-id="${esc(id)}">Open</button>
        </div>
      </div>
    `
  }).join('')

  panel.innerHTML = `
    <div class="subagents-panel-header" id="subagents-header">
      <span>Subagents</span>
      <span class="subagents-count">${children.length}</span>
      <span class="subagents-chevron">▼</span>
    </div>
    <div class="subagents-list">${items}</div>
  `

  const header = panel.querySelector('#subagents-header')
  header?.addEventListener('click', () => {
    panel.classList.toggle('collapsed')
    localStorage.setItem(COLLAPSED_KEY, panel.classList.contains('collapsed') ? '1' : '0')
  })

  // Click on the id to copy
  panel.querySelectorAll('.subagent-item-id').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const id = el.textContent ?? ''
      navigator.clipboard?.writeText(id)
      toast('Subagent ID copied')
    })
  })

  // Open child session (dynamic import to avoid circular dep with sessions.js)
  panel.querySelectorAll('[data-action="open"]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      const id = btn.getAttribute('data-id')
      if (!id) return
      const mod = await import('./sessions.js')
      mod.selectSession(id)
    })
  })

  // Keep a weak link to the parent id for the refresh flow
  panel.dataset.parentId = parentId
}

/**
 * Load the subagents panel for the given parent sessionId.
 */
export async function loadSubagents(parentId) {
  const panel = document.getElementById(PANEL_ID)
  if (!panel) return
  if (!parentId) {
    panel.style.display = 'none'
    panel.innerHTML = ''
    return
  }
  try {
    const children = await getSessionChildren(parentId)
    try {
      renderPanel(parentId, children ?? [])
    } catch (err) {
      console.error('[panel-error] subagents-panel:', err)
      panel.style.display = ''
      panel.innerHTML = `<div class="panel-error">
        <span>⚠ Subagents panel failed to render (check console)</span>
        <button class="panel-error-retry" id="subagents-retry">Retry</button>
      </div>`
      document.getElementById('subagents-retry')?.addEventListener('click', () => loadSubagents(parentId))
    }
  } catch (_) {
    // Silently hide — subagents are optional
    panel.style.display = 'none'
    panel.innerHTML = ''
  }
}

/**
 * SSE handler: refresh the panel when a subagent is spawned,
 * but only if the event belongs to the currently active session.
 */
export async function onSubagentSpawned(eventData) {
  const { activeSession } = getState()
  const sessionID = eventData?.sessionID ?? eventData?.sessionId
  if (!activeSession || sessionID !== activeSession) return
  // Small delay — the child session may not be indexed yet
  setTimeout(() => {
    loadSubagents(activeSession).catch(() => {})
  }, 300)
}
