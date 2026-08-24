// permission-response.js — exactly-once client gate for permission actions

function permissionId(permission) {
  return permission?.id ?? permission?.permissionID
}

function permissionKey(permission) {
  const metadata = permission?.metadata && typeof permission.metadata === 'object' ? permission.metadata : {}
  return JSON.stringify([
    permissionId(permission) ?? '',
    permission?.integrationID ?? metadata.integrationID ?? '',
    permission?.directory ?? metadata.directory ?? '',
    permission?.sessionID ?? metadata.sessionID ?? '',
  ])
}

export function createPermissionResponder({
  getPending,
  setPending,
  send,
  refresh,
  render,
  setBusy,
  onError,
}) {
  let inFlightId = null

  return async function respond(action) {
    if (inFlightId !== null) return false

    const current = getPending()[0]
    const id = permissionId(current)
    if (!id) {
      await refresh()
      return false
    }

    inFlightId = id
    setBusy(true)
    try {
      await send(id, action, current)
      const key = permissionKey(current)
      setPending(getPending().filter((permission) => permissionKey(permission) !== key))
      return true
    } catch {
      onError()
      await refresh()
      return false
    } finally {
      inFlightId = null
      setBusy(false)
      render()
    }
  }
}
