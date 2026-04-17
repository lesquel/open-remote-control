// command-history.js — Ring-buffer prompt history for the input textarea
// Factory: createCommandHistory({ inputEl, storageKey }) → { push, destroy }
//
// Behaviour:
//   ↑ when empty  → load most recent entry
//   ↑ while navigating → go to older entry
//   ↓ while navigating → go to newer entry (toward empty)
//   Esc → reset pointer (no input clear)
//   On submit: push to history (dedupe consecutive identical entries)

const MAX_HISTORY = 50

export function createCommandHistory({ inputEl, storageKey = 'pilot_prompt_history' }) {
  if (!inputEl) return { push: () => {}, destroy: () => {} }

  // ── Persistence helpers ────────────────────────────────────────────────
  function _load() {
    try {
      const raw = localStorage.getItem(storageKey)
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch (_) {
      return []
    }
  }

  function _save(arr) {
    try { localStorage.setItem(storageKey, JSON.stringify(arr)) } catch (_) {}
  }

  // ── Ring buffer state ──────────────────────────────────────────────────
  // _pointer: -1 = not browsing; 0 = most recent; N = Nth oldest
  let _pointer = -1
  // _tempEntry: what the user typed before pressing ↑ (so ↓ can restore it)
  let _tempEntry = ''

  // ── push ───────────────────────────────────────────────────────────────
  function push(text) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return
    const history = _load()
    // Dedupe consecutive identical entries (newest is history[0])
    if (history[0] === trimmed) return
    history.unshift(trimmed)
    _save(history.slice(0, MAX_HISTORY))
    _pointer = -1
    _tempEntry = ''
  }

  // ── Keyboard handler ───────────────────────────────────────────────────
  function _onKeydown(e) {
    if (e.key === 'ArrowUp') {
      const inputVal = inputEl.value

      // Only intercept ↑ when the caret is at the start of the input
      // (handles multi-line: allow normal caret movement unless we're at top)
      const atStart = inputEl.selectionStart === 0 && inputEl.selectionEnd === 0

      if (!atStart && _pointer === -1) {
        // Input has text and we're not browsing — let browser handle caret
        return
      }

      e.preventDefault()
      const history = _load()
      if (!history.length) return

      if (_pointer === -1) {
        // Save whatever the user typed so ↓ can restore it
        _tempEntry = inputVal
      }

      const next = _pointer + 1
      if (next < history.length) {
        _pointer = next
        inputEl.value = history[_pointer]
        // Cursor to end
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length)
        _autoResize()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      if (_pointer === -1) return // not browsing, let browser handle
      e.preventDefault()
      const history = _load()
      const prev = _pointer - 1

      if (prev < 0) {
        // Back to what the user was typing
        _pointer = -1
        inputEl.value = _tempEntry
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length)
        _tempEntry = ''
        _autoResize()
        return
      }

      _pointer = prev
      inputEl.value = history[_pointer]
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length)
      _autoResize()
      return
    }

    if (e.key === 'Escape') {
      // Reset pointer without clearing input
      _pointer = -1
      _tempEntry = ''
      return
    }

    // Any other key resets the pointer so normal typing works
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      if (_pointer !== -1) {
        // User started typing while browsing — break out of history mode
        _pointer = -1
        _tempEntry = ''
      }
    }
  }

  // Auto-resize textarea (mirrors behaviour from messages.js / input-bar area)
  function _autoResize() {
    inputEl.style.height = 'auto'
    inputEl.style.height = inputEl.scrollHeight + 'px'
  }

  inputEl.addEventListener('keydown', _onKeydown)

  // ── Public clear (for palette action) ─────────────────────────────────
  function clearHistory() {
    _save([])
    _pointer = -1
    _tempEntry = ''
  }

  // ── Destroy ────────────────────────────────────────────────────────────
  function destroy() {
    inputEl.removeEventListener('keydown', _onKeydown)
  }

  return { push, clearHistory, destroy }
}
