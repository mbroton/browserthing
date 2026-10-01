---
title: Upgrading
description: Update BrowserThing images and preserve your deployment configuration and data.
---

Update the server and workers together. Back up the database and plan for active
sessions to end when the containers restart.

## Choose a release

| Component | Image for v0.6.0 |
| --- | --- |
| Server | `ghcr.io/mbroton/browserthing/server:0.6.0` |
| Worker | `ghcr.io/mbroton/browserthing/worker:0.6.0` |

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
The v0.6.0 worker uses **1.63.0**. Update client dependencies when a new worker
image changes that version.
