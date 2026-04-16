// messages.js — Message and message-part rendering
import { escapeHtml, renderMarkdown } from './markdown.js'
import { getState } from './state.js'
import { fetchMessages } from './api.js'

/**
 * Render a single message object to an HTML string.
 */
export function renderMsg(m) {
  const role = m.role ?? 'assistant'
  const parts = m.parts ?? []
  const html = parts.map(p => renderPart(p)).filter(Boolean).join('')
  return `<div class="message ${role}"><div class="message-role">${role}</div>${html}</div>`
}

/**
 * Render a single message part to an HTML string.
 */
export function renderPart(p) {
  if (p.type === 'text') {
    const content = renderMarkdown(p.text ?? '')
    return `<div class="message-body md-rendered">${content}</div>`
  }

  if (p.type === 'tool-invocation' || p.type === 'tool') {
    return renderToolPart(p)
  }

  if (p.type === 'reasoning') {
    return `<div class="message-body" style="color:var(--text-dim);font-style:italic;font-size:.8rem">${escapeHtml(p.text ?? p.reasoning ?? '')}</div>`
  }

  return ''
}

const STATUS_ICON = {
  pending: '⏳',
  running: '🔄',
  completed: '✓',
  error: '❌',
}

function renderToolPart(p) {
  const { tools } = getState().settings
  // OpenCode SDK: tool name is at p.tool, state info is at p.state
  // Fallback to legacy AI SDK field names for forward-compat
  const name = p.tool ?? p.toolName ?? p.name ?? 'tool'
  const toolState = p.state ?? {}
  const status = toolState.status ?? (p.result !== undefined ? 'completed' : 'pending')
  const title = toolState.title ?? ''
  const input = toolState.input ?? p.args
  const id = 'tool-' + Math.random().toString(36).slice(2)

  const icon = STATUS_ICON[status] ?? '⏳'
  const headerLabel = title ? `${escapeHtml(name)} — ${escapeHtml(title)}` : escapeHtml(name)

  let argsHtml = ''
  if (input !== undefined && input !== null) {
    const argsJson = JSON.stringify(input, null, 2)
    let highlighted = ''
    try {
      highlighted = hljs.highlight(argsJson, { language: 'json' }).value
    } catch (_) {
      highlighted = escapeHtml(argsJson)
    }
    argsHtml = `<div style="margin-bottom:6px;font-size:.72rem;color:var(--text-dim);font-weight:600">INPUT</div><pre class="hljs" style="margin:0;border-radius:4px;font-size:.75rem">${highlighted}</pre>`
  }

  let resultHtml = ''
  if (status === 'completed' && toolState.output !== undefined) {
    const raw = typeof toolState.output === 'string'
      ? toolState.output
      : JSON.stringify(toolState.output, null, 2)
    resultHtml = `<div style="margin-top:8px;margin-bottom:6px;font-size:.72rem;color:var(--text-dim);font-weight:600">OUTPUT</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:.75rem;max-height:300px;overflow-y:auto">${escapeHtml(raw)}</pre>`
  } else if (status === 'error' && toolState.error !== undefined) {
    const errMsg = typeof toolState.error === 'string'
      ? toolState.error
      : JSON.stringify(toolState.error, null, 2)
    resultHtml = `<div style="margin-top:8px;margin-bottom:6px;font-size:.72rem;color:var(--danger);font-weight:600">ERROR</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:.75rem;color:var(--danger)">${escapeHtml(errMsg)}</pre>`
  } else if (p.result !== undefined) {
    // Legacy AI SDK fallback: p.result
    const raw = typeof p.result === 'string' ? p.result : JSON.stringify(p.result, null, 2)
    resultHtml = `<div style="margin-top:8px;margin-bottom:6px;font-size:.72rem;color:var(--text-dim);font-weight:600">RESULT</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:.75rem;max-height:300px;overflow-y:auto">${escapeHtml(raw)}</pre>`
  }

  // Auto-expand running and error tools; auto-collapse completed and pending
  const autoOpen = (status === 'running' || status === 'error') ? ' open' : ''
  const hiddenClass = tools ? '' : 'hidden-tools'
  return `<div class="tool-block ${hiddenClass}${autoOpen}" id="${id}">
    <div class="tool-header" onclick="window.__toggleTool('${id}')">
      <span class="tool-icon">${icon}</span>
      <span class="tool-name">${headerLabel}</span>
      <span class="tool-status ${status}">${status}</span>
      <span class="tool-chevron">▶</span>
    </div>
    <div class="tool-body">${argsHtml}${resultHtml}</div>
  </div>`
}

/**
 * Load messages for a session and render them into #messages.
 */
export async function loadMessages(sessionId) {
  const box = document.getElementById('messages')
  box.innerHTML = '<div style="padding:40px;color:var(--text-dim);font-size:.82rem;text-align:center">Loading…</div>'
  try {
    const msgs = await fetchMessages(sessionId)
    renderMessages(msgs)
  } catch (_) {
    box.innerHTML = '<div style="padding:24px;color:var(--danger)">Failed to load messages</div>'
  }
}

/**
 * Render an array of messages into #messages.
 */
export function renderMessages(msgs) {
  const box = document.getElementById('messages')
  if (!msgs.length) {
    box.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:12px;color:var(--text-dim);text-align:center;padding:40px 24px">
      <h3 style="color:var(--text);font-size:1rem">Ready for your first prompt</h3>
      <p style="font-size:.85rem;max-width:260px;line-height:1.5">Type a message below and press Enter to send it to this session.</p>
    </div>`
    return
  }
  box.innerHTML = msgs.map(m => renderMsg(m)).join('')
  const { tools } = getState().settings
  box.querySelectorAll('.tool-block').forEach(el => el.classList.toggle('hidden-tools', !tools))
  box.scrollTop = box.scrollHeight
}

// Expose toggleTool globally (called from inline onclick in rendered HTML)
window.__toggleTool = function(id) {
  document.getElementById(id)?.classList.toggle('open')
}
