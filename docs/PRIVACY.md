# OpenCode Pilot privacy

OpenCode Pilot has **no telemetry by default**. Agent state stays on the user's machine unless the user explicitly enables a tunnel or notification provider.

## Where data goes

| Feature | Recipient | Data exposed |
|---|---|---|
| Local dashboard | Local Pilot server and browser | Sessions, prompts, outputs, permissions, files requested by the UI |
| LAN access | Devices and network path selected by the user | The same authenticated HTTP/SSE traffic |
| cloudflared/ngrok tunnel | Tunnel operator and connected device | Connection metadata and traffic handled by the tunnel; current mode is not application-level E2EE |
| Telegram | Telegram Bot API | Bot credential plus the notification/permission content Pilot sends |
| Web Push | Browser push service | Subscription endpoint, delivery metadata, and an encrypted payload containing a permission/session title plus local identifiers needed to open the dashboard |
| Hosted PWA | Static hosting provider | Requests for static dashboard assets; agent API traffic goes to the Pilot URL selected in the browser |
| npm/GitHub | Registry/repository during install/update | Normal package download and repository metadata; no runtime agent telemetry |

Source code, complete prompts, complete outputs, filesystem contents, agent credentials, and terminal history are not uploaded to infrastructure operated by this project.

## Data stored locally

Pilot may store server state and authentication material, dashboard/banner connection information, validated settings, versioned Web Push subscriptions, redacted project audit logs, browser UI/connection/authentication state, and service-worker caches containing static dashboard assets.

Credential-bearing server files use atomic owner-only writes on POSIX. Windows uses platform-native access controls; Pilot does not claim Unix-mode-equivalent ACL enforcement there.

## Logs and diagnostics

- Prompt content is excluded from `prompt.sent` audit records.
- Known credential fields, bearer values, and opaque URL paths/queries are recursively redacted at logger and audit boundaries.
- Values are depth-, size-, and cycle-bounded before serialization.
- Request IDs correlate browser errors with local logs without exposing stack traces.
- Pilot does not currently upload logs or create a remote support bundle automatically.

Redaction is defense in depth, not permission to log sensitive content. Record identifiers, counts, result categories, and timing—not prompts, source, tool arguments, tokens, or full endpoints.

## Retention and deletion

All Pilot-controlled state is local. Users control retention through local files, browser storage, provider configuration, and the CLI uninstall flow. Removing Pilot does not automatically delete unrelated OpenCode/Codex history or provider-side Telegram/push records.

Before adding telemetry, hosted persistence, a relay, analytics, crash reporting, or a provider, maintainers must document the exact fields, recipient, purpose, retention, disable path, and threat-model impact. It must remain opt-in unless a release explicitly documents otherwise.
