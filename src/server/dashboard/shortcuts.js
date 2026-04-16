// shortcuts.js — Keyboard shortcuts and session picker (Ctrl+K)
import { getState } from './state.js'
import { createSession, selectSession, statusClass } from './sessions.js'
import { addToMultiview } from './multi-view.js'
import { toast } from './toast.js'

// ── Session picker ─────────────────────────────────────────────────────────

export function openSessionPicker() {
  const picker = document.getElementById('session-picker')
  picker.classList.add('open')
  const input = document.getElementById('picker-input')
  input.value = ''
  renderPickerList('')
  input.focus()
}

export function closeSessionPicker() {
  document.getElementById('session-picker').classList.remove('open')
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderPickerList(query) {
  const { sessions, statuses, multiviewActive } = getState()
  const list = document.getElementById('picker-list')
  const q = query.toLowerCase()

  const ids = Object.keys(sessions)
    .filter(id => {
      const t = (sessions[id]?.title || id).toLowerCase()
      return !q || t.includes(q) || id.includes(q)
    })
    .sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0))
    .slice(0, 12)

  if (!ids.length) {
    list.innerHTML = '<div style="padding:12px 16px;color:var(--text-dim);font-size:.85rem">No sessions found</div>'
    return
  }

  list.innerHTML = ids.map(id => {
    const s = sessions[id]
    const status = statuses[id] ?? 'idle'
    const title = s?.title || id.slice(0, 8)
    return `<div class="picker-item" data-id="${id}">
      <span class="badge badge-${statusClass(status)}">${status}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
      <span style="font-family:var(--mono);font-size:.68rem;color:var(--text-dim)">${id.slice(0, 8)}</span>
    </div>`
  }).join('')

  list.querySelectorAll('.picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id
      closeSessionPicker()
      if (multiviewActive) addToMultiview(id)
      else selectSession(id)
    })
  })
}

// ── Send prompt helper (imported by shortcuts) ─────────────────────────────

async function triggerSend() {
  const { activeSession } = getState()
  if (!activeSession) return
  // Delegate to sessions module via DOM event on the button
  document.getElementById('send-btn').click()
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initShortcuts() {
  // Session picker events
  document.getElementById('picker-input').addEventListener('input', e => {
    renderPickerList(e.target.value)
  })

  document.getElementById('session-picker').addEventListener('click', e => {
    if (e.target === document.getElementById('session-picker')) closeSessionPicker()
  })

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('settings-modal').classList.remove('open')
      closeSessionPicker()
      return
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'k') { e.preventDefault(); openSessionPicker(); return }
      if (e.key === 'n') { e.preventDefault(); createSession(); return }
      if (e.key === 'Enter') { e.preventDefault(); triggerSend(); return }
    }
  })
}
