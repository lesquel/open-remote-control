// shortcuts.js — Keyboard shortcuts, session picker (Ctrl+K legacy), sidebar toggle
import { getState, setState } from './state.js'
import { createSession, selectSession, statusClass } from './sessions.js'
import { addToMultiview } from './multi-view.js'
import { openPalette, closePalette } from './command-palette.js'
import { toast } from './toast.js'

// ── Combo helper ───────────────────────────────────────────────────────────
/**
 * Test whether a KeyboardEvent matches a shortcut descriptor.
 * { alt?, ctrl?, meta?, shift?, key } — key is matched case-insensitively.
 * Only checks the flags that are present in the descriptor (others are ignored).
 */
function isCombo(e, { alt, ctrl, meta, shift, key }) {
  if (alt !== undefined   && e.altKey   !== alt)   return false
  if (ctrl !== undefined  && e.ctrlKey  !== ctrl)  return false
  if (meta !== undefined  && e.metaKey  !== meta)  return false
  if (shift !== undefined && e.shiftKey !== shift) return false
  if (key !== undefined) {
    const k = e.key.toLowerCase()
    const target = key.toLowerCase()
    if (k !== target) return false
  }
  return true
}

// ── Session picker (legacy Ctrl+K — still functional for backward compat) ──

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
    list.innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:11px">No sessions found</div>'
    return
  }

  list.innerHTML = ids.map(id => {
    const s = sessions[id]
    const status = statuses[id] ?? 'idle'
    const title = s?.title || id.slice(0, 8)
    return `<div class="picker-item" data-id="${id}">
      <span class="badge badge-${statusClass(status)}">${status}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-muted)">${id.slice(0, 8)}</span>
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

// ── Sidebar toggle ─────────────────────────────────────────────────────────

function toggleSidebar() {
  const panel = document.getElementById('sessions-panel')
  if (!panel) return
  // Desktop: collapse/expand with width
  if (window.innerWidth >= 1024) {
    panel.classList.toggle('collapsed')
  } else {
    // Tablet/mobile: overlay
    panel.classList.toggle('open-overlay')
  }
}

// ── Send prompt helper ─────────────────────────────────────────────────────

async function triggerSend() {
  const { activeSession } = getState()
  if (!activeSession) return
  document.getElementById('send-btn').click()
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initShortcuts() {
  // Legacy session picker events
  document.getElementById('picker-input').addEventListener('input', e => {
    renderPickerList(e.target.value)
  })

  document.getElementById('session-picker').addEventListener('click', e => {
    if (e.target === document.getElementById('session-picker')) closeSessionPicker()
  })

  // Sidebar toggle button
  const sidebarBtn = document.getElementById('sidebar-toggle-btn')
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', toggleSidebar)
  }

  // Clickable footer shortcut buttons (useful on mobile where Alt is hard)
  document.querySelectorAll('.footer-shortcut--btn').forEach(el => {
    const action = el.dataset.action
    if (!action) return
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => {
      if (action === 'theme') toggleThemeShortcut()
      else if (action === 'sidebar') toggleSidebar()
      else if (action === 'palette') openPalette()
    })
  })

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('settings-modal').classList.remove('open')
      closeSessionPicker()
      closePalette()
      return
    }

    // Alt+P — open command palette (Alt is safe cross-browser; Cmd+K kept for Mac)
    if (isCombo(e, { alt: true, key: 'p' })) { e.preventDefault(); openPalette(); return }
    // Cmd+K — Mac-friendly alternative (macOS doesn't pre-empt Cmd+K)
    if (isCombo(e, { meta: true, key: 'k' })) { e.preventDefault(); openPalette(); return }

    // Alt+N — new session
    if (isCombo(e, { alt: true, key: 'n' })) { e.preventDefault(); createSession(); return }

    // Ctrl+Enter — send prompt (muscle memory, no conflicts)
    if (isCombo(e, { ctrl: true, key: 'enter' })) { e.preventDefault(); triggerSend(); return }

    // Alt+T — toggle theme
    if (isCombo(e, { alt: true, key: 't' })) { e.preventDefault(); toggleThemeShortcut(); return }

    // Alt+` — sidebar toggle (backtick)
    // Alt+B — sidebar toggle synonym (B for Bar, safer on layouts where Alt+` is awkward)
    if (isCombo(e, { alt: true, key: '`' })) { e.preventDefault(); toggleSidebar(); return }
    if (isCombo(e, { alt: true, key: 'b' })) { e.preventDefault(); toggleSidebar(); return }
  })
}

function toggleThemeShortcut() {
  const { settings } = getState()
  const next = { ...settings, theme: !settings.theme }
  setState({ settings: next })
  document.body.classList.toggle('theme-light', next.theme)
  try {
    const saved = JSON.parse(sessionStorage.getItem('pilot_settings') || '{}')
    sessionStorage.setItem('pilot_settings', JSON.stringify({ ...saved, theme: next.theme }))
  } catch (_) {}
  const el = document.getElementById('s-theme')
  if (el) el.checked = next.theme
}
