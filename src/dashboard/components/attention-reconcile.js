// attention-reconcile.js — Rebuild project-scoped attention from server snapshots.
// SSE replay is bounded, so reconnect must treat /permissions and /questions as
// canonical truth rather than relying solely on events received while connected.

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function attentionKey(kind, project, id) {
  return `${kind}:${encodeURIComponent(text(project))}:${text(id)}`
}

function permissionEntry(permission, project) {
  const id = permission?.id ?? permission?.permissionID
  if (!id) return null
  const detail = permission?.pattern ?? permission?.command ?? permission?.metadata?.command ?? ''
  return {
    key: attentionKey('permission', project, id),
    kind: 'permission',
    title: permission?.title ?? permission?.description ?? 'Permission required',
    detail: Array.isArray(detail) ? detail.join(' ') : String(detail),
    sessionID: permission?.sessionID,
    project,
    attention: true,
  }
}

function questionEntry(question, project) {
  const id = question?.id ?? question?.requestID
  if (!id) return null
  const first = Array.isArray(question?.questions) ? question.questions[0] : null
  return {
    key: attentionKey('question', project, id),
    kind: 'question',
    title: first?.header ?? 'Input required',
    detail: first?.question ?? 'OpenCode needs your input',
    sessionID: question?.sessionID,
    project,
    attention: true,
  }
}

/**
 * Make the local Activity Center agree with a successfully fetched attention
 * snapshot. This is intentionally idempotent: repeated reconnects add no
 * duplicate records, and only items tagged with the refreshed project can be
 * resolved as stale.
 */
export function reconcileAttentionSnapshots({ store, project, permissions = [], questions = [] }) {
  const activeKeys = new Set()
  for (const permission of permissions) {
    const entry = permissionEntry(permission, project)
    if (!entry) continue
    activeKeys.add(entry.key)
    store.add(entry)
  }
  for (const question of questions) {
    const entry = questionEntry(question, project)
    if (!entry) continue
    activeKeys.add(entry.key)
    store.add(entry)
  }
  store.reconcileAttention(project, activeKeys)
  return activeKeys
}
