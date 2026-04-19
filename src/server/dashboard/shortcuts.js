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

// ── Shortcuts modal ────────────────────────────────────────────────────────

export function openShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal') || document.getElementById('keymap-modal')
  modal?.classList.add('open')
}

export function closeShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal') || document.getElementById('keymap-modal')
  modal?.classList.remove('open')
}

// ── Input focus guard ──────────────────────────────────────────────────────

/**
 * Returns true when the user is typing into a focusable text element.
 * Single-key shortcuts must not fire when an input is focused.
 */
function isTypingFocused() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if (el.isContentEditable) return true
  return false
}

// ── Multi-view toggle ──────────────────────────────────────────────────────

async function toggleMultiview() {
  const multiviewBtn = document.getElementById('multiview-btn')
  if (multiviewBtn) multiviewBtn.click()
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
    // Esc — close any open modal / picker / palette (always works)
    if (e.key === 'Escape') {
      closeShortcutsModal()
      document.getElementById('settings-modal')?.classList.remove('open')
      closeSessionPicker()
      closePalette()
      return
    }

    // Modifier shortcuts — always active regardless of focus
    // Cmd+K / Ctrl+K — command palette
    if (isCombo(e, { meta: true, key: 'k' })) { e.preventDefault(); openPalette(); return }
    if (isCombo(e, { ctrl: true, key: 'k' })) { e.preventDefault(); openPalette(); return }
    // Cmd+Enter / Ctrl+Enter — send prompt
    if (isCombo(e, { ctrl: true, key: 'enter' })) { e.preventDefault(); triggerSend(); return }
    if (isCombo(e, { meta: true, key: 'enter' })) { e.preventDefault(); triggerSend(); return }

    // Legacy Alt aliases (keep for muscle memory)
    if (isCombo(e, { alt: true, key: 'p' })) { e.preventDefault(); openPalette(); return }
    if (isCombo(e, { alt: true, key: 'b' })) { e.preventDefault(); toggleSidebar(); return }

    // Single-key shortcuts — only fire when NOT typing in an input
    if (isTypingFocused()) return

    // ? — open shortcuts modal (and palette)
    if (e.key === '?') { e.preventDefault(); openShortcutsModal(); return }
    // n — new session
    if (e.key === 'n') { e.preventDefault(); createSession(); return }
    // s — toggle sidebar
    if (e.key === 's') { e.preventDefault(); toggleSidebar(); return }
    // m — toggle multi-view
    if (e.key === 'm') { e.preventDefault(); toggleMultiview(); return }
    // t — toggle theme
    if (e.key === 't') { e.preventDefault(); toggleThemeShortcut(); return }
    // / — focus prompt input
    if (e.key === '/') {
      e.preventDefault()
      const inp = document.getElementById('prompt-input')
      inp?.focus()
      return
    }
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
