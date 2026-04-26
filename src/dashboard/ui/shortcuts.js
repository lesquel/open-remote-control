// shortcuts.js — Keyboard shortcuts, session picker (Ctrl+K legacy), sidebar toggle
//
// Canonical shortcut map (source of truth):
//   Cmd/Ctrl+K   → Open command palette
//   ?            → Open help modal (not in input)
//   Esc          → Close topmost modal / picker / palette
//   Cmd/Ctrl+Enter → Submit current prompt
//   /            → Focus prompt input (not in input)
//   n            → New session
//   s            → Toggle sidebar
//   m            → Toggle multi-view
//   t            → Toggle theme
//   c            → Connect from phone
//
// Removed: Alt+P (duplicated Ctrl+K and was never documented)
// Kept:    Alt+B (sidebar toggle — distinct action, retained for muscle memory)
import { getState, setState } from '../state/state.js'
import { createSession, selectSession, statusClass } from '../components/sessions.js'
import { addToMultiview } from '../components/multi-view.js'
import { openPalette, closePalette } from '../components/command-palette.js'
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

// ── Shortcuts modal (legacy stubs — delegates to help-modal.js) ───────────
// These are kept so that any existing call sites don't break while the
// codebase transitions to the new help-modal module.

export function openShortcutsModal() {
  window.__openHelpModal?.()
}

export function closeShortcutsModal() {
  window.__closeHelpModal?.()
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
      window.__closeHelpModal?.()
      document.getElementById('settings-modal')?.classList.remove('open')
      closeSessionPicker()
      closePalette()
      return
    }

    // Modifier shortcuts — always active regardless of focus
    // Cmd+K / Ctrl+K — command palette (canonical)
    if (isCombo(e, { meta: true, key: 'k' })) { e.preventDefault(); openPalette(); return }
    if (isCombo(e, { ctrl: true, key: 'k' })) { e.preventDefault(); openPalette(); return }
    // Cmd+Enter / Ctrl+Enter — send prompt
    if (isCombo(e, { ctrl: true, key: 'enter' })) { e.preventDefault(); triggerSend(); return }
    if (isCombo(e, { meta: true, key: 'enter' })) { e.preventDefault(); triggerSend(); return }

    // Alt+B — toggle sidebar (kept for muscle memory; distinct from palette)
    // Alt+P was removed: it duplicated Ctrl+K and was never documented.
    if (isCombo(e, { alt: true, key: 'b' })) { e.preventDefault(); toggleSidebar(); return }

    // Single-key shortcuts — only fire when NOT typing in an input
    if (isTypingFocused()) return

    // ? — open help modal
    if (e.key === '?') { e.preventDefault(); window.__openHelpModal?.(); return }
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
    // c — connect from phone
    if (e.key === 'c') { e.preventDefault(); window.__openConnectModal?.(); return }
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
