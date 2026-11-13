---
title: Configuration
description: Server and worker environment variables for BrowserThing.
---

Configure the server and workers with environment variables. These are the
application defaults. A Compose file can override them.

## Server

Server duration values use Go duration notation, such as `10s` or `5m`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string. |
| `LISTEN_ADDR` | `:8080` | HTTP and WebSocket listen address. |
| `AUTH_DISABLED` | `false` | `true` turns off API-key checks, so every client that can reach the server has full access. Use it only for local development. |
| `DEFAULT_BROWSER_TYPE` | `chromium` | Browser selected when a connection omits `?browser=`. |
| `MAX_QUEUE_SIZE` | `100` | Maximum waiting requests per server replica. `0` disables queueing. |
| `QUEUE_WAIT_TIMEOUT` | `30s` | Maximum wait for a worker slot. |
| `MAX_LIFETIME_SESSIONS` | `50` | Session claims before a worker recycles its browser. `0` disables recycling. |
| `WORKER_HEARTBEAT_TTL` | `30s` | Time before an available worker with no heartbeat becomes stalled. |
| `SESSION_HEARTBEAT_TTL` | `30s` | Time before a pending or running session with no heartbeat expires. |
| `SESSION_HEARTBEAT_INTERVAL` | `10s` | How often a live relay renews its session. |
| `PENDING_SESSION_TTL` | `30s` | Maximum time a claimed session can remain pending. |
| `STALLED_WORKER_TTL` | `10m` | Time before an idle stalled worker record is removed. |
| `RESCUER_INTERVAL` | `5s` | Base interval between recovery sweeps, with 20% jitter. |
| `WORKER_DIAL_TIMEOUT` | `10s` | Total time limit for the server's WebSocket dial to a worker, including retries after a network failure. |
| `RELAY_WRITE_TIMEOUT` | `30s` | Time limit for each relay write. |
| `RELAY_PING_INTERVAL` | `20s` | Interval between relay WebSocket pings. |
| `RELAY_PONG_TIMEOUT` | `60s` | Maximum time without data or a pong from a peer. |
| `SHUTDOWN_GRACE_PERIOD` | `20s` | Time allowed for active relays to finish after shutdown begins. |
| `MAX_SESSION_DURATION` | `0` | Maximum time a client can stay connected to a session. `0` disables the limit. |

`SESSION_HEARTBEAT_INTERVAL` must be less than `SESSION_HEARTBEAT_TTL`.
`RELAY_PING_INTERVAL` must be less than `RELAY_PONG_TIMEOUT`.
`WORKER_DIAL_TIMEOUT` must be less than the 15-second session reconciliation
grace period. The server rejects an invalid timeout configuration.

Set `MAX_SESSION_DURATION` to free slots that clients hold open without a
`browser.close()`. The limit starts when the client connects. When it expires,
the server closes the client and worker connections with WebSocket code `1008`
and the reason `session exceeded MAX_SESSION_DURATION (<value>)`, for example
`(1h0m0s)`. The session becomes `completed`, and its slot is free again. Each
server replica applies its own setting to the connections it relays, so give
all replicas the same value.

Budget `pool_max_conns + 1` PostgreSQL connections per server replica. The extra
connection listens for capacity notifications. Each replica has its own
admission queue. Notifications and a one-second polling fallback wake waiting
requests when capacity changes.

The `serve` command applies migrations before it starts the HTTP server.
API-key commands connect to the database but do not apply migrations.

## Worker

Worker time values are integer **seconds**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_URL` | Required | Server HTTP or HTTPS URL. |
| `WORKER_API_KEY` | Unset | Bearer key for server requests. Required unless the server sets `AUTH_DISABLED=true`. |
| `BROWSER_TYPE` | `chromium` | One of `chromium`, `firefox`, or `webkit`. |
| `PORT` | `3131` | Port for browser relay connections. |
| `PRIVATE_HOSTNAME` | Machine hostname | Address advertised to the server. It must be reachable from the server. |
| `MAX_SLOTS` | `5` | Concurrent sessions per worker, from 1 to 1024. |
| `HEADLESS` | `true` | Run the browser without a visible window. |
| `BROWSER_ARGS` | Unset | Extra browser command-line flags, as a JSON array of strings. |
| `BLOCK_PRIVATE_NETWORKS` | `false` | Chromium only. Stop browser traffic to private, loopback, link-local, and reserved addresses. See [security](/browserthing/docs/security/#block-private-networks). |
| `HEARTBEAT_INTERVAL` | `5` | Interval between worker heartbeats. |
| `DRAIN_TIMEOUT` | `300` | Maximum wait for open sessions on the old browser after a recycle, or during shutdown. Remaining sessions close when it expires. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, or `error`. |
| `LOG_FORMAT` | `json` | One of `json` or `text`. |

The supplied Compose file sets `DRAIN_TIMEOUT=30` and a 60-second container
stop grace period. If you increase the drain timeout, keep the stop grace
period above `DRAIN_TIMEOUT + 20` seconds for cleanup.

Clients can not send browser command-line flags, because the worker launches
the browser before sessions connect. To apply flags to all sessions on a
worker, set `BROWSER_ARGS`:

```sh
BROWSER_ARGS='["--disable-blink-features=AutomationControlled"]'
```

The worker passes the flags to each browser that it launches, also after a
recycle. Each browser type accepts different flags, and an unknown flag can be
ignored without an error. Invalid JSON, or an item that is not a string, stops
the worker at start.

The worker refuses flags that turn off the Chromium sandbox: `--no-sandbox`,
`--disable-setuid-sandbox`, `--disable-namespace-sandbox`,
`--disable-seccomp-filter-sandbox`, and `--disable-gpu-sandbox`. This check
catches mistakes. It is not a security boundary: other flags can also make the
browser less safe, so set only flags that you trust.

With `BLOCK_PRIVATE_NETWORKS=true`, the worker also refuses flags that change
the proxy or the WebRTC policy: `--proxy-server`, `--proxy-pac-url`,
`--proxy-bypass-list`, `--proxy-auto-detect`, `--no-proxy-server`, and
`--force-webrtc-ip-handling-policy`.

Set session options such as proxy, locale, viewport, and cookies through
Playwright browser contexts.

See [scaling](/browserthing/docs/scaling/) for slot tuning and remote worker examples.
