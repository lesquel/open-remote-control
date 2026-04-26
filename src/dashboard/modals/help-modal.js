// help-modal.js — Discoverable keyboard shortcuts help modal
//
// Canonical shortcut map shown here must stay in sync with shortcuts.js.
//
// Usage:
//   import { openHelpModal, closeHelpModal } from './help-modal.js'
//   openHelpModal()   // also available as window.__openHelpModal()
//   closeHelpModal()  // also available as window.__closeHelpModal()

import { openModal } from './modal-helper.js'

// ── State ──────────────────────────────────────────────────────────────────

let _isOpen = false
let _modalHandle = null

// ── DOM setup (lazy, injected once) ────────────────────────────────────────

function ensureModal() {
  if (document.getElementById('help-modal-root')) return

  const el = document.createElement('div')
  el.id = 'help-modal-root'
  el.className = 'help-modal modal-backdrop'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-labelledby', 'help-modal-title')

  el.innerHTML = `
    <div class="modal-panel">
      <header class="modal-header">
        <h2 id="help-modal-title">Keyboard shortcuts</h2>
        <button class="modal-close" aria-label="Close">×</button>
      </header>
      <section class="help-section">
        <h3>Navigation</h3>
        <dl class="help-keys">
          <dt><kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd></dt><dd>Open command palette</dd>
          <dt><kbd>?</kbd></dt><dd>Show this help</dd>
          <dt><kbd>Esc</kbd></dt><dd>Close modals</dd>
          <dt><kbd>/</kbd></dt><dd>Focus prompt input</dd>
          <dt><kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>Send prompt</dd>
        </dl>
      </section>
      <section class="help-section">
        <h3>Session management</h3>
        <dl class="help-keys">
          <dt><kbd>n</kbd></dt><dd>New session</dd>
          <dt><kbd>s</kbd></dt><dd>Toggle sidebar</dd>
          <dt><kbd>m</kbd></dt><dd>Toggle multi-view</dd>
          <dt><kbd>t</kbd></dt><dd>Toggle theme</dd>
          <dt><kbd>c</kbd></dt><dd>Connect from phone</dd>
        </dl>
      </section>
      <section class="help-section">
        <h3>Tips</h3>
        <ul>
          <li>Click the gear icon to open Settings.</li>
          <li>Click the phone icon to connect from another device.</li>
          <li>Multiple OpenCode windows appear as tabs at the top.</li>
        </ul>
      </section>
    </div>
  `

  document.body.appendChild(el)

  // Close on X button — wired after openModal is called so handle is available
}

// ── Public API ─────────────────────────────────────────────────────────────

export function openHelpModal() {
  ensureModal()
  const el = document.getElementById('help-modal-root')
  if (!el || _isOpen) return
  el.classList.add('open')
  _isOpen = true
  _modalHandle = openModal({
    node: el,
    onClose: closeHelpModal,
    labelledBy: 'help-modal-title',
  })
  // Wire close button now that handle exists
  el.querySelector('.modal-close').onclick = () => _modalHandle.close()
}

export function closeHelpModal() {
  const el = document.getElementById('help-modal-root')
  if (!el || !_isOpen) return
  el.classList.remove('open')
  _isOpen = false
  _modalHandle = null
}

// ── Global exposure ────────────────────────────────────────────────────────
// Allows other modules (command palette, footer buttons) to trigger help
// without creating a hard import dependency.

window.__openHelpModal  = openHelpModal
window.__closeHelpModal = closeHelpModal
