---
title: Upgrading
description: Update BrowserThing images and preserve your deployment configuration and data.
---

Update the server and workers together. Back up the database and plan for active
sessions to end when the containers restart.

## Choose a release

| Component | Image for v{{release}} |
| --- | --- |
| Server | `ghcr.io/mbroton/browserthing/server:{{release}}` |
| Worker | `ghcr.io/mbroton/browserthing/worker:{{release}}` |

Read the [release notes](https://github.com/mbroton/browserthing/releases) of
each release after your current one before you change the image tags. They
describe the changes and any manual steps. Pin both images to the same
BrowserThing release.

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

## When the Playwright version changes

The client and worker need matching Playwright major and minor versions.
The v{{release}} worker uses **{{playwright}}**. The release notes say when a
release changes the worker's major or minor version. Then update every client
after the upgrade, and read the
[Playwright release notes](https://github.com/microsoft/playwright/releases)
for behavior changes that can affect your browser code.

A client with the previous version cannot use the new workers. It waits in the
server queue for `QUEUE_WAIT_TIMEOUT` (default 30 seconds). Then it gets `503`
with a message such as
`session queue wait timed out: no worker serves chromium with Playwright 1.63;
registered workers: chromium 1.64.1`.

### Move clients gradually

If you cannot update all clients at the same time, keep a worker of your current
release next to the new workers. Use this mixed setup only during the migration.
The server sends each client to a worker with the same Playwright major and
minor version:

```text
old client --+                +--> worker, current release (old Playwright)
             +--> new server -+
new client --+                +--> worker, new release (new Playwright)
```

1. In your Compose file, copy the `worker` service to a new service named
   `worker-previous`. Keep your current image tag on the copy. Change the
   `server` and `worker` images to the new release:

   ```yaml
   services:
     server:
       image: ghcr.io/mbroton/browserthing/server:{{release}}
       # ...
     worker:
       image: ghcr.io/mbroton/browserthing/worker:{{release}}
       # ...
     worker-previous:
       image: ghcr.io/mbroton/browserthing/worker:<current release>
       # Copy all other settings from the worker service.
   ```

2. Pull and restart as shown above.
3. Update clients to the new Playwright version.
4. When no client uses the old version, stop the old worker. It finishes open
   sessions first, for up to `DRAIN_TIMEOUT`:

   ```sh
   docker compose stop worker-previous
   ```

5. Remove `worker-previous` from the Compose file, then remove its container:

   ```sh
   docker compose up -d --remove-orphans
   ```

Each worker serves only clients of its own Playwright version. An old client
cannot use a free slot on a new worker. `/v1/capacity` adds the slots of all
versions together, so use `/v1/workers` to see the version of each worker.
Give each version enough slots for its clients.
