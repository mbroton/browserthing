---
title: Compare with your own setup
description: What a shared browser service must handle, and what you build yourself with a browser pool or Playwright browser servers.
---

You can run Playwright browsers without BrowserThing. Teams usually start with
one of two setups:

- **A browser pool in your application.** Your application starts a few
  browsers with `chromium.launch()` and reuses them for its tasks.
- **Playwright browser servers.** Containers run Playwright's
  [`launchServer()`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server)
  behind a load balancer. Applications connect with `browserType.connect()`.

Playwright also has `npx playwright run-server`. It starts a new browser for
each connection, so it does not reuse browsers. This page compares with
`launchServer()`, which does.

Both setups work. The difference is the work around the browsers. BrowserThing
workers also use `launchServer()`. BrowserThing adds the parts that this page
describes.

## What a browser service must handle

**Reuse browsers.** A browser takes time and CPU to start. If each task starts
a new browser, every task pays this cost. See
[why browser reuse helps](/browserthing/docs/benchmarks/#why-browser-reuse-helps).

**Replace browsers from time to time.** A browser that runs for a long time can
use more memory or stop working correctly. A new browser process starts clean.
To replace a browser safely, stop new tasks on it, let the current tasks finish,
and then start a new browser.

**Limit the sessions on each browser.** Each session uses CPU and memory. Too
many sessions on one browser make all of them slow or make the browser crash.

**Let requests wait for capacity.** When all browsers are busy, a request can
wait a short time for a free session. Without a queue, a request that finds no
free capacity fails at once.

**Match Playwright versions.** A Playwright client can connect only to a
browser server with the same major and minor version, for example 1.64. When
you update Playwright, applications on the old version and the new version must
each reach a matching browser.

**Handle failures.** A browser or a host can stop. New tasks must go to healthy
browsers. If a client disappears, its session must free its place for other
requests.

**Shut down without lost work.** During a deploy, a browser host must finish its
current tasks before it stops.

**Control access and see usage.** A shared service needs authentication, a view
of sessions and free capacity, and a way to end a session.

## Comparison

| | Pool in your application | Playwright browser servers | BrowserThing |
| --- | --- | --- | --- |
| Reuse browsers | Yes | Yes | Yes |
| Replace browsers | You build it | You build it | Built in |
| Limit sessions | Your pool library | Your load balancer | Built in |
| Wait for capacity | Your pool library | Your load balancer, if it has a queue | Built in |
| Match versions | Not needed | A pool and a route for each version | Routes each client to a worker with the same version |
| Handle failures | You build it | Health checks and restarts | Routes around failed workers; a restart policy restarts them |
| Shut down | You build it | Drain in your load balancer and wait in your server code | Waits for sessions, up to a timeout |
| Access control | Not needed | You build it | API keys |
| Sessions and capacity | You build it | You build it | [REST API](/browserthing/docs/api/) |
| Browser types | All | One for each server | Chromium, Firefox, and WebKit |
| Share with other applications | No | Yes | Yes |

In BrowserThing, `MAX_LIFETIME_SESSIONS` sets after how many sessions a worker
replaces its browser. `MAX_SLOTS` limits the sessions on each worker.
`MAX_QUEUE_SIZE` and `QUEUE_WAIT_TIMEOUT` control the queue, and
`DRAIN_TIMEOUT` limits the wait during shutdown. See the
[configuration reference](/browserthing/docs/configuration/).

## Trade-offs

- You deploy and update the BrowserThing server, PostgreSQL, and workers.
- Browser commands go over the network, through the server, to the worker. A
  pool in your application has no network hop.
- A server outage ends the connections on that server.
- Sessions on a worker share one browser process, as with `launchServer()`.
  Browser contexts separate cookies and storage, but a browser crash ends all
  sessions on that worker. The worker then exits. A restart policy, such as the
  one in the supplied Compose file, must start it again.
- Browser launch flags apply to the whole worker. Set options for each session,
  such as proxy and viewport, through browser contexts.
- BrowserThing is for your own applications and trusted clients. See the
  [security boundary](/browserthing/docs/security/).

## When your own setup is enough

- **Few tasks.** If the browser start time is acceptable, start a new browser
  for each task, or use `run-server`.
- **One application.** A pool in your application is enough when only that
  application uses browsers and its hosts have CPU and memory for them.
- **Test runs.** Playwright's
  [Docker guide](https://playwright.dev/docs/docker#remote-connection) uses
  `run-server` for remote test runs.

BrowserThing fits when several applications share browsers, when clients use
different Playwright versions, or when you do not want to build the items in
the comparison yourself.
