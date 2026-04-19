// references.js — Dynamic OpenCode config references (agents, models, MCP servers, project)
// Factory that fetches /agents, /providers, /mcp/status, /project/current once,
// caches them in module-scope, and exposes getters.
import { fetchAgents, fetchProviders, fetchMcpStatus, fetchCurrentProject, fetchLspStatus } from './api.js'
import { toast } from './toast.js'
import { AGENT_COLOR, EVENTS, AGENT_BADGE_CLASS } from './constants.js'

// ── Module-scope cache ─────────────────────────────────────────────────────
/** @type {Array<Agent>} */
let _agents = []
/** @type {Array<Provider>} */
let _providers = []
/** @type {Record<string,string>} default modelID per providerID */
let _defaultModels = {}
/** @type {Array<string>} connected provider IDs */
let _connectedProviders = []
/** @type {Record<string,McpStatus>} */
let _mcpServers = {}
/** @type {object|null} current project */
let _currentProject = null
/** @type {Array<{id: string, name: string, root: string, status: string}>} */
let _lspClients = []
/** @type {boolean} */
let _initialized = false

// ── Generic reference factory ─────────────────────────────────────────────────
/**
 * createReference({ fetchFn, key })
 *
 * Generic factory for a simple cache-and-lookup reference.
 * Covers single-resource endpoints that return a flat array.
 *
 * Not used for providers (which returns multiple fields: all/default/connected)
 * or project/lsp (complex shapes). Those remain as dedicated module-scope vars.
 *
 * @param {{ fetchFn: () => Promise<Array>, key?: string }} opts
 * @returns {{ load, list, get, isReady }}
 */
export function createReference({ fetchFn, key = 'name' }) {
  let cache = []
  let loaded = false
  return {
    async load() {
      try {
        cache = await fetchFn()
        loaded = true
      } catch (_) {
        // On failure, cache stays empty and isReady stays false
      }
    },
    list() { return cache },
    get(value) { return cache.find(x => x[key] === value) },
    isReady() { return loaded },
  }
}

// ── Sanitize helper (mirrors OpenCode SDK MCP tool naming) ─────────────────
/**
 * Sanitize a server/tool name to match OpenCode's MCP tool prefix convention.
 * OpenCode SDK: `${sanitize(serverName)}_${sanitize(toolName)}`
 * where sanitize(s) = s.replace(/[^a-zA-Z0-9_-]/g, '_')
 */
export function sanitizeMcpName(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_')
}

// ── Hash-based deterministic color from a string ──────────────────────────
/**
 * Returns a CSS hsl() color string derived deterministically from the name.
 * The hue cycles through the full spectrum; saturation + lightness stay
 * in the TUI-appropriate muted range.
 */
export function agentColorFromName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const hue = ((hash >>> 0) % 360)
  return `hsl(${hue}, ${AGENT_COLOR.SATURATION}%, ${AGENT_COLOR.LIGHTNESS}%)`
}

// ── Fetch helpers (graceful fallback) ─────────────────────────────────────

async function safeFetch(fn, fallback, label) {
  try {
    return await fn()
  } catch (err) {
    console.warn(`[references] Failed to fetch ${label}:`, err?.message ?? err)
    return fallback
  }
}

// ── Core refresh ──────────────────────────────────────────────────────────

export async function refresh() {
  const [agentsRes, providersRes, mcpRes, projectRes, lspRes] = await Promise.all([
    safeFetch(fetchAgents,         { agents: [] },           '/agents'),
    safeFetch(fetchProviders,      { all: [], default: {}, connected: [] }, '/providers'),
    safeFetch(fetchMcpStatus,      { servers: {} },          '/mcp/status'),
    safeFetch(fetchCurrentProject, { project: null },        '/project/current'),
    safeFetch(fetchLspStatus,      { clients: [] },          '/lsp/status'),
  ])

  _agents             = agentsRes?.agents            ?? []
  _providers          = providersRes?.all            ?? []
  _defaultModels      = providersRes?.default         ?? {}
  _connectedProviders = providersRes?.connected       ?? []
  _mcpServers         = mcpRes?.servers               ?? {}
  _currentProject     = projectRes?.project           ?? null
  _lspClients         = lspRes?.clients               ?? []

  console.debug('[references] Refreshed:', {
    agents:    _agents.length,
    providers: _providers.length,
    connected: _connectedProviders,
    mcp:       Object.keys(_mcpServers).length,
    lsp:       _lspClients.length,
    project:   _currentProject?.path ?? _currentProject?.worktree ?? null,
  })
}

export async function init() {
  if (_initialized) return
  _initialized = true
  await refresh()
  // Debug: log what was loaded (visible in DevTools console under [references])
  console.debug('[references] Loaded:', {
    agents:     _agents.map(a => a.name),
    providers:  _providers.map(p => p.id),
    connected:  _connectedProviders,
    mcp:        Object.keys(_mcpServers),
    project:    _currentProject?.path ?? _currentProject?.worktree ?? null,
    lsp:        _lspClients.map(c => c.name),
  })
  // Fire a global event so dependent modules can react
  window.dispatchEvent(new CustomEvent(EVENTS.REFERENCES_READY))
}

/**
 * Return whether references have been initialized.
 */
export function isInitialized() {
  return _initialized
}

// ── Getters ───────────────────────────────────────────────────────────────

/**
 * Return connected LSP clients.
 * @returns {Array<{id: string, name: string, root: string, status: string}>}
 */
export function getLspClients() {
  return _lspClients
}

/**
 * Return all known agents.
 * @returns {Array}
 */
export function getAgents() {
  return _agents
}

/**
 * Find an agent by name (case-insensitive).
 * @param {string} name
 * @returns {object|undefined}
 */
export function getAgent(name) {
  if (!name) return undefined
  const lower = name.toLowerCase()
  return _agents.find(a => a.name?.toLowerCase() === lower)
}

/**
 * Find a model by its modelID (exact match) across all providers.
 * @param {string} modelId
 * @returns {object|undefined}
 */
export function getModel(modelId) {
  if (!modelId) return undefined
  for (const provider of _providers) {
    const models = provider.models ?? {}
    if (models[modelId]) return models[modelId]
    // Also search by model.id in case keys differ
    const found = Object.values(models).find(m => m.id === modelId)
    if (found) return found
  }
  return undefined
}

/**
 * Find a provider by its ID (exact match).
 * @param {string} providerId
 * @returns {object|undefined}
 */
export function getProvider(providerId) {
  if (!providerId) return undefined
  return _providers.find(p => p.id === providerId)
}

/**
 * Return the full MCP servers status map.
 * @returns {Record<string,McpStatus>}
 */
export function getMcpServers() {
  return _mcpServers
}

/**
 * Return the current project info.
 * @returns {object|null}
 */
export function getCurrentProject() {
  return _currentProject
}

/**
 * Return default models map (providerID → modelID).
 * @returns {Record<string,string>}
 */
export function getDefaultModels() {
  return _defaultModels
}

/**
 * Return all providers.
 * @returns {Array}
 */
export function getProviders() {
  return _providers
}

/**
 * Return connected provider IDs.
 * @returns {Array<string>}
 */
export function getConnectedProviders() {
  return _connectedProviders
}

/**
 * Return the first default model entry as { modelId, providerId } or null.
 */
export function getFirstDefaultModel() {
  const entries = Object.entries(_defaultModels)
  if (!entries.length) return null
  const [providerId, modelId] = entries[0]
  return { providerId, modelId }
}

// ── Agent badge HTML helper ───────────────────────────────────────────────

/**
 * Render an agent badge <span> for the given agent name.
 * Uses agent.color if defined, otherwise derives one from the name hash.
 * If the agent is unknown, renders a muted "custom" badge.
 *
 * Export this so sessions.js (other subagent) can call renderAgentBadge(name).
 * TODO (sessions subagent): import and use renderAgentBadge(name) from references.js
 *      for session-list header badges instead of hardcoded classes.
 *
 * @param {string} agentName
 * @returns {string} HTML string
 */
export function renderAgentBadge(agentName) {
  if (!agentName) return ''
  const agent = getAgent(agentName)
  const label = agentName

  if (agent) {
    const color = agent.color || agentColorFromName(agentName)
    const desc  = agent.description ? ` title="${escapeHtml(agent.description)}"` : ''
    return `<span class="agent-badge ${AGENT_BADGE_CLASS.dynamic}" style="--agent-color:${color};border-color:${color}40;color:${color}"${desc}>${escapeHtml(label)}</span>`
  }

  // Unknown agent — muted custom badge
  return `<span class="agent-badge ${AGENT_BADGE_CLASS.custom}" title="Custom / unknown agent">${escapeHtml(label)}</span>`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
