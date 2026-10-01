---
title: Overview
description: A self-hosted browser pool for Playwright applications. Reuse running browsers for short tasks, with session cleanup and configurable browser recycling.
---

**Use Playwright in your app. Run browsers elsewhere.**

BrowserThing is a self-hosted browser pool for applications using Playwright.
It was built for workloads with many short browser tasks. Starting a new browser
for every task adds time and CPU use. Keeping the same browser running indefinitely
can let memory use grow or leave it in a bad state. BrowserThing reuses running
browsers and replaces them after a configurable number of sessions.

Your application runs normal Playwright code and connects through one WebSocket
endpoint. BrowserThing selects an available worker and cleans up each session
when its connection closes. Browser capacity can grow without changes to the
endpoint your applications use.

You deploy and update the server, PostgreSQL, and browser workers. Run workers
on separate machines to keep browser CPU and memory use off your application
servers. Add workers when you need more browser capacity.

The pool is built for your own applications and trusted clients. Browser contexts
separate cookies and storage, but sessions share a browser process on each worker.
See the [security boundary](/browserthing/docs/security/).

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
