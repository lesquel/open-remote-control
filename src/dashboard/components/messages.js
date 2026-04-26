// messages.js — Message and message-part rendering with TUI-style prefixes + error boundaries
import { escapeHtml, renderMarkdown } from './markdown.js'
import { getState } from '../state/state.js'
import { fetchMessages } from '../api/api.js'
// Streaming delta support (Feature B)
import { isPartStreaming } from '../state/state.js'
// Dynamic agent references — imported lazily to avoid circular-init issues
import { renderAgentBadge, getMcpServers, sanitizeMcpName } from './references.js'
import { LIMITS } from '../constants.js'
// TODO (sessions subagent): import renderAgentBadge from './references.js' and use it
//   for session-list header badges in sessions.js to get consistent dynamic coloring.

/**
 * Normalize a raw SDK message response item.
 *
 * The SDK `/session/{id}/message` endpoint returns Array<{ info: Message, parts: Part[] }>.
 * Older/local shapes may be flat { role, parts, mode, ... }.
 * This function normalises both so the rest of the rendering code only
 * ever deals with { role, parts, mode, modelID, providerID, cost, tokens }.
 *
 * @param {object} raw  — one item from fetchMessages()
 * @returns {{ role: string, parts: Array, mode: string|null, modelID: string|null, providerID: string|null, cost: number|object|null, tokens: object|null }}
 */
export function normalizeMessage(raw) {
  if (!raw) return { role: 'assistant', parts: [], mode: null, modelID: null, providerID: null, cost: null, tokens: null }
  // Wrapped SDK shape: { info: Message, parts: Part[] }
  if (raw.info && typeof raw.info === 'object') {
    const info = raw.info
    return {
      role:       info.role       ?? 'assistant',
      parts:      raw.parts       ?? [],
      mode:       info.mode       ?? info.agent ?? null,
      modelID:    info.modelID    ?? null,
      providerID: info.providerID ?? null,
      cost:       info.cost       ?? null,
      tokens:     info.tokens     ?? null,
      // Keep raw info reference for debug / label-strip access
      _info:      info,
    }
  }
  // Flat shape (fallback)
  return {
    role:       raw.role       ?? 'assistant',
    parts:      raw.parts      ?? [],
    mode:       raw.mode       ?? raw.agent ?? null,
    modelID:    raw.modelID    ?? null,
    providerID: raw.providerID ?? null,
    cost:       raw.cost       ?? null,
    tokens:     raw.tokens     ?? null,
    _info:      raw,
  }
}

/**
 * Extract the mode/agent string from a normalized message.
 */
function messageMode(m) {
  if (!m) return null
  const raw = m.mode ?? null
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof raw.name === 'string') return raw.name
  return null
}

/**
 * Render a single message object to an HTML string.
 * Accepts either a raw SDK message ({ info, parts }) or a pre-normalised one.
 * Uses dynamic agent badge from references module.
 */
export function renderMsg(rawMsg) {
  try {
    const m = normalizeMessage(rawMsg)
    const role = m.role
    const parts = m.parts ?? []
    const html = parts.map(p => {
      try { return renderPart(p) } catch (_) { return '' }
    }).filter(Boolean).join('')
    const mode = role === 'assistant' ? messageMode(m) : null
    const badge = mode ? renderAgentBadge(mode) : ''
    console.debug('[pilot:data] renderMsg role=%s mode=%s parts=%d', role, mode, parts.length)
    return `<div class="message ${escapeHtml(role)}"><div class="message-role">${escapeHtml(role)}${badge}</div>${html}</div>`
  } catch (_) {
    return `<div class="message"><div class="message-role">?</div><div class="message-body" style="color:var(--danger)">Failed to render message</div></div>`
  }
}

/**
 * Render a single message part to an HTML string.
 * TUI prefix conventions applied here.
 */
export function renderPart(p) {
  // ── Feature B: text part with streaming cursor support ──────────────────
  if (p.type === 'text') {
    const content = renderMarkdown(p.text ?? '')
    const partId = p.id ?? ''
    const streaming = partId ? isPartStreaming(partId) : false
    const cursorHtml = streaming
      ? '<span class="streaming-cursor" aria-hidden="true"></span>'
      : ''
    const dataAttr = partId ? ` data-part-id="${escapeHtml(partId)}"` : ''
    // Wrap in data-message-id span so removeStreamingCursor can find it
    const msgAttr = p.messageID ? ` data-message-id="${escapeHtml(p.messageID)}"` : ''
    return `<div class="message-body md-rendered"${dataAttr}${msgAttr}>${content}${cursorHtml}</div>`
  }

  if (p.type === 'tool-invocation' || p.type === 'tool') {
    return renderToolPart(p)
  }

  // ── Feature C: reasoning part — collapsible grey block ──────────────────
  if (p.type === 'reasoning') {
    return renderReasoningPart(p)
  }

  // ── Agent transition part — emitted when the active agent changes mid-session ──
  if (p.type === 'agent') {
    return renderAgentTransitionPart(p)
  }

  // ── Step-start / step-finish — show as subtle divider ────────────────────
  if (p.type === 'step-start') {
    return `<div class="step-divider step-divider--start" aria-hidden="true">~ step</div>`
  }
  if (p.type === 'step-finish') {
    const reason = p.reason ? ` · ${escapeHtml(p.reason)}` : ''
    return `<div class="step-divider step-divider--finish" aria-hidden="true">~ done${reason}</div>`
  }

  // ── Retry part — show as warning notice ──────────────────────────────────
  if (p.type === 'retry') {
    const attempt = p.attempt ?? 1
    const errMsg = p.error?.message ?? p.error ?? ''
    return `<div class="retry-notice" aria-label="Retry attempt ${attempt}">~ retry #${attempt}${errMsg ? ': ' + escapeHtml(String(errMsg).slice(0, 120)) : ''}</div>`
  }

  // ── Compaction part — show as info notice ────────────────────────────────
  if (p.type === 'compaction') {
    const auto = p.auto ? ' (auto)' : ''
    return `<div class="compaction-notice" aria-label="Session compacted">~ session compacted${auto}</div>`
  }

  return ''
}

// ── Feature C: Reasoning part renderer ──────────────────────────────────────

/**
 * Read the global "show reasoning by default" setting.
 * Stored in settings as `settings.showReasoning` (default: false).
 */
function isReasoningExpandedByDefault() {
  return getState().settings?.showReasoning === true
}

/**
 * Format duration from ReasoningPart.time { start, end }.
 * @param {{ start: number, end?: number }|undefined} time
 * @returns {string}
 */
function formatDuration(time) {
  if (!time || !time.start) return ''
  const end = time.end ?? Date.now()
  const ms = end - time.start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Render a ReasoningPart as a collapsible block.
 * Does NOT touch agent badge logic — only the text-part area.
 */
function renderReasoningPart(p) {
  const text = escapeHtml(p.text ?? p.reasoning ?? '')
  const duration = formatDuration(p.time)
  const durationHtml = duration
    ? `<span class="reasoning-duration">${escapeHtml(duration)}</span>`
    : ''
  const defaultExpanded = isReasoningExpandedByDefault()
  const expandedClass = defaultExpanded ? ' reasoning-expanded' : ''
  const id = 'reasoning-' + (p.id ?? Math.random().toString(36).slice(2))

  return `<div class="reasoning-block${expandedClass}" id="${escapeHtml(id)}">
    <div class="reasoning-header" onclick="window.__toggleReasoning('${escapeHtml(id)}')">
      <span class="reasoning-toggle">▸</span>
      <span class="reasoning-label">~ thinking</span>
      ${durationHtml}
    </div>
    <div class="reasoning-body">${text}</div>
  </div>`
}

// Expose reasoning toggle globally (called from inline onclick in rendered HTML)
window.__toggleReasoning = function(id) {
  document.getElementById(id)?.classList.toggle('reasoning-expanded')
}

// ── Agent transition part renderer ──────────────────────────────────────────
/**
 * Render an AgentPart — emitted by OpenCode when the active named agent changes
 * (e.g. switching from "build" to "plan").
 *
 * Shape: { type: 'agent', name: string, source?: { value, start, end } }
 */
function renderAgentTransitionPart(p) {
  const name = escapeHtml(p.name ?? 'unknown')
  // Derive color from the agent badge system if available
  let badge = ''
  try {
    badge = renderAgentBadge(p.name ?? '')
  } catch (_) {
    badge = `<span class="agent-badge agent-badge--custom">${name}</span>`
  }
  return `<div class="agent-transition" aria-label="Agent: ${name}">
    <span class="agent-transition-icon" aria-hidden="true">◈</span>
    <span class="agent-transition-label">agent:</span>
    ${badge}
  </div>`
}

// ── Feature B: Streaming delta DOM updaters ──────────────────────────────────

/**
 * Append a delta string directly to the in-progress text part DOM node.
 * Finds the element by data-part-id, appends raw text to its text content,
 * and ensures the streaming cursor stays at the end.
 *
 * Constraint: does NOT re-render the whole message; only touches the text node.
 *
 * @param {string} partId
 * @param {string} delta
 */
export function applyStreamingDelta(partId, delta) {
  if (!partId || !delta) return
  const el = document.querySelector(`[data-part-id="${CSS.escape(partId)}"]`)
  if (!el) return

  // Remove cursor temporarily to append text cleanly
  const cursor = el.querySelector('.streaming-cursor')
  if (cursor) cursor.remove()

  // Append delta as a text node to avoid breaking existing HTML structure
  // We re-render via markdown on message.updated; here we just show the raw delta
  el.appendChild(document.createTextNode(delta))

  // Re-add cursor at end
  const newCursor = document.createElement('span')
  newCursor.className = 'streaming-cursor'
  newCursor.setAttribute('aria-hidden', 'true')
  el.appendChild(newCursor)

  // Scroll messages to bottom if near bottom
  const msgBox = document.getElementById('messages')
  if (msgBox) {
    const distFromBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight
    if (distFromBottom < LIMITS.SCROLL_BOTTOM_THRESHOLD_PX) msgBox.scrollTop = msgBox.scrollHeight
  }
}

/**
 * Remove the streaming cursor from all text parts of a given message.
 * Called when message.updated arrives, marking the message complete.
 *
 * @param {string} messageId
 */
export function removeStreamingCursor(messageId) {
  if (!messageId) return
  const els = document.querySelectorAll(`[data-message-id="${CSS.escape(messageId)}"]`)
  els.forEach(el => {
    el.querySelectorAll('.streaming-cursor').forEach(c => c.remove())
  })
}

// ── Feature B2: Optimistic user-message + on-the-fly part surfaces ──────────
//
// The send flow used to `await sendPromptWithOpts(...)` then `await
// loadMessages(...)` — which meant the sent message did not appear on
// screen until the assistant's full response was received. That made the
// UI feel frozen during a turn. We now:
//
//   1. Append the user's message optimistically the moment they hit Send,
//      with data-pending="1" as a reconcile marker.
//   2. Reconcile against the SSE `message.created` (role=user) event so
//      the DOM node gets the real message-id without a re-render.
//   3. When a `message.part.updated` delta arrives for a text part we
//      haven't rendered yet, create the surface on the fly so the first
//      token is visible immediately instead of being lost until the
//      eventual `message.updated` full reload.

/**
 * Append an optimistic user message to the DOM. Removes the empty-state
 * placeholder if present. Returns the created element for the caller.
 */
export function appendOptimisticUserMessage(text) {
  const box = document.getElementById('messages')
  if (!box) return null
  // Replace the "Ready for your first prompt" empty state if it's there.
  const empty = box.querySelector('#no-session-state')
  if (empty) empty.remove()
  // Replace a stale Loading… placeholder left by a previous loadMessages.
  if (box.children.length === 1 && box.firstElementChild?.textContent === 'Loading…') {
    box.innerHTML = ''
  }
  const el = document.createElement('div')
  el.className = 'message user'
  el.dataset.pending = '1'
  el.innerHTML = `<div class="message-role">user</div>
    <div class="message-body md-rendered">${renderMarkdown(text)}</div>`
  box.appendChild(el)
  box.scrollTop = box.scrollHeight
  return el
}

/** Remove any optimistic user message still flagged as pending. */
export function removeOptimisticUserMessage() {
  const box = document.getElementById('messages')
  if (!box) return
  box.querySelectorAll('.message.user[data-pending="1"]').forEach(el => el.remove())
}

/**
 * When SSE confirms the user message exists server-side, reconcile the
 * optimistic node: strip data-pending and attach the real messageID. No
 * visible change for the user, but subsequent SSE events can target the
 * node by id.
 */
export function reconcileOptimisticUserMessage(messageId) {
  if (!messageId) return
  const box = document.getElementById('messages')
  if (!box) return
  const pending = box.querySelector('.message.user[data-pending="1"]')
  if (!pending) return
  pending.removeAttribute('data-pending')
  pending.dataset.messageId = messageId
}

/**
 * Replace a rendered part node in place with a fresh render of the new
 * part data. Used when `message.part.updated` lands with a snapshot of a
 * tool part transitioning pending → running → completed — we need the
 * DOM to reflect the new status badge, output pane, etc., but we CAN'T
 * do a full loadMessages() because that would wipe any in-flight text
 * streaming. So we swap only the affected node.
 *
 * For text parts we deliberately do nothing: the delta stream is already
 * populating them token by token, and replacing the node would lose the
 * accumulated text.
 */
export function replacePartInDom(part) {
  if (!part || !part.id) return false
  // Text parts are driven by the delta stream, not by snapshot updates.
  if (part.type === 'text') return false
  const node = document.querySelector(`[data-part-id="${CSS.escape(part.id)}"]`)
  if (!node) return false
  try {
    const html = renderPart(part)
    if (!html) return false
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const next = tmp.firstElementChild
    if (!next) return false
    node.replaceWith(next)
    return true
  } catch (_) {
    return false
  }
}

/**
 * Ensure a text-part surface exists for the given part/message. If not
 * found, create a fresh assistant bubble (or reuse an empty "typing" one)
 * and return the element that `applyStreamingDelta` will append into.
 *
 * Called from sse.js when a `message.part.updated` delta lands before the
 * corresponding `message.created` has rendered an assistant message bubble.
 */
export function ensureTextPartSurface(partId, messageId) {
  if (!partId) return null
  const existing = document.querySelector(`[data-part-id="${CSS.escape(partId)}"]`)
  if (existing) return existing

  const box = document.getElementById('messages')
  if (!box) return null

  // Remove the typing indicator if present — it's replaced by a real bubble.
  box.querySelectorAll('.typing-indicator').forEach(el => el.remove())

  // Create a new assistant message bubble with a single empty text part.
  const bubble = document.createElement('div')
  bubble.className = 'message assistant'
  if (messageId) bubble.dataset.messageId = messageId
  bubble.innerHTML = `<div class="message-role">assistant</div>
    <div class="message-body md-rendered" data-part-id="${escapeHtml(partId)}"${
      messageId ? ` data-message-id="${escapeHtml(messageId)}"` : ''
    }><span class="streaming-cursor" aria-hidden="true"></span></div>`
  box.appendChild(bubble)
  box.scrollTop = box.scrollHeight
  return bubble.querySelector('[data-part-id]')
}

// TUI status symbols — minimal, terminal-style
const STATUS_ICON = {
  pending:   '○',
  running:   '◐',
  completed: '●',
  error:     '✗',
}

// ── MCP tool name detection (OpenCode SDK convention) ──────────────────────
/**
 * OpenCode MCP tool naming: `${sanitize(serverName)}_${sanitize(toolName)}`
 * where sanitize(s) = s.replace(/[^a-zA-Z0-9_-]/g, '_')
 *
 * This is DIFFERENT from the Claude Code convention (mcp__server__tool).
 * We detect by matching the tool name against known MCP server prefixes.
 *
 * @param {string} name - tool name to check
 * @returns {{ server: string, tool: string }|null}
 */
function parseMcpName(name) {
  if (!name) return null

  // Legacy fallback: Claude Code style mcp__server__tool
  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length)
    const idx = rest.indexOf('__')
    if (idx < 0) return { server: rest, tool: '' }
    return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) }
  }

  // OpenCode style: sanitize(serverName)_sanitize(toolName)
  // Match against known MCP server names from references
  let servers
  try {
    servers = getMcpServers()
  } catch (_) {
    servers = {}
  }

  for (const serverName of Object.keys(servers)) {
    const prefix = sanitizeMcpName(serverName) + '_'
    if (name.startsWith(prefix)) {
      const toolPart = name.slice(prefix.length)
      return { server: serverName, tool: toolPart }
    }
  }

  return null
}

// ── Path truncation helper ─────────────────────────────────────────────────
/**
 * Keep last N segments of a path, prefix with '…/' if truncated.
 */
function truncatePath(p, segments = 3) {
  if (!p) return ''
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= segments) return String(p)
  return '…/' + parts.slice(-segments).join('/')
}

// ── Per-builtin formatters ─────────────────────────────────────────────────
/**
 * Returns { nameHtml, argHtml, metaHtml } for the compact one-line summary.
 * All values are already HTML-safe strings.
 */
function formatBuiltinSummary(name, input, output, status) {
  const n = name.toLowerCase()

  if (n === 'read') {
    const path = truncatePath(input?.filePath ?? input?.path ?? '')
    return {
      nameHtml: `<span class="tool-name">Read</span>`,
      argHtml:  path ? `<span class="tool-arg">${escapeHtml(path)}</span>` : '',
      metaHtml: '',
    }
  }

  if (n === 'write') {
    const path = truncatePath(input?.filePath ?? input?.path ?? '')
    return {
      nameHtml: `<span class="tool-name">Write</span>`,
      argHtml:  path ? `<span class="tool-arg">${escapeHtml(path)}</span>` : '',
      metaHtml: `<span class="tool-meta">(new)</span>`,
    }
  }

  if (n === 'edit' || n === 'multiedit') {
    const path = truncatePath(input?.filePath ?? input?.path ?? '')
    const added   = output?.additions ?? null
    const removed = output?.removals  ?? null
    const diffMeta = (added !== null && removed !== null)
      ? ` <span class="tool-meta">+${added} -${removed}</span>`
      : ''
    return {
      nameHtml: `<span class="tool-name">${escapeHtml(name)}</span>`,
      argHtml:  path ? `<span class="tool-arg">${escapeHtml(path)}</span>` : '',
      metaHtml: diffMeta,
    }
  }

  if (n === 'bash') {
    const cmd = String(input?.command ?? '').slice(0, LIMITS.BASH_CMD_PREVIEW_CHARS)
    const truncated = String(input?.command ?? '').length > LIMITS.BASH_CMD_PREVIEW_CHARS
    const exitCode = output?.exitCode ?? output?.exit_code ?? null
    const exitMeta = exitCode !== null
      ? `<span class="tool-meta${exitCode !== 0 ? ' tool-status--error' : ''}">[exit ${exitCode}]</span>`
      : ''
    return {
      nameHtml: `<span class="tool-name">Bash</span>`,
      argHtml:  cmd ? `<span class="tool-arg">(${escapeHtml(cmd)}${truncated ? '…' : ''})</span>` : '',
      metaHtml: exitMeta,
    }
  }

  if (n === 'grep') {
    const pattern = input?.pattern ?? ''
    const count = output?.matches?.length ?? output?.count ?? null
    return {
      nameHtml: `<span class="tool-name">Grep</span>`,
      argHtml:  pattern ? `<span class="tool-arg">"${escapeHtml(String(pattern))}"</span>` : '',
      metaHtml: count !== null ? `<span class="tool-meta">(${count} matches)</span>` : '',
    }
  }

  if (n === 'glob') {
    const pattern = input?.pattern ?? ''
    const count = output?.files?.length ?? output?.count ?? null
    return {
      nameHtml: `<span class="tool-name">Glob</span>`,
      argHtml:  pattern ? `<span class="tool-arg">"${escapeHtml(String(pattern))}"</span>` : '',
      metaHtml: count !== null ? `<span class="tool-meta">(${count} matches)</span>` : '',
    }
  }

  if (n === 'task') {
    const desc  = String(input?.description ?? '').slice(0, 60)
    const agent = input?.subagent_type ?? ''
    return {
      nameHtml: `<span class="tool-name">Task</span>`,
      argHtml:  desc ? `<span class="tool-arg">"${escapeHtml(desc)}"</span>` : '',
      metaHtml: agent ? `<span class="tool-meta">(agent: ${escapeHtml(agent)})</span>` : '',
    }
  }

  if (n === 'todowrite') {
    const items = Array.isArray(input?.todos) ? input.todos : Array.isArray(input?.items) ? input.items : null
    const count = items !== null ? items.length : null
    return {
      nameHtml: `<span class="tool-name">TodoWrite</span>`,
      argHtml:  '',
      metaHtml: count !== null ? `<span class="tool-meta">${count} items</span>` : '',
      _todoItems: items,  // passed through to renderToolPart for expanded view
    }
  }

  // Unknown builtin: name + first N chars of JSON args
  const preview = input ? JSON.stringify(input).slice(0, LIMITS.TOOL_ARG_PREVIEW_CHARS) : ''
  return {
    nameHtml: `<span class="tool-name">${escapeHtml(name)}</span>`,
    argHtml:  preview ? `<span class="tool-arg">${escapeHtml(preview)}…</span>` : '',
    metaHtml: '',
  }
}

/**
 * Format an MCP tool (mcp__server__tool pattern).
 */
function formatMcpSummary(name, input) {
  const mcp = parseMcpName(name)
  const args = input ? JSON.stringify(input).slice(0, LIMITS.TOOL_ARG_PREVIEW_CHARS) : ''
  return {
    nameHtml: `<span class="tool-mcp-server">[${escapeHtml(mcp.server)}]</span> <span class="tool-name">${escapeHtml(mcp.tool || name)}</span>`,
    argHtml:  args ? `<span class="tool-arg">${escapeHtml(args)}…</span>` : '',
    metaHtml: '',
  }
}

function renderToolPart(p) {
  const { tools } = getState().settings
  const name = p.tool ?? p.toolName ?? p.name ?? 'tool'
  const toolState = p.state ?? {}
  const status = toolState.status ?? (p.result !== undefined ? 'completed' : 'pending')
  const input  = toolState.input  ?? p.args
  const output = toolState.output ?? (p.result !== undefined ? p.result : undefined)
  const id = 'tool-' + Math.random().toString(36).slice(2)

  const statusIcon = STATUS_ICON[status] ?? '○'

  // Determine summary format
  const isMcp = parseMcpName(name) !== null
  const summaryResult = isMcp
    ? formatMcpSummary(name, input)
    : formatBuiltinSummary(name, input, output, status)
  const { nameHtml, argHtml, metaHtml } = summaryResult
  // TodoWrite: capture item list for expanded body
  const todoItems = summaryResult._todoItems ?? null

  // Status icon class for pulse on running
  const iconClass = `tool-prefix tool-prefix--${status}`

  // Compact summary line
  const summaryHtml = `<span class="${iconClass}">${statusIcon}</span> ${nameHtml}${argHtml ? ' ' + argHtml : ''}${metaHtml ? ' ' + metaHtml : ''}`

  // ── Expanded body (input + output/error) ──────────────────────────────
  let argsHtml = ''
  if (input !== undefined && input !== null) {
    const argsJson = JSON.stringify(input, null, 2)
    let highlighted = ''
    try {
      highlighted = hljs.highlight(argsJson, { language: 'json' }).value
    } catch (_) {
      highlighted = escapeHtml(argsJson)
    }
    argsHtml = `<div style="margin-bottom:4px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">INPUT</div><pre class="hljs" style="margin:0;border-radius:2px;font-size:10px;border:1px solid var(--border)">${highlighted}</pre>`
  }

  let resultHtml = ''
  if (status === 'completed' && output !== undefined) {
    const raw = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    resultHtml = `<div style="margin-top:6px;margin-bottom:4px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">OUTPUT</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;max-height:260px;overflow-y:auto">${escapeHtml(raw)}</pre>`
  } else if (status === 'error' && toolState.error !== undefined) {
    const errMsg = typeof toolState.error === 'string'
      ? toolState.error
      : JSON.stringify(toolState.error, null, 2)
    resultHtml = `<div style="margin-top:6px;margin-bottom:4px;font-size:10px;color:var(--danger);font-weight:700;text-transform:uppercase;letter-spacing:.06em">ERROR</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;color:var(--danger)">${escapeHtml(errMsg)}</pre>`
  } else if (p.result !== undefined && output === undefined) {
    const raw = typeof p.result === 'string' ? p.result : JSON.stringify(p.result, null, 2)
    resultHtml = `<div style="margin-top:6px;margin-bottom:4px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">RESULT</div><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;max-height:260px;overflow-y:auto">${escapeHtml(raw)}</pre>`
  }

  const autoOpen = (status === 'running' || status === 'error') ? ' open' : ''
  const hiddenClass = tools ? '' : 'hidden-tools'

  // TodoWrite: render individual items with pin buttons in the expanded body
  let todoItemsHtml = ''
  if (todoItems && todoItems.length) {
    const rows = todoItems.map((item, idx) => {
      const text    = escapeHtml(String(item.text ?? item.content ?? ''))
      const st      = item.status ?? 'pending'
      const stClass = st === 'completed' ? 'completed' : st === 'in_progress' ? 'in-progress' : 'pending'
      const stIcon  = st === 'completed' ? '●' : st === 'in_progress' ? '◐' : '○'
      const itemIdx = idx  // captured for onclick
      return `<div class="tw-item tw-item--${escapeHtml(stClass)}">
        <span class="tw-item-icon" aria-hidden="true">${stIcon}</span>
        <span class="tw-item-text">${text}</span>
        <button class="tw-pin-btn" onclick="window.__pinTodoItem(this)" data-text="${escapeHtml(String(item.text ?? item.content ?? ''))}" title="Pin this todo">[+]</button>
      </div>`
    }).join('')
    todoItemsHtml = `<div class="tw-items">${rows}</div>`
  }

  const partIdAttr = p.id ? ` data-part-id="${escapeHtml(p.id)}"` : ''
  const msgIdAttr = p.messageID ? ` data-message-id="${escapeHtml(p.messageID)}"` : ''
  return `<div class="tool-block ${hiddenClass}${autoOpen}" id="${id}"${partIdAttr}${msgIdAttr}>
    <div class="tool-line tool-header" onclick="window.__toggleTool('${id}')">
      ${summaryHtml}
      <span class="tool-chevron">▶</span>
    </div>
    <div class="tool-body">${todoItemsHtml}${argsHtml}${resultHtml}</div>
  </div>`
}

/**
 * Error boundary wrapper — wraps a panel's render in try/catch.
 * On error, replaces content with a recoverable error state.
 */
function withErrorBoundary(panelId, renderFn, retryFn) {
  const box = document.getElementById(panelId)
  if (!box) return
  try {
    renderFn(box)
  } catch (err) {
    console.error(`[panel-error] ${panelId}:`, err)
    box.innerHTML = `<div class="panel-error">
      <span>⚠ Panel failed to render (check console)</span>
      <button class="panel-error-retry" id="${panelId}-retry">Retry</button>
    </div>`
    if (retryFn) {
      document.getElementById(`${panelId}-retry`)?.addEventListener('click', () => retryFn())
    }
  }
}

/**
 * Show a "typing…" indicator in the messages pane.
 * Used when MESSAGE_CREATED (assistant) arrives so streaming deltas can
 * immediately populate the pane WITHOUT a full loadMessages() wipe.
 * The indicator is removed automatically by the next loadMessages() call.
 */
export function showTypingIndicator() {
  const box = document.getElementById('messages')
  if (!box) return
  // Avoid adding duplicate indicators
  if (box.querySelector('.typing-indicator')) return
  const el = document.createElement('div')
  el.className = 'typing-indicator'
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', 'Agent is typing')
  el.innerHTML = '<span></span><span></span><span></span>'
  box.appendChild(el)
  // Scroll to bottom so the indicator is visible
  box.scrollTop = box.scrollHeight
}

/**
 * Load messages for a session and render them into #messages.
 *
 * The "Loading…" placeholder used to wipe the box on every call — including
 * during a streaming assistant turn triggered by `message.updated`. That
 * erased in-progress deltas and made the UI flash. We now only show the
 * placeholder when the pane is genuinely empty (first load, session switch).
 */
export async function loadMessages(sessionId) {
  const box = document.getElementById('messages')
  const alreadyHasMessages = !!box.querySelector('.message')
  if (!alreadyHasMessages) {
    // State C — loading
    box.innerHTML = `<div class="empty-state onboarding-loading">
      <div class="spinner-small"></div>
      <p>Loading messages…</p>
    </div>`
  }
  try {
    const raw = await fetchMessages(sessionId)
    const msgs = Array.isArray(raw) ? raw : []
    console.debug('[pilot:data] loadMessages session=%s raw=%d', sessionId, msgs.length)
    withErrorBoundary('messages', () => renderMessages(msgs, { sessionId }), () => loadMessages(sessionId))
  } catch (_) {
    if (!alreadyHasMessages) {
      box.innerHTML = '<div class="panel-error"><span>⚠ Failed to load messages</span></div>'
    }
  }
}

/**
 * Render an array of raw SDK messages into #messages.
 * Accepts wrapped ({ info, parts }) or flat shapes — normalizeMessage handles both.
 *
 * Empty-state rendering is state-aware:
 *  - No active session     → State A: onboarding with CTA buttons
 *  - Session exists, msgs empty → State B: "type your first prompt"
 *  - (Loading state C is set by loadMessages before this is called)
 */
export function renderMessages(msgs, { sessionId } = {}) {
  const box = document.getElementById('messages')
  if (!msgs.length) {
    const { activeSession } = getState()
    if (!activeSession) {
      // State A — no session selected
      box.innerHTML = `<div class="empty-state onboarding-empty" id="no-session-state">
        <h3>No session selected</h3>
        <p>Create a new session or pick one from the sidebar to start.</p>
        <div class="onboarding-actions">
          <button class="btn btn-primary" data-action="create-session">Create new session</button>
          <button class="btn btn-ghost" data-action="open-palette">Open command palette (Ctrl/Cmd+K)</button>
        </div>
      </div>`
    } else {
      // State B — session selected, no messages yet
      box.innerHTML = `<div class="empty-state onboarding-empty" id="no-session-state">
        <h3>Session ready</h3>
        <p>Type your first prompt below and press Enter.</p>
        <p class="muted">Need ideas? Try: "Explain this project", "Run the tests", "Find TODO comments".</p>
      </div>`
    }
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

/**
 * Render an array of raw SDK messages into a specific panel element.
 * Shared between the single-session view and multi-view.
 *
 * @param {HTMLElement} box   — the container to render into
 * @param {Array}       msgs  — raw SDK messages (wrapped or flat)
 * @param {object}      [opts]
 * @param {boolean}     [opts.compact=false] — compact mode (used by multi-view)
 * @param {boolean}     [opts.scrollToBottom=true]
 */
export function renderMessageIntoPanel(box, msgs, opts = {}) {
  if (!box) return
  const { compact = false, scrollToBottom = true } = opts
  if (!Array.isArray(msgs) || msgs.length === 0) {
    box.innerHTML = `<div class="mv-empty" style="color:var(--text-dim);font-size:.78rem;text-align:center;padding:12px">No messages yet.</div>`
    return
  }
  try {
    box.innerHTML = msgs.map(m => renderMsg(m)).join('')
  } catch (err) {
    console.error('[pilot:data] renderMessageIntoPanel failed', err)
    box.innerHTML = `<div class="panel-error"><span>⚠ Failed to render messages</span></div>`
    return
  }
  const { tools } = getState().settings
  box.querySelectorAll('.tool-block').forEach(el => el.classList.toggle('hidden-tools', !tools))
  if (compact) box.classList.add('mv-msgs--compact')
  if (scrollToBottom) box.scrollTop = box.scrollHeight
}
