---
title: Upgrading
description: Update BrowserThing images and preserve your deployment configuration and data.
---

Update the server and workers together. Back up the database and plan for active
sessions to end when the containers restart.

## Choose a release

| Component | Image for v0.7.0 |
| --- | --- |
| Server | `ghcr.io/mbroton/browserthing/server:0.7.0` |
| Worker | `ghcr.io/mbroton/browserthing/worker:0.7.0` |

Read the [release notes](https://github.com/mbroton/browserthing/releases) before
you change the image tags. Pin both images to the same BrowserThing release.

## Preserve the Compose project and database

Keep your existing `.env` file and Compose project name. If you change the
deployment directory name, find the current project name first:

```sh
docker compose ls
```

Set that same name in `.env` before you start the deployment in the new directory:

```dotenv
COMPOSE_PROJECT_NAME=your_existing_project_name
```

This keeps Compose connected to the existing PostgreSQL volume. Back up the
database before an upgrade. Do not use `docker compose down -v` to upgrade;
it removes the volumes.

## Pull and restart

Update both image references in your existing Compose file. Plan for active
sessions to end when the server or workers restart.

```sh
docker compose pull server worker
docker compose up -d
docker compose ps
```

The server applies database migrations when it starts. Check server and worker
logs, then run a client connection using a compatible Playwright version.

## Check client compatibility

The client and worker need matching Playwright major and minor versions.
The v0.7.0 worker uses **1.64.1**. Update client dependencies when a new worker
image changes that version.

## Upgrade from v0.6.1 to v0.7.0

v0.7.0 changes the worker from Playwright 1.63.0 to 1.64.1. The server
configuration, the API, and the database schema do not change. After the
upgrade, update every client to Playwright 1.64:

```sh
npm install playwright@1.64.1
python -m pip install playwright==1.64.0
```

Read the
[Playwright 1.64 release notes](https://github.com/microsoft/playwright/releases/tag/v1.64.0)
for behavior changes that can affect your browser code.

A 1.63 client cannot use a 1.64 worker. It waits in the server queue for
`QUEUE_WAIT_TIMEOUT` (default 30 seconds). Then it gets `503` with the message
`session queue wait timed out`.

### Move clients gradually

If you cannot update all clients at the same time, keep a v0.6.1 worker next to
the v0.7.0 workers. Use this mixed setup only during the migration. The server
sends each client to a worker with the same Playwright major and minor version:

```text
1.63 client --+                  +--> worker 0.6.1 (Playwright 1.63.0)
              +--> server 0.7.0 -+
1.64 client --+                  +--> worker 0.7.0 (Playwright 1.64.1)
```

1. In your Compose file, copy the `worker` service to a new service named
   `worker-previous`. Keep the `0.6.1` image on the copy. Change the `server`
   and `worker` images to `0.7.0`:

   ```yaml
   services:
     server:
       image: ghcr.io/mbroton/browserthing/server:0.7.0
       # ...
     worker:
       image: ghcr.io/mbroton/browserthing/worker:0.7.0
       # ...
     worker-previous:
       image: ghcr.io/mbroton/browserthing/worker:0.6.1
       # Copy all other settings from the worker service.
   ```

2. Pull and restart as shown above.
3. Update clients to Playwright 1.64.
4. When no client uses Playwright 1.63, stop the old worker. It finishes open
   sessions first, for up to `DRAIN_TIMEOUT`:

   ```sh
   docker compose stop worker-previous
   ```

5. Remove `worker-previous` from the Compose file, then remove its container:

   ```sh
   docker compose up -d --remove-orphans
   ```

Each worker serves only clients of its own Playwright version. A 1.63 client
cannot use a free slot on a 1.64 worker. `/v1/capacity` adds the slots of all
versions together, so use `/v1/workers` to see the version of each worker.
Give each version enough slots for its clients.
