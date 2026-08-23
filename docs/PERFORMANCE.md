# Reproduce local performance checks

Performance work starts with a repeatable local measurement. The repository does not upload results or require a hosted load service.

## SSE baseline

Start Pilot, obtain the current local credential from the owner-private state file, and run:

```bash
PILOT_TOKEN='<local credential>' bun scripts/load-sse.ts --clients 10
PILOT_TOKEN='<local credential>' bun scripts/load-sse.ts --clients 50
PILOT_TOKEN='<local credential>' bun scripts/load-sse.ts --clients 100
PILOT_TOKEN='<local credential>' bun scripts/load-sse.ts --clients 500 --duration-ms 30000
```

Use `PILOT_URL` or `--url` for a non-default listener. The token is accepted only through `PILOT_TOKEN`, keeping it out of process arguments and the JSON result.

The report includes successful/failed clients, connection latency percentiles, the server's `/health` client count, and load-generator heap usage. It does **not** claim server CPU or memory measurements; capture those with platform tools beside the JSON report.

## Baseline record

Record the date, commit, Bun version, OS, hardware, listener mode, client count, duration, server CPU/RSS, and emitted JSON. Results from loopback, LAN, and tunnels are different baselines and must not be compared as if they were the same environment.

Load scripts are intentionally excluded from the per-commit CI path. Their parser and measurement behavior are unit-tested by `bun test`; maintainers run the real load scenarios before performance-sensitive releases.
