# Deployment

This document describes how to deploy the gateway in production.

## Health and readiness probes

- `GET /health` — liveness. Returns `200` while the process is running.
- `GET /ready` — readiness. Pings the database and checks Horizon reachability.

### Do not proxy probes publicly

`/ready` and `/health` are intended for the orchestrator / load balancer only.
They are unauthenticated and are exempt from the API rate limiter, so they must
not be reachable from the public internet.

- Point probes at the container directly (e.g. `http://<container-ip>:8080/ready`)
or at an internal-only listener, not through the public reverse proxy.
- If you front the gateway with Caddy (see `deploy/Caddyfile`), restrict
`/ready` and `/health` to internal sources (private CIDRs / the orchestrator's
address) and do not expose them on the public site block.

Exposing `/ready` publicly lets anonymous callers drive outbound Horizon
requests and can get the gateway's egress IP rate-limited by Horizon, which
degrades payment detection.

## Environment

See `.env.example` for the full list of configuration variables, including
`STELLAR_HORIZON_URL`, `DATABASE_URL`, and the API bind address.

`PORT` and `BIND_ADDR` set where the API listens. The default `BIND_ADDR` of
`0.0.0.0` listens on all IPv4 interfaces. When a reverse proxy on the same host
is the only client, set `BIND_ADDR=127.0.0.1` so the API is unreachable from
other hosts. Use `BIND_ADDR=::` to listen on IPv6.

Settings in a `.env` file are read at startup, including `RUST_LOG` and `PORT`
(used by `stellargate healthcheck`). Variables already set in the process
environment take precedence over `.env`.
