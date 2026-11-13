---
title: Architecture
description: How BrowserThing routes sessions, keeps browsers warm, and recovers worker capacity.
---

Your application runs the Playwright code that controls browser tasks.
BrowserThing runs the browsers and manages their sessions through
a Go server, a PostgreSQL database, and TypeScript Playwright workers.
Each worker keeps one browser process running between tasks.

```text
Applications using Playwright
        |
        | WebSocket
        v
     Server <----------> PostgreSQL
        |
        | WebSocket relay
        +------------+------------+
        v            v            v
     Worker       Worker       Worker
     Chromium     Firefox      WebKit
        |            |            |
     contexts     contexts     contexts

Workers -> Server: HTTP registration and heartbeats
```

## The server

The server authenticates clients, selects a worker, and relays WebSocket
messages. It also provides the REST API for sessions, workers, and capacity.
PostgreSQL stores worker records, sessions, and API-key hashes.

Browser traffic passes through the server for the whole session. A server
outage ends connections that use that relay.

## The workers

Each worker registers its address, browser type, Playwright version, and slot
limit with the server. It sends regular heartbeats to report that it is alive.

Workers serve up to `MAX_SLOTS` sessions at once. The default is five. Sessions
have separate browser contexts, but share the worker's browser process.

## A connection

1. The server checks the client's API key.
2. It claims capacity on a matching worker and creates a session record.
3. It connects to the worker and starts the WebSocket relay.
4. The client creates contexts and pages through Playwright.
5. When the connection closes, the worker cleans up the session's resources.

When all matching slots are busy, requests can wait in the server's admission
queue. Requests for the same browser and Playwright version get slots in
arrival order. Each server replica has its own queue. See
[queue settings](/browserthing/docs/configuration/#server).

## Worker recycling and failures

By default, a worker recycles its browser after 50 lifetime session claims. It
starts a new browser and sends new sessions to it at once, without restarting
the container. Open sessions finish on the old browser, which closes after its
last session ends. A slow session therefore does not stop the worker from
taking new sessions. While both browsers run, the worker needs memory for one
more browser.

A worker runs at most two browsers. If it reaches the session limit again
before the old browser closes, the current browser keeps serving and recycles
at a later limit.

A shutdown signal such as `SIGTERM` stops new sessions, waits for open
sessions, and then stops the worker.

When `DRAIN_TIMEOUT` expires on an old browser or on a worker that is shutting
down, remaining sessions are closed. The supplied
Compose file sets this timeout to **30 seconds**; the worker's standalone default
is 300 seconds. Set it for the time your tasks need to finish. See the
[worker settings](/browserthing/docs/configuration/#worker).

Selection concentrates load on longer-serving workers to stagger recycling.
Dead workers lose their sessions, and the server closes out their records so
capacity can recover.

If a browser crashes, all sessions on that worker end. BrowserThing restores
capacity; your client code must decide whether to retry its work.

Sessions separate cookies and storage but share a browser process on each
worker. See the [security boundary](/browserthing/docs/security/) for client trust
and network access requirements.
