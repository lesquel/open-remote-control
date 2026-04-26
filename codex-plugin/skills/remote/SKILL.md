---
name: "remote"
description: "Manage and open the opencode-pilot remote control dashboard for Codex sessions. Use when the user wants to monitor sessions remotely, get permission notifications on their phone, or open a web dashboard for codex."
---

# Remote control via opencode-pilot

The user has opencode-pilot installed (an HTTP server on localhost:4097 that exposes a web dashboard, SSE event stream, and permission queue). This skill lets you help them connect codex to it.

## Workflow

1. **First, check status**: call `pilot.status` MCP tool. If `running: false`, instruct the user to start it (the tool's error message includes the exact command for their OS).

2. **If hooks not configured yet**: call `pilot.configure_hooks` (defaults to project-local `.codex/config.toml`). This returns a dry-run preview first — show it to the user, ask them to confirm. If they confirm, call again with `{ confirm: true }`.

3. **To open the dashboard**: call `pilot.open_dashboard`. Returns the URL the user should open in their browser. If they're on phone, the response includes a QR code (ASCII).

## When the user types `/remote`

Run `pilot.status` then `pilot.open_dashboard` and present the dashboard URL with a one-line summary of what they can do there.

## When opencode-pilot is NOT running

DO NOT try to start it yourself — codex plugins cannot launch background processes. Tell the user the exact command from the error response and wait for them to start it.
