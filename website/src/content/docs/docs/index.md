---
title: Overview
description: Use browsers from your application code while BrowserThing runs and manages them on separate workers.
---

**Use Playwright in your app. Run browsers elsewhere.**

BrowserThing is a self-hosted browser service for Playwright. Use browsers from
your application code while BrowserThing runs and manages them on separate workers.
Your application controls the browser actions and uses the results through Playwright.
BrowserThing keeps browsers running between tasks and handles session cleanup
and browser recycling.

You deploy and update the server, PostgreSQL, and browser workers. Run workers
on separate machines to keep browser CPU and memory use off your application
servers. Add workers when you need more browser capacity.

These guides describe **BrowserThing v0.6.0**, with **Playwright 1.63.0** workers.

```text
Your application: Playwright code
        |
        v
BrowserThing server ---- PostgreSQL
        |
        +---- Chromium workers
        +---- Firefox workers
        +---- WebKit workers
```

## Connect your application

Follow the [quick start](/browserthing/docs/quick-start/) to run the service locally
with Docker Compose and connect your Playwright code. It uses a screenshot as an
example browser task. Then see the [connection examples](/browserthing/docs/connect/)
for Node.js, Python, and other browser types.

Keep the steps of each browser task in your application. Several applications
can share one internal browser endpoint, with browser capacity managed in one place.

## Compare performance

See [benchmark results](/browserthing/docs/benchmarks/) for task time and CPU use
in a comparison with Browserless on the same hardware.

## Run your browser service

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

## Read docs as Markdown

Use **Copy Markdown** or **View Markdown** on any docs page. The
[docs index](/browserthing/llms.txt) links to the
[complete documentation](/browserthing/llms-full.txt) as text. These files update
with the site.

The project uses the [Apache-2.0 license](https://github.com/mbroton/browserthing/blob/main/LICENSE).
Report problems or suggest changes in [GitHub issues](https://github.com/mbroton/browserthing/issues).
