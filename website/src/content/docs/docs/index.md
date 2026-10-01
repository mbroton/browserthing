---
title: Overview
description: Run a Playwright browser grid on your own infrastructure.
---

BrowserThing connects Playwright clients to browsers that are already running.
You host the server, PostgreSQL, and browser workers. Clients use one WebSocket
endpoint. Add workers when you need more capacity.

These guides describe **BrowserThing v0.6.0**, with **Playwright 1.63.0** workers.

```text
Your Playwright code
        |
        v
BrowserThing server ---- PostgreSQL
        |
        +---- Chromium workers
        +---- Firefox workers
        +---- WebKit workers
```

## Start your first grid

Follow the [quick start](/browserthing/docs/quick-start/) to run a local grid with Docker Compose
and open your first page. Then see the [connection examples](/browserthing/docs/connect/) for
Node.js, Python, and other browser types.

## Run the grid

- [Architecture](/browserthing/docs/architecture/) explains sessions, worker selection, and recycling.
- [Deployment](/browserthing/docs/deployment/) covers API keys, networking, and persistent data.
- [Scaling](/browserthing/docs/scaling/) covers workers on one host or several hosts.
- [Security](/browserthing/docs/security/) explains the trust and isolation boundaries.

## Find a setting or endpoint

Use the [configuration reference](/browserthing/docs/configuration/) and [API guide](/browserthing/docs/api/).
For a failed connection, start with [troubleshooting](/browserthing/docs/troubleshooting/).

## Upgrade an existing installation

Follow the [upgrade guide](/browserthing/docs/upgrading/) to update the server and worker images
and preserve your database volume.

## Use with AI tools

Use **Copy Markdown** or **View Markdown** on any docs page. The
[docs index](/browserthing/llms.txt) links to the
[complete documentation](/browserthing/llms-full.txt) as text. These files update
with the site.

The project uses the [Apache-2.0 license](https://github.com/mbroton/browserthing/blob/main/LICENSE).
Report problems or suggest changes in [GitHub issues](https://github.com/mbroton/browserthing/issues).
