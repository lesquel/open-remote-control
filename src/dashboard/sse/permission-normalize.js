// permission-normalize.js — Pure helpers that normalize SSE permission events
// to the stable shape expected by handlePermissionRequested / handlePermissionResolved.
//
// Extracted so the logic is testable without importing browser-API-dependent modules.
// Both native OpenCode events (`permission.requested` / `permission.resolved`) and
// Codex bridge events (`pilot.permission.pending` / `pilot.permission.resolved`)
// carry their payload under `ev.properties`. Named-event SSE wrappers may carry
// the payload under `ev.data` instead — both paths are handled.

/**
 * Normalize any permission-pending SSE event (native or Codex) to the stable shape
 * consumed by handlePermissionRequested in permissions.js.
 *
 * @param {object} ev  Raw SSE event object: { type, properties?, data? }
 * @returns {{ id, permissionID, description, title, sessionID, type, pattern, metadata }}
 */
export function normalizePermissionPending(ev) {
  const d = ev.data ?? ev
  const props = ev.properties ?? d ?? {}
  return {
    id:           props.permissionID ?? props.id,
    permissionID: props.permissionID ?? props.id,
    description:  props.title ?? props.description ?? props.permission,
    title:        props.title ?? props.permission,
    sessionID:    props.sessionID,
    type:         props.permissionType ?? props.permission ?? props.type,
    pattern:      props.pattern ?? props.patterns,
    metadata:     props.metadata,
    integrationID: props.integrationID ?? props.metadata?.integrationID,
    projectID:    props.projectID ?? props.metadata?.projectID,
    directory:    props.directory ?? props.metadata?.directory,
  }
}

/**
 * Normalize any permission-resolved SSE event (native or Codex) to the stable shape
 * consumed by handlePermissionResolved in permissions.js.
 *
 * @param {object} ev  Raw SSE event object: { type, properties?, data? }
 * @returns {{ id, permissionID }}
 */
export function normalizePermissionResolved(ev) {
  const d = ev.data ?? ev
  const resolvedProps = ev.properties ?? d ?? {}
  const integrationID = resolvedProps.integrationID ?? resolvedProps.metadata?.integrationID
  const projectID = resolvedProps.projectID ?? resolvedProps.metadata?.projectID
  const directory = resolvedProps.directory ?? resolvedProps.metadata?.directory
  const sessionID = resolvedProps.sessionID ?? resolvedProps.metadata?.sessionID
  return {
    id:           resolvedProps.permissionID ?? resolvedProps.requestID ?? resolvedProps.id,
    permissionID: resolvedProps.permissionID ?? resolvedProps.requestID ?? resolvedProps.id,
    ...(integrationID === undefined ? {} : { integrationID }),
    ...(projectID === undefined ? {} : { projectID }),
    ...(directory === undefined ? {} : { directory }),
    ...(sessionID === undefined ? {} : { sessionID }),
  }
}
