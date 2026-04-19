// api.js — All HTTP API calls centralized
import { getState, getActiveDirectory } from './state.js'
import { apiFetch } from './api-fetch.js'

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

// Exported so sse.js can build the /events URL with ?directory= appended
export function buildApiUrl(path) {
  return buildUrl(path)
}

function isDirectoryExempt(path) {
  // Also exempt /permissions/* paths
  if (path.startsWith('/permissions')) return true
  return DIRECTORY_EXEMPT.some(p => path === p || path.startsWith(p + '?'))
}

function buildUrl(path, overrideDir) {
  // If an explicit directory is provided (non-null / non-undefined), use it.
  // Passing `null` explicitly forces default-instance behaviour (no ?directory=).
  const dir = overrideDir !== undefined ? overrideDir : getActiveDirectory()
  if (!dir || isDirectoryExempt(path)) {
    return baseUrl() + path
  }
  // Safely append ?directory= using URLSearchParams, preserving any existing query params
  const [pathname, existingQuery] = path.split('?')
  const params = new URLSearchParams(existingQuery || '')
  params.set('directory', dir)
  return baseUrl() + pathname + '?' + params.toString()
}

// GET requests use apiFetch (retry + backoff).
// Mutating methods (POST, PATCH, DELETE) use plain fetch — fail-fast to avoid
// duplicate side effects.
async function request(method, path, body, opts = {}) {
  const fetchOpts = { method, headers: authHeaders() }
  if (body) fetchOpts.body = JSON.stringify(body)
  const url = buildUrl(path, opts.directory)
  const fetcher = method === 'GET' ? apiFetch : fetch
  const r = await fetcher(url, fetchOpts)
  const data = r.ok ? await r.json() : null
  if (!r.ok) {
    console.debug('[pilot:data] request %s %s → %d', method, url, r.status)
    const err = new Error(`${r.status}`)
    err.status = r.status
    throw err
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

export async function fetchMessages(sessionId, opts = {}) {
  return request('GET', `/sessions/${sessionId}/messages`, null, opts)
}

export async function updateSessionTitle(sessionId, title) {
  return request('PATCH', `/sessions/${sessionId}`, { title })
}

export async function deleteSession(sessionId, opts = {}) {
  return request('DELETE', `/sessions/${sessionId}`, null, opts)
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
  const r = await apiFetch(baseUrl() + '/health')
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

// ── Glob file opener ──────────────────────────────────────────────────────

/**
 * Search for files matching a glob pattern. Requires PILOT_ENABLE_GLOB_OPENER=true on server.
 * Throws an error with code='GLOB_DISABLED' when the feature is off.
 * @param {string} pattern - glob pattern (e.g. "**\/*.ts")
 * @param {{ cwd?: string, limit?: number }} [opts]
 * @returns {Promise<{pattern:string,cwd:string,count:number,files:Array<{path:string,absolute:string,mtime:number,size:number}>}>}
 */
export async function fetchGlobFiles(pattern, opts = {}) {
  const params = new URLSearchParams()
  params.set('pattern', pattern)
  if (opts.cwd) params.set('cwd', opts.cwd)
  if (opts.limit) params.set('limit', String(opts.limit))
  const url = baseUrl() + '/fs/glob?' + params.toString()
  const r = await fetch(url, { headers: authHeaders() })
  if (r.status === 403) {
    const err = new Error('GLOB_DISABLED')
    err.code = 'GLOB_DISABLED'
    err.status = 403
    throw err
  }
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

/**
 * Read a file by absolute path via /fs/read. Requires glob opener flag.
 * @param {string} path - absolute path
 * @returns {Promise<{path:string,content:string,size:number}>}
 */
export async function readAbsFile(path) {
  const url = baseUrl() + '/fs/read?path=' + encodeURIComponent(path)
  const r = await fetch(url, { headers: authHeaders() })
  if (r.status === 403) {
    const err = new Error('GLOB_DISABLED')
    err.code = 'GLOB_DISABLED'
    err.status = 403
    throw err
  }
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

// ── Web Push ──────────────────────────────────────────────────────────────

/** Fetch the VAPID public key. Returns null if push is not configured on the server. */
export async function pushPublicKey() {
  const url = baseUrl() + '/push/public-key'
  const r = await fetch(url, { headers: authHeaders() })
  if (r.status === 503) return null
  if (!r.ok) throw new Error(`${r.status}`)
  const data = await r.json()
  return data?.publicKey ?? null
}

export async function pushSubscribe(sub) {
  const url = baseUrl() + '/push/subscribe'
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(sub),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

export async function pushUnsubscribe(endpoint) {
  const url = baseUrl() + '/push/unsubscribe'
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ endpoint }),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

export async function pushTest(endpoint) {
  const url = baseUrl() + '/push/test'
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(endpoint ? { endpoint } : {}),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
