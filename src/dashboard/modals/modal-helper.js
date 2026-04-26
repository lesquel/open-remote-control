// modal-helper.js — Reusable focus-trap + a11y helper for modals
// Usage: import { openModal } from './modal-helper.js'
//
// const handle = openModal({ node, panel?, onClose?, labelledBy? })
// handle.close() — programmatic dismiss

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Wrap a modal node with focus-trap + Esc + backdrop-click + a11y.
 * @param {Object} opts
 * @param {HTMLElement} opts.node       The backdrop element (already inserted into DOM).
 * @param {HTMLElement} [opts.panel]    The inner panel; clicks inside this don't close.
 *                                      Defaults to querying `.modal-panel` within node.
 * @param {() => void}  [opts.onClose]  Called when the helper decides the modal should close.
 * @param {string}      [opts.labelledBy] id of the heading inside the modal (for aria-labelledby).
 * @returns {{ close: () => void }}     Caller uses this to dismiss programmatically.
 */
export function openModal(opts) {
  const { node, onClose } = opts
  const panel = opts.panel ?? node.querySelector('.modal-panel') ?? node.firstElementChild
  const previouslyFocused = document.activeElement
  const labelledBy = opts.labelledBy

  node.setAttribute('role', node.getAttribute('role') ?? 'dialog')
  node.setAttribute('aria-modal', 'true')
  if (labelledBy) node.setAttribute('aria-labelledby', labelledBy)

  // Focus first focusable
  const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE))
    .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)

  const first = focusables()[0]
  if (first) {
    first.focus()
  } else {
    panel.setAttribute('tabindex', '-1')
    panel.focus()
  }

  function handleKey(ev) {
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      close()
      return
    }
    if (ev.key !== 'Tab') return
    const list = focusables()
    if (list.length === 0) { ev.preventDefault(); return }
    const idx = list.indexOf(document.activeElement)
    if (ev.shiftKey && idx <= 0) {
      ev.preventDefault()
      list[list.length - 1].focus()
    } else if (!ev.shiftKey && idx === list.length - 1) {
      ev.preventDefault()
      list[0].focus()
    }
  }

  function handleBackdrop(ev) {
    if (ev.target === node) close()
  }

  function close() {
    node.removeEventListener('keydown', handleKey, true)
    node.removeEventListener('click', handleBackdrop)
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus() } catch (_) {}
    }
    onClose?.()
  }

  node.addEventListener('keydown', handleKey, true)
  node.addEventListener('click', handleBackdrop)

  return { close }
}
