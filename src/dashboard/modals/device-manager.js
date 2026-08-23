export function createDeviceManager(deps) {
  const api = deps
  let devices = null
  let currentDeviceId = null
  let errorMessage = ''

  async function refresh() {
    try {
      const result = await api.fetchDevices()
      devices = result.devices
      currentDeviceId = result.currentDeviceId
      errorMessage = ''
    } catch (error) {
      errorMessage = error?.status === 403
        ? 'Only admin devices can manage connected devices.'
        : 'Could not load connected devices.'
    }
  }

  function render() {
    if (errorMessage) return `<div class="cpm-empty" role="alert">${errorMessage}</div>`
    if (!devices) return '<div class="cpm-loading">Loading devices…</div>'
    if (devices.length === 0) return '<div class="cpm-empty">No paired devices yet. Use the Pair device tab to connect one.</div>'
    const rows = devices.map(device => {
      const inactive = device.revokedAt !== null || (device.expiresAt !== null && device.expiresAt <= Date.now())
      const current = device.id === currentDeviceId
      return `
        <article class="cpm-device ${inactive ? 'is-inactive' : ''}" data-device-id="${escHtml(device.id)}">
          <div class="cpm-device-heading">
            <label class="sr-only" for="device-name-${escHtml(device.id)}">Device name</label>
            <input class="input cpm-device-name" id="device-name-${escHtml(device.id)}" maxlength="80" value="${escHtml(device.name)}" ${inactive ? 'disabled' : ''} />
            ${current ? '<span class="cpm-current-badge">This device</span>' : ''}
          </div>
          <div class="cpm-device-meta">Last active: ${escHtml(new Date(device.lastActiveAt).toLocaleString())}${inactive ? ' · Revoked or expired' : ''}</div>
          <div class="cpm-device-actions">
            <label class="sr-only" for="device-role-${escHtml(device.id)}">Access role</label>
            <select class="input cpm-device-role" id="device-role-${escHtml(device.id)}" ${inactive ? 'disabled' : ''}>
              ${['read-only', 'interactive', 'operator', 'admin'].map(role => `<option value="${role}" ${role === device.role ? 'selected' : ''}>${role}</option>`).join('')}
            </select>
            <button class="btn btn-secondary cpm-device-save" ${inactive ? 'disabled' : ''}>Save</button>
            <button class="btn btn-danger cpm-device-revoke" ${inactive ? 'disabled' : ''}>Revoke</button>
          </div>
        </article>`
    }).join('')
    return `<div class="cpm-devices" aria-live="polite">${rows}</div>`
  }

  function wire(container, onRefresh) {
    container.querySelectorAll('.cpm-device').forEach(row => {
      const id = row.dataset.deviceId
      row.querySelector('.cpm-device-save')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true
        try {
          await api.updateDevice(id, {
            name: row.querySelector('.cpm-device-name').value,
            role: row.querySelector('.cpm-device-role').value,
          })
          deps.toast('Device updated')
          await onRefresh()
        } catch (error) {
          event.currentTarget.disabled = false
          deps.toast(`Could not update device: ${error?.message ?? 'unknown error'}`)
        }
      })
      row.querySelector('.cpm-device-revoke')?.addEventListener('click', async event => {
        const name = row.querySelector('.cpm-device-name').value
        if (!window.confirm(`Revoke "${name}"? It will immediately lose access.`)) return
        event.currentTarget.disabled = true
        try {
          await api.revokeDevice(id)
          deps.toast('Device revoked')
          if (id === currentDeviceId) deps.onSelfRevoked()
          else await onRefresh()
        } catch (error) {
          event.currentTarget.disabled = false
          deps.toast(`Could not revoke device: ${error?.message ?? 'unknown error'}`)
        }
      })
    })
  }

  return { refresh, render, wire }
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
