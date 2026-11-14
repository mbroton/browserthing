---
title: Scaling
description: Add browser workers and tune session capacity on one host or several hosts.
---

Scale browser capacity separately from your application instances. Put workers
on separate hosts to move browser CPU and memory use off application servers.

Capacity comes from the number of workers and the slot limit on each worker.
For example, three workers with `MAX_SLOTS=5` provide 15 concurrent session
slots. Actual throughput depends on CPU, memory, and the pages you open.

## Add workers on one host

```sh
docker compose up -d --scale worker=3
```

The Compose file does not publish worker ports or assign fixed worker names.
This lets Compose create several workers. Each worker registers itself.

## Add workers on other hosts

```text
Apps -> Server + PostgreSQL (host A)
                  |
                  +-> Workers (host B)
                  +-> Workers (host C)
```

Configure [authentication and private networking](/browserthing/docs/deployment/) first. The
server must be able to reach each worker at its advertised hostname and port.

On a worker host, download the
[Chromium seccomp profile](https://raw.githubusercontent.com/mbroton/browserthing/v{{release}}/worker/seccomp_profile.json)
to `worker/seccomp_profile.json`. Put `WORKER_API_KEY` in `.env`. Then use a
worker-only Compose file like this:

```yaml
services:
  worker:
    image: ghcr.io/mbroton/browserthing/worker:{{release}}
    init: true
    security_opt:
      - seccomp=./worker/seccomp_profile.json
    shm_size: "1gb"
    stop_grace_period: 60s
    ports:
      - "3131:3131"
    environment:
      - SERVER_URL=http://host-a.internal:8080
      - WORKER_API_KEY=${WORKER_API_KEY}
      - PRIVATE_HOSTNAME=host-b.internal
      - PORT=3131
      - BROWSER_TYPE=chromium
      - MAX_SLOTS=5
      - DRAIN_TIMEOUT=30
    restart: unless-stopped
```

Replace both example hostnames with addresses on your private network. Restrict
port 3131 to the server. Registration alone does not prove that the server can
connect back to the worker.

For several workers on this host, use separate services with different `PORT`
values and matching port mappings. The fixed port mapping above cannot be
shared by scaled replicas.

## Worker pools

Give a workload its own workers with a pool. Use pools when your applications
need different worker settings, for example fewer slots and a longer
`DRAIN_TIMEOUT` for long sessions, other `BROWSER_ARGS`, or
`BLOCK_PRIVATE_NETWORKS` for user-supplied content only. One server and
database serve all pools.

Set `POOL=<name>` on the workers, and connect with `?pool=<name>` or send
`"pool":"<name>"` in `POST /v1/sessions`. Workers and clients that set no pool
use the pool named `default`, so a setup without pools works as before.

This Compose example keeps the default workers and adds a pool named `long`:

```yaml
services:
  worker:
    image: ghcr.io/mbroton/browserthing/worker:{{release}}
    init: true
    security_opt:
      - seccomp=./worker/seccomp_profile.json
    shm_size: "1gb"
    stop_grace_period: 60s
    environment:
      - SERVER_URL=http://server:8080
      - WORKER_API_KEY=${WORKER_API_KEY}
      - MAX_SLOTS=5
      - DRAIN_TIMEOUT=30
    restart: unless-stopped

  worker-long:
    image: ghcr.io/mbroton/browserthing/worker:{{release}}
    init: true
    security_opt:
      - seccomp=./worker/seccomp_profile.json
    shm_size: "1gb"
    stop_grace_period: 660s
    environment:
      - SERVER_URL=http://server:8080
      - WORKER_API_KEY=${WORKER_API_KEY}
      - POOL=long
      - MAX_SLOTS=2
      - DRAIN_TIMEOUT=600
    restart: unless-stopped
```

The app with long sessions connects to `ws://localhost:8080/?pool=long`. Other
apps connect as before. Scale each service on its own, for example
`docker compose up -d --scale worker-long=3`.

Know these rules:

- **Exact match, no fallback.** A session goes only to workers in its pool, and
  a session without a pool never goes to a worker in a named pool. If the pool
  has no free slot, the request waits in the queue, even when other pools have
  free slots.
- **A queue line for each pool.** A full pool does not delay requests for other
  pools. `MAX_QUEUE_SIZE` is one limit for all pools together on each server
  replica.
- **Routing, not access control.** Every API key can use every pool. Do not use
  pools to keep one client away from the workers of another.
- **One pool per worker.** To combine two properties, put both in the name,
  for example `long-eu`.

Pool names have 1 to 63 lowercase letters, digits, and hyphens, and start and
end with a letter or digit. Upgrade the server before you set `POOL` on
workers; see [upgrading](/browserthing/docs/upgrading/#worker-pools).

## Tune slots

Start with the default of five slots. For tasks that keep the CPU busy, the
project's starting guideline is about two slots per available CPU. Tasks that
spend more time waiting for pages can use more slots, provided memory permits.

Increase capacity in steps. Measure latency, throughput, and memory with your
own workload. Adding more workers on a fully used host does not add CPU capacity.
Each worker runs its own browser, which has a fixed CPU cost. Very small workers
therefore lose throughput, so do not split a CPU budget into many tiny workers.
The repository includes [benchmark scripts](https://github.com/mbroton/browserthing/tree/v{{release}}/scripts/bench).
See [benchmark results](/browserthing/docs/benchmarks/) for a comparison of
BrowserThing and Browserless on the same hardware.

## Watch the queue

`GET /v1/capacity` reports free slots by pool and browser type and the server
replica's queue depth. A queue that stays above zero, or repeated 429 responses, indicates
that you should inspect capacity and worker health.

Requests for the same pool, browser, and Playwright version get slots in
arrival order on each server replica.

The default queue limit is 100 requests, with a 30-second wait timeout. These
limits apply per server replica. See the [configuration reference](/browserthing/docs/configuration/).
