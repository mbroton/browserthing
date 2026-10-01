---
title: Scaling
description: Add browser workers and tune session capacity on one host or several hosts.
---

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
Clients -> Server + PostgreSQL (host A)
                  |
                  +-> Workers (host B)
                  +-> Workers (host C)
```

Configure [authentication and private networking](/browserthing/docs/deployment/) first. The
server must be able to reach each worker at its advertised hostname and port.

On a worker host, download the
[Chromium seccomp profile](https://raw.githubusercontent.com/mbroton/browserthing/v0.6.0/worker/seccomp_profile.json)
to `worker/seccomp_profile.json`. Put `WORKER_API_KEY` in `.env`. Then use a
worker-only Compose file like this:

```yaml
services:
  worker:
    image: ghcr.io/mbroton/browserthing/worker:0.6.0
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

## Tune slots

Start with the default of five slots. For tasks that keep the CPU busy, the
project's starting guideline is about two slots per available CPU. Tasks that
spend more time waiting for pages can use more slots, provided memory permits.

Increase capacity in steps. Measure latency, throughput, and memory with your
own workload. Adding more workers on a fully used host does not add CPU capacity.
The repository includes [benchmark scripts](https://github.com/mbroton/browserthing/tree/v0.6.0/scripts/bench).

## Watch the queue

`GET /v1/capacity` reports free slots by browser type and the server replica's
queue depth. A queue that stays above zero, or repeated 429 responses, indicates
that you should inspect capacity and worker health.

The default queue limit is 100 requests, with a 30-second wait timeout. These
limits apply per server replica. See the [configuration reference](/browserthing/docs/configuration/).
