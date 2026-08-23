function esc(value) {
  return String(value ?? 'Unknown')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function label(value) {
  if (value === true) return 'Enabled'
  if (value === false) return 'Disabled'
  if (value === null || value === undefined || value === '') return 'Unknown'
  return String(value)
}

function row(name, value) {
  return `<div class="diagnostics-row"><dt>${esc(name)}</dt><dd>${esc(label(value))}</dd></div>`
}

function section(title, rows) {
  return `<section class="diagnostics-card"><h3>${esc(title)}</h3><dl>${rows.join('')}</dl></section>`
}

export function renderDiagnostics(snapshot, client = {}) {
  const pilot = snapshot?.pilot ?? {}
  const listener = snapshot?.listener ?? {}
  const tunnel = listener.tunnel ?? {}
  const auth = snapshot?.authentication ?? {}
  const runtime = snapshot?.runtime ?? {}
  const sessions = runtime.sessions ?? {}
  const notifications = runtime.notifications ?? {}
  const errors = Array.isArray(snapshot?.recentErrors) ? snapshot.recentErrors : []
  const integrations = Array.isArray(runtime.integrations) ? runtime.integrations.join(', ') : 'Unknown'
  const descriptors = Array.isArray(client.integrations) ? client.integrations : []

  const cards = [
    section('Pilot', [
      row('Version', pilot.version),
      row('Runtime', `${label(pilot.runtime?.name)} ${label(pilot.runtime?.version)}`),
      row('Uptime', Number.isFinite(pilot.uptimeSeconds) ? `${pilot.uptimeSeconds}s` : null),
    ]),
    section('Connection', [
      row('Dashboard', client.connected ? 'Connected' : 'Disconnected'),
      row('Listener', listener.host && listener.port ? `${listener.host}:${listener.port}` : null),
      row('Tunnel', `${label(tunnel.provider)} · ${label(tunnel.status)}`),
      row('SSE clients', runtime.sseClients),
    ]),
    section('Authentication', [
      row('Principal', auth.kind),
      row('Role', auth.role),
      row('Device ID', auth.deviceId),
    ]),
    section('Workload', [
      row('SDK', runtime.sdk?.status),
      row('Sessions', sessions.total),
      row('Active sessions', sessions.active),
      row('Pending permissions', runtime.pendingPermissions),
      row('Integrations', integrations),
    ]),
    section('Notifications & devices', [
      row('Telegram', notifications.telegram),
      row('Web push', notifications.push),
      row('Push subscriptions', notifications.pushSubscriptions),
      row('Paired devices', runtime.devices?.total),
    ]),
  ]

  const errorHtml = errors.length === 0
    ? '<p class="diagnostics-empty">No recent errors.</p>'
    : `<ol class="diagnostics-errors">${errors.map((error) => {
        const item = error && typeof error === 'object' ? error : { message: error }
        return `<li><strong>${esc(item.component ?? 'pilot')}</strong><span>${esc(item.message ?? 'Unknown error')}</span></li>`
      }).join('')}</ol>`

  const integrationHtml = descriptors.length === 0
    ? '<p class="diagnostics-empty">Capability metadata unavailable.</p>'
    : `<div class="diagnostics-integrations">${descriptors.map((descriptor) => {
        const capabilities = descriptor && typeof descriptor.capabilities === 'object'
          ? Object.entries(descriptor.capabilities).filter(([, supported]) => supported === true).map(([name]) => name)
          : []
        return `<article><strong>${esc(descriptor?.displayName ?? descriptor?.id)}</strong><span>${esc(capabilities.length ? capabilities.join(', ') : 'Monitoring only')}</span></article>`
      }).join('')}</div>`

  return `<div class="diagnostics-grid">${cards.join('')}</div><section class="diagnostics-card diagnostics-card--wide"><h3>Agent capabilities</h3>${integrationHtml}</section><section class="diagnostics-card diagnostics-card--wide"><h3>Recent errors</h3>${errorHtml}</section>`
}

export function diagnosticsCopyPayload(snapshot, client = {}) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    dashboard: {
      connected: Boolean(client.connected),
      integrations: Array.isArray(client.integrations) ? client.integrations : [],
    },
    diagnostics: snapshot,
  }, null, 2)
}
