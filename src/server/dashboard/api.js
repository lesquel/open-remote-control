// api.js — All HTTP API calls centralized
import { getState } from './state.js'

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

async function request(method, path, body) {
  const opts = { method, headers: authHeaders() }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(baseUrl() + path, opts)
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
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

export async function fetchPermissions() {
  return request('GET', '/permissions')
}

export async function respondPermission(id, action) {
  return request('POST', `/permissions/${id}`, { action })
}
