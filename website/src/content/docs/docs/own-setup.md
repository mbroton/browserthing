---
title: Compare with your own setup
description: Compare BrowserThing with a browser pool in your application or Playwright browser servers behind a load balancer.
---

Playwright can run browsers for remote clients without BrowserThing. This page
compares BrowserThing with two setups that you can build from Playwright alone:

1. A browser pool in your application process.
2. Playwright browser servers in containers behind a load balancer.

Each BrowserThing worker runs one browser with Playwright's
`browserType.launchServer()`. BrowserThing adds the routing, capacity, and
recovery around these browsers.

## A browser pool in your application

Your application launches browsers with `chromium.launch()` and keeps them in a
pool, for example with a general-purpose pool library. Each task takes a browser,
creates a context, and returns the browser to the pool.

This gives you:

- Browser reuse between tasks in the same process.
- No additional service and no network hop between Playwright and the browser.
- Launch options that you can set for each browser.

You build and run:

- A limit on concurrent tasks and a queue for tasks that wait.
- Replacement of a browser after a number of tasks. Playwright emits the
  [`disconnected` event](https://playwright.dev/docs/api/class-browser#browser-event-disconnected)
  when a browser closes or crashes; your pool must remove that browser.
- Context cleanup when a task fails.
- A shutdown that lets tasks finish before the process stops.
- One pool for each application. Applications in different languages need
  separate pool code.

The browsers use CPU and memory on your application hosts. To add browser
capacity, you add application capacity.

## Browser servers behind a load balancer

Playwright has two server modes. Clients connect to both with
`browserType.connect()`.

| | `browserType.launchServer()` | `npx playwright run-server` |
| --- | --- | --- |
| Browser processes | [One browser, shared by all connections](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/remote/playwrightServer.ts#L257-L274) | [A new browser for each connection](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/remote/playwrightServer.ts#L285-L309), closed when the connection closes |
| Browser type | The type that started the server | The type of the client's `connect()` call |
| Connection limit | [None](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/browserServerImpl.ts#L84) | `--max-clients`; other connections wait |
| On disconnect | Closes the contexts of that connection | Closes the browser |
| Client options | Ignores `exposeNetwork` and launch options from the client | Uses [`exposeNetwork`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-option-expose-network), and some launch options, such as `headless` and `proxy`, from the client's `x-playwright-launch-options` header |
| Server code | Node.js | Command line, as in [Playwright's Docker guide](https://playwright.dev/docs/docker#remote-connection) |

Both modes reject a client whose Playwright major and minor version differ from
the server's version. See
[`browserType.connect()`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect).

This gives you:

- Browsers on separate hosts, with capacity that you scale separately from your
  applications.
- One endpoint for clients in every Playwright language.
- With `launchServer()`, browser reuse between connections.
- With `run-server`, a separate browser process for each connection. Each
  connection pays the browser launch cost. See
  [why browser reuse helps](/browserthing/docs/benchmarks/#why-browser-reuse-helps).

You build and run:

- A connection limit and a queue with a timeout for each container.
  `launchServer()` accepts all connections into one browser. Configure the
  limit and the queue in your load balancer.
- A separate pool for each Playwright version, and for each browser type with
  `launchServer()`. Route each client to the correct pool in the load balancer,
  for example by its `User-Agent` header for the version and its
  `x-playwright-browser` header for the browser type. Or give each pool its own
  endpoint.
- Browser replacement for `launchServer()`. Stop new connections to a container,
  wait for its sessions, and then restart it.
- Drain before a deploy or a scale-down, so that the load balancer stops new
  connections before the container stops.
- Health checks that remove a container that does not accept connections.
  When a `launchServer()` browser exits, your server code must start a new
  browser server or exit so that a supervisor restarts the container.
- A view of active sessions and free capacity, and a way to end a session.
- Authentication. A Playwright server has no API keys. `launchServer()` uses an
  [unguessable path by default](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server-option-ws-path);
  behind a load balancer, set the same path on every container or rewrite the
  path in the load balancer.

## What BrowserThing provides

| Need | BrowserThing v0.7.0 |
| --- | --- |
| Playwright versions | The server selects a worker with the client's Playwright major and minor version. Workers with different versions can serve one endpoint. |
| Browser types | Chromium, Firefox, and WebKit workers. Clients select one with the `browser` URL parameter. |
| Slot limits | Each worker serves up to `MAX_SLOTS` sessions (default 5). |
| Admission queue | Requests wait for a free slot, up to `MAX_QUEUE_SIZE` requests (default 100) and `QUEUE_WAIT_TIMEOUT` (default 30 seconds). |
| Browser recycling | A worker drains after `MAX_LIFETIME_SESSIONS` session claims (default 50) and replaces its browser without a container restart. |
| Drain on shutdown | On `SIGTERM`, a worker stops new sessions and waits up to `DRAIN_TIMEOUT` for active sessions. |
| Dead workers | Workers send heartbeats. The server stops selecting a worker that stops sending them. Sessions without a heartbeat expire and free their slots. The server removes old worker records. |
| Dial failures | If the server cannot connect to the selected worker, it marks that worker stalled and tries one other matching worker within `WORKER_DIAL_TIMEOUT`. |
| REST API | `GET /v1/capacity`, `GET /v1/workers`, and `/v1/sessions` to create, read, and end sessions. |
| API keys | Clients and workers authenticate with API keys. |

See [architecture](/browserthing/docs/architecture/), the
[configuration reference](/browserthing/docs/configuration/), and the
[API guide](/browserthing/docs/api/) for details.

## What stays the same

- Sessions on a worker share one browser process, as with `launchServer()`.
  Browser contexts separate cookies and storage. A browser crash ends all
  sessions on that worker.
- Browser launch flags apply to the whole worker. Set session options such as
  proxy, locale, and viewport through Playwright browser contexts.
- The `connect()` option `exposeNetwork` has no effect, as with
  `launchServer()`. Browsers on workers cannot reach your client's local network
  through the connection.
- If a browser crashes, its worker exits. A supervisor, such as the restart
  policy in the supplied Compose file, must start the worker again. Your client
  code decides whether to retry its work.
- You deploy and update the server, PostgreSQL, and workers. Browser traffic
  goes through the server. A server outage ends the connections on that server.
- The pool is for your own applications and trusted clients. See the
  [security boundary](/browserthing/docs/security/).

## When your own setup is enough

- **Low volume.** If the launch cost for each task is acceptable, launch a
  browser for each task with `chromium.launch()` or use `run-server`. Each task
  then gets its own browser process.
- **One application in one language.** A pool in the application is enough
  when the browser load fits on your application hosts.
- **Test runs.** Playwright's
  [Docker guide](https://playwright.dev/docs/docker#remote-connection) uses
  `run-server` for remote test runs.
- **One version and one browser type.** A small number of `launchServer()`
  containers behind a load balancer can be enough when your clients limit
  their own concurrency.

BrowserThing applies when several applications or languages share browser
capacity, when clients use different Playwright versions, or when you need
queueing, recycling, and capacity data without building them.
