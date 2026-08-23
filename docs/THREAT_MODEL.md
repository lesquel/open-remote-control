# OpenCode Pilot threat model

OpenCode Pilot is a local-first control plane. The user's machine is the authority; tunnels and notification providers are optional transports, not trusted stores of agent state.

## Security goals

1. An unauthenticated network client cannot read sessions or control an agent.
2. A malicious website cannot use DNS rebinding or cross-origin requests to reach Pilot on localhost.
3. File and remote-attachment access cannot escape the selected project or reach non-public network targets.
4. Local credentials and subscriptions survive crashes without becoming broadly readable.
5. Reconnects do not silently duplicate privileged actions or mix session state.
6. Logs retain operational metadata, not prompts, credentials, or opaque endpoint secrets.

## Assets and trust boundaries

| Asset | Authority | Boundary crossed |
|---|---|---|
| Source files, prompts, transcripts, tool output | Local filesystem and agent SDK | Local process ↔ browser over HTTP/SSE |
| Main and Codex hook tokens | Local Pilot process/state | Browser or local hook ↔ Pilot |
| Permission decisions | Local permission queues | Authenticated browser/Telegram ↔ agent hook |
| VAPID, Telegram, and push-subscription secrets | Local private files/environment | Pilot ↔ selected notification provider |
| Tunnel traffic | Local Pilot | Device ↔ tunnel operator ↔ Pilot |

The browser, OpenCode/Codex process, optional tunnel, Telegram, push service, LAN, and local filesystem are separate trust zones. Authentication does not make browser extensions or local malware trustworthy.

## Threat actors

- Internet or LAN attacker
- Malicious website, browser extension, or stolen paired device
- Local unprivileged user or compromised local process
- Attacker with a leaked token, URL, log, QR image, or tunnel address
- Compromised tunnel/relay or notification provider
- Request replay, retry, double-tap, and slow-client behavior without malicious intent

## Current controls

| Threat | Current mitigation |
|---|---|
| Token guessing | 256-bit random tokens, timing-safe comparison, per-client and global failed-auth limits |
| DNS rebinding/cross-site access | Host and Origin validation, explicit CORS, CSP, frame denial, `nosniff`, no-referrer policy |
| Oversized or abusive mutations | Streaming 1 MiB body cap and per-route/client plus global mutation limits |
| Project file escape | Canonical realpath containment; traversal, symlink chains, directories, and special files rejected |
| Attachment SSRF | HTTPS-only DNS resolution, public-address validation, IP pinning, redirect revalidation, deadline and byte cap |
| Permission races | Exactly-once queue settlement and immutable in-flight dashboard permission IDs |
| Reconnect gaps | Versioned generation/sequence IDs, bounded replay, deduplication, and canonical snapshot fallback |
| Local secret leakage | Atomic owner-only files on POSIX and centralized bounded log/audit redaction |
| Slow SSE clients | Fixed stream high-water mark and deterministic listener/timer cleanup |

## Accepted risks and limitations

- **One bearer token grants broad control.** Device identity, individual revocation, and capabilities are not implemented yet. Treat every authenticated browser as an operator.
- **Tokens appear in selected URLs.** EventSource and image requests cannot set bearer headers. URLs can leak through screenshots, history, extensions, and copied QR codes; no-referrer policy reduces but does not remove this risk.
- **Tunnel operators terminate public TLS.** cloudflared/ngrok-style tunnels can observe application traffic at their edge. Current tunnel mode is not end-to-end encrypted above the tunnel.
- **Local compromise wins.** Malware running as the user can read process memory, browser storage, files, and agent APIs. POSIX modes do not defend against the owning account or provide Windows ACL guarantees.
- **Browser extensions can act as the user.** Pilot cannot isolate itself from an extension with permission to inspect or modify the dashboard origin.
- **Telegram receives Telegram notification content.** Do not enable it for sensitive permission details unless that provider is acceptable.
- **Availability is best effort.** An attacker or compromised relay can still drop, delay, or exhaust network access.

## Required design for a future blind relay

A future relay must be optional and must not become an authority. Before implementation it requires a reviewed protocol using established primitives for explicit short-lived pairing, per-device public-key identity, granular capabilities, authenticated end-to-end encryption, replay-resistant counters/nonces, expiry, and individual revocation.

Relay-compromise tests must prove it cannot read, modify, replay, or impersonate commands. LAN, direct tunnel, and self-hosted operation must continue when the relay disappears. Do not market transport TLS or an incomplete key exchange as end-to-end encryption.

## Security verification checklist

- Run `bun scripts/prepublish-guard.ts && tsc --noEmit && bun test`.
- Test hostile Host/Origin, traversal/symlinks, SSRF redirects/DNS, oversized bodies, stale permissions, replay overflow, and slow SSE clients.
- Inspect `docs/PRIVACY.md` before adding any network integration or persisted field.
- Report vulnerabilities privately using [`SECURITY.md`](../SECURITY.md), not a public issue.
