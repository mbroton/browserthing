---
title: Deployment
description: Deploy an internal browser service for your applications with authentication, private networking, and persistent data.
---

Start with the [quick start](/browserthing/docs/quick-start/). For a deployment used by other
machines, configure the database password, API keys, and network access before
you expose the server.

You operate and update this service for your applications. To move browser CPU
and memory use off application servers, deploy workers on separate hosts. The
[scaling guide](/browserthing/docs/scaling/) shows the required network connections.

```text
Apps -> TLS proxy -> Server -> private browser workers
                          |
                          v
                     PostgreSQL

Workers -> Server: registration and heartbeats
```

## Database password and storage

Before the **first** start, put a strong `POSTGRES_PASSWORD` in a `.env` file next
to `docker-compose.yaml`. The Compose file passes it to PostgreSQL and the
server's database connection string.

PostgreSQL reads this password when it initializes an empty volume. Changing
`.env` later does not change the password in an existing database. Use normal
PostgreSQL password rotation procedures for an existing installation.

Keep the `postgres-data` volume and back it up. It contains sessions, workers,
and API keys. Use `docker compose down` to stop the deployment while retaining
the volume. The `-v` option deletes volumes and their data.

## Create an API key

With the server still bound to localhost, create the first key:

```sh
docker compose exec server server apikey create --name grid
```

Save the returned key. Creating it immediately enables authentication across
the service. Set the worker key in `.env`:

```dotenv
WORKER_API_KEY=pwd_replace_with_your_key
```

Recreate the workers so they receive the key:

```sh
docker compose up -d --force-recreate worker
```

Give clients a key before they connect. Workers also need keys for registration
and heartbeats. Do not commit `.env` or keys to Git.

:::caution[Equal access]
Every valid API key has full browser and control-plane access in v0.6.0. Keys do
not separate tenants or restrict access to individual sessions.
:::

## Network access

The server needs access to PostgreSQL and to every worker's advertised WebSocket
address. Workers need HTTP access to the server.

Expose only the server to clients. Keep PostgreSQL and worker ports on private
networks. Put the client endpoint behind a TLS reverse proxy or a suitable
private network. API keys do not encrypt `http://` or `ws://` traffic.

A reverse proxy must support WebSocket upgrades and timeouts that allow your
sessions to run. If the proxy runs on the same host, it can reach the default
`127.0.0.1:8080` mapping. A proxy in a separate container needs a shared Docker
network or another route to the server.

## Health and shutdown

- `GET /healthz` checks process health.
- `GET /readyz` checks database readiness.
- `GET /v1/capacity` reports browser slots and queue depth; it needs a key after authentication is enabled.

Keep the Compose stop grace period longer than the application's shutdown
window. The supplied file uses 60 seconds and sets worker `DRAIN_TIMEOUT=30`.
The worker's standalone default drain timeout is 300 seconds.

For workers on separate hosts, follow [scaling](/browserthing/docs/scaling/).
