# Dashboard Module — Server Handoff

## Entry Point

`src/server/dashboard/index.html`

This is the shell the browser loads. It includes all CDN scripts (marked, hljs) and then loads the ES module entry point:

```html
<script type="module" src="/dashboard/main.js"></script>
```

## File Structure

```
src/server/dashboard/
├── index.html      # Shell HTML — no logic, just DOM structure + asset refs
├── styles.css      # All CSS — dark/light theme, layout, components
├── main.js         # Entry point — bootstraps auth, modules, SSE
├── state.js        # App state + pub/sub (sessions, statuses, settings…)
├── api.js          # All fetch() calls — centralized HTTP layer
├── auth.js         # Token: URL param → sessionStorage → gate UI prompt
├── sse.js          # SSE connection, reconnect, event routing
├── markdown.js     # Marked + hljs init and renderMarkdown() helper
├── diff.js         # Diff text → HTML, loadDiff()
├── messages.js     # Message/part rendering, loadMessages()
├── sessions.js     # Sessions list, selectSession, createSession, send/abort
├── multi-view.js   # Split-screen grid — panels, MV state, add/remove
├── permissions.js  # Permission banner — load, show, allow/deny
├── settings.js     # Settings modal — load, save, apply, playBeep()
├── shortcuts.js    # Ctrl+K picker, Ctrl+N, Ctrl+Enter, Esc
└── toast.js        # toast(msg) helper
```

## Server Routing Requirements

The HTTP server must handle these routes:

| Route | Response |
|-------|----------|
| `GET /` | Serve `src/server/dashboard/index.html` |
| `GET /dashboard/styles.css` | Serve `src/server/dashboard/styles.css` |
| `GET /dashboard/main.js` | Serve `src/server/dashboard/main.js` |
| `GET /dashboard/*.js` | Serve matching file from `src/server/dashboard/` |
| All existing API routes | Unchanged (`/sessions`, `/events`, `/permissions`, etc.) |

The simplest approach: serve `src/server/dashboard/` as static files under `/dashboard/`, and map `GET /` to `index.html`.

## Existing API Endpoints (unchanged)

- `GET /sessions` — list sessions + statuses
- `POST /sessions` — create session
- `GET /sessions/:id/messages` — get messages
- `POST /sessions/:id/prompt` — send prompt
- `POST /sessions/:id/abort` — abort session
- `GET /sessions/:id/diff` — get diff
- `GET /permissions` — list pending permissions
- `POST /permissions/:id` — respond to permission (`{ action: "allow"|"deny" }`)
- `GET /events?token=…` — SSE stream

## Auth

Token flows: URL `?token=X` → sessionStorage `pilot_token` → gate UI prompt.
All API calls use `Authorization: Bearer <token>` header.
