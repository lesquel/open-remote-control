// todo-dock.js — Persistent todo list dock, mirrors OpenCode TUI todo panel
// Factory: createTodoDock({ container, state }) → { refresh, destroy }
// Subscribes to `todo.updated` SSE events and renders live todo items.

const LS_COLLAPSED_KEY = 'pilot_todo_dock_collapsed'

export function createTodoDock({ container }) {
  // ── State ──────────────────────────────────────────────────────────────
  let _todos = []
  let _collapsed = false
  try {
    _collapsed = localStorage.getItem(LS_COLLAPSED_KEY) === 'true'
  } catch (_) {}

  // ── Build DOM skeleton ──────────────────────────────────────────────────
  container.innerHTML = `
    <div class="todo-dock" id="todo-dock-root" style="display:none">
      <div class="todo-dock-header">
        <span class="todo-dock-title">Todos</span>
        <button class="todo-dock-toggle" id="todo-dock-chevron" title="Expand/collapse">▾</button>
      </div>
      <div class="todo-dock-body" id="todo-dock-body"></div>
    </div>
  `

  const root    = container.querySelector('#todo-dock-root')
  const bodyEl  = container.querySelector('#todo-dock-body')
  const chevron = container.querySelector('#todo-dock-chevron')

  // Apply initial collapsed state
  _applyCollapsed()

  // ── Toggle ──────────────────────────────────────────────────────────────
  chevron.addEventListener('click', () => {
    _collapsed = !_collapsed
    _applyCollapsed()
    try { localStorage.setItem(LS_COLLAPSED_KEY, String(_collapsed)) } catch (_) {}
  })

  // ── SSE listener ───────────────────────────────────────────────────────
  // The `todo.updated` event is fired as a named SSE event.
  // We hook into it by listening on the EventSource via a custom global bridge
  // (same pattern as other modules that listen via window.__xxx callbacks).
  // sse.js dispatches `pilot.todo.updated` events through window dispatch as well.
  function _onTodoEvent(e) {
    const payload = e.detail ?? e
    const todos = Array.isArray(payload?.todos) ? payload.todos : []
    _todos = todos
    _render()
  }

  window.addEventListener('pilot:todo:updated', _onTodoEvent)

  // ── Render ──────────────────────────────────────────────────────────────
  function _render() {
    if (!_todos.length) {
      root.style.display = 'none'
      return
    }
    root.style.display = ''

    const html = _todos.map(todo => {
      const statusClass = _statusClass(todo.status)
      const icon = _statusIcon(todo.status)
      const strikeAttr = todo.status === 'completed' ? ' data-done' : ''
      const content = _esc(todo.content ?? '')
      return `<div class="todo-item todo-item--${statusClass}"${strikeAttr} data-id="${_esc(String(todo.id ?? ''))}">
        <span class="todo-item-icon" aria-hidden="true">${icon}</span>
        <span class="todo-item-text">${content}</span>
      </div>`
    }).join('')

    bodyEl.innerHTML = html
  }

  function _applyCollapsed() {
    root.classList.toggle('todo-dock--collapsed', _collapsed)
    chevron.textContent = _collapsed ? '▸' : '▾'
  }

  function _statusClass(status) {
    if (status === 'completed') return 'completed'
    if (status === 'in_progress') return 'in-progress'
    return 'pending'
  }

  function _statusIcon(status) {
    if (status === 'completed') return '☑'
    if (status === 'in_progress') return '◐'
    return '☐'
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function refresh(todos) {
    if (Array.isArray(todos)) _todos = todos
    _render()
  }

  function destroy() {
    window.removeEventListener('pilot:todo:updated', _onTodoEvent)
    container.innerHTML = ''
  }

  return { refresh, destroy }
}
