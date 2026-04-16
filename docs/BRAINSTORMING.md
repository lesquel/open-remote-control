# OpenCode Pilot — Brainstorming

## Problema

OpenCode corre en una terminal, y no siempre estás frente a esa terminal. El remote control resuelve:

- **Sesiones largas**: Delegás trabajo y te vas. Querés saber si terminó, se trabó, o falló.
- **Permisos pendientes**: OpenCode pide permiso y vos no estás. La sesión se traba.
- **Multi-máquina**: OpenCode en el server del laburo, vos en tu casa.
- **Monitoreo**: Dashboard para ver estado de múltiples sesiones.

## Arquitectura (MVP)

HTTP server embebido con `Bun.serve`, proxy autenticado sobre el SDK existente.

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /status | Estado general |
| GET | /sessions | Lista de sesiones |
| GET | /sessions/:id | Detalle de sesión |
| GET | /sessions/:id/messages | Mensajes |
| GET | /sessions/:id/diff | Diffs |
| POST | /sessions/:id/prompt | Enviar prompt |
| POST | /sessions/:id/abort | Abortar sesión |
| POST | /sessions | Crear sesión |
| GET | /permissions | Permisos pendientes |
| POST | /permissions/:id | Aprobar/denegar |
| GET | /events | SSE stream |
| GET | /tools | Tools disponibles |
| GET | /project | Info del proyecto |

### Seguridad

- Token criptográfico generado al arrancar (32 bytes hex)
- Bind a localhost por default
- Audit log de toda operación
- CORS headers
- Timeout configurable para permisos (default 5min)

## Fases

### Fase 1 (actual): HTTP + SSE + REST
### Fase 2: Web dashboard + Telegram bot + QR pairing
### Fase 3: Tunnel automático + E2E encryption
### Fase 4: Mobile app + Watch + GitHub Actions + Team mode

## Config (env vars)

- `PILOT_PORT` — Puerto (default: 4097)
- `PILOT_HOST` — Host (default: 127.0.0.1)
- `PILOT_PERMISSION_TIMEOUT` — Timeout permisos en ms (default: 300000)
