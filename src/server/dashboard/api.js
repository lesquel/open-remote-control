// api.js — All HTTP API calls centralized
import { getState, getActiveDirectory } from './state.js'

/**
 * Base URL for API calls.
 * - Embedded mode (localhost): empty string → same-origin fetch
 * - Standalone mode (GitHub Pages / other host): full tunnel URL stored in state
 */
function baseUrl() {
  return getState().serverUrl || ''
}

function authHeaders() {
  return {
    'Authorization': `Bearer ${getState().token}`,
    'Content-Type': 'application/json',
  }
}

// Endpoints that are global (never get ?directory= appended)
const DIRECTORY_EXEMPT = [
  '/health',
  '/auth/rotate',
  '/status',
  '/projects',
]

function isDirectoryExempt(path) {
  // Also exempt /permissions/* paths
  if (path.startsWith('/permissions')) return true
  return DIRECTORY_EXEMPT.some(p => path === p || path.startsWith(p + '?'))
}

function buildUrl(path) {
  const dir = getActiveDirectory()
  if (!dir || isDirectoryExempt(path)) {
    return baseUrl() + path
  }
  // Safely append ?directory= using URLSearchParams, preserving any existing query params
  const [pathname, existingQuery] = path.split('?')
  const params = new URLSearchParams(existingQuery || '')
  params.set('directory', dir)
  return baseUrl() + pathname + '?' + params.toString()
}

async function request(method, path, body) {
  const opts = { method, headers: authHeaders() }
  if (body) opts.body = JSON.stringify(body)
  const url = buildUrl(path)
  const r = await fetch(url, opts)
  const data = r.ok ? await r.json() : null
  if (!r.ok) {
    console.debug('[pilot:data] request %s %s → %d', method, url, r.status)
    throw new Error(`${r.status}`)
  }
  // Log shape summary for debugging (array length or top-level keys)
  if (Array.isArray(data)) {
    console.debug('[pilot:data] request %s %s → array[%d]', method, url, data.length)
  } else if (data && typeof data === 'object') {
    console.debug('[pilot:data] request %s %s → {%s}', method, url, Object.keys(data).join(','))
  }
  return data
}

export async function fetchSessions() {
  return request('GET', '/sessions')
}

export async function createSession() {
  return request('POST', '/sessions')
}

export async function fetchMessages(sessionId) {
  return request('GET', `/sessions/${sessionId}/messages`)
}

export async function sendPrompt(sessionId, message) {
  return request('POST', `/sessions/${sessionId}/prompt`, { message })
}

export async function abortSession(sessionId) {
  return request('POST', `/sessions/${sessionId}/abort`)
}

export async function fetchDiff(sessionId) {
  return request('GET', `/sessions/${sessionId}/diff`)
}

export async function getSessionChildren(sessionId) {
  return request('GET', `/sessions/${sessionId}/children`)
}

export async function fetchPermissions() {
  return request('GET', '/permissions')
}

export async function respondPermission(id, action) {
  return request('POST', `/permissions/${id}`, { action })
}

export async function rotateAuthToken() {
  return request('POST', '/auth/rotate')
}

export async function fetchHealth() {
  const r = await fetch(baseUrl() + '/health')
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

// ── Dynamic config fetchers (Deliverable 8) ───────────────────────────────

export async function fetchAgents() {
  return request('GET', '/agents')
}

export async function fetchProviders() {
  return request('GET', '/providers')
}

export async function fetchMcpStatus() {
  return request('GET', '/mcp/status')
}

export async function fetchCurrentProject() {
  return request('GET', '/project/current')
}

export async function fetchProjects() {
  return request('GET', '/projects')
}

export async function fetchLspStatus() {
  return request('GET', '/lsp/status')
}

/**
 * Fetch instance metadata (version, mode).
 * Falls back gracefully if the endpoint is 404 (not yet deployed).
 * Returns null on failure — callers should handle null.
 */
export async function fetchInstanceInfo() {
  try {
    const r = await fetch(baseUrl() + '/instance', { headers: authHeaders() })
    if (!r.ok) return null
    return r.json()
  } catch (_) {
    return null
  }
}

/**
 * Send a prompt to a session with optional agent/model override.
 * Body shape matches handlers.ts PromptBody: model is nested { providerID, modelID }.
 * @param {string} sessionId
 * @param {string} message
 * @param {{ agent?: string, modelID?: string, providerID?: string }} [opts]
 */
export async function sendPromptWithOpts(sessionId, message, opts = {}) {
  const body = { message }
  if (opts.agent) body.agent = opts.agent
  // model must be a nested object per backend PromptBody interface
  if (opts.modelID && opts.providerID) {
    body.model = { providerID: opts.providerID, modelID: opts.modelID }
  } else if (opts.modelID) {
    body.model = { modelID: opts.modelID, providerID: '' }
  }
  console.debug('[pilot:data] sendPromptWithOpts session=%s agent=%s model=%o', sessionId, opts.agent, body.model)
  return request('POST', `/sessions/${sessionId}/prompt`, body)
}

// ── File browser API ──────────────────────────────────────────────────────

/**
 * List files/directories at a given path within the active project.
 * @param {string} path - relative path within the project (e.g. "." or "src")
 * @returns {Promise<Array<{name:string,path:string,absolute:string,type:string,ignored:boolean}>>}
 */
export async function fetchFileList(path) {
  return request('GET', `/file/list?path=${encodeURIComponent(path)}`)
}

/**
 * Fetch content of a file by absolute path.
 * @param {string} path - absolute path to the file
 * @returns {Promise<{type:string,content:string,encoding?:string,mimeType?:string}>}
 */
export async function fetchFileContent(path) {
  return request('GET', `/file/content?path=${encodeURIComponent(path)}`)
}
