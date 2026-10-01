---
title: Architecture
description: How BrowserThing routes sessions, keeps browsers warm, and recovers worker capacity.
---

BrowserThing has a Go server, a PostgreSQL database, and TypeScript Playwright
workers. Each worker keeps one browser process running.

```text
Playwright clients
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

1. The server checks the client's key, if authentication is enabled.
2. It claims capacity on a matching worker and creates a session record.
3. It connects to the worker and starts the WebSocket relay.
4. The client creates contexts and pages through Playwright.
5. When the connection closes, the worker cleans up the session's resources.

When all matching slots are busy, requests can wait in the server's admission
queue. Each server replica has its own queue. See
[queue settings](/browserthing/docs/configuration/#server).

## Worker recycling and failures

By default, a worker drains after 50 lifetime session claims. Draining stops new
sessions and waits for existing sessions for up to `DRAIN_TIMEOUT`. The worker
then replaces its browser process and resumes service without restarting the
container. A shutdown signal such as `SIGTERM` drains and stops the worker instead.

When the drain timeout expires, remaining sessions are closed. The supplied
Compose file sets this timeout to **30 seconds**; the worker's standalone default
is 300 seconds. Set it for the time your tasks need to finish. See the
[worker settings](/browserthing/docs/configuration/#worker).

Selection concentrates load on longer-serving workers to stagger recycling.
Dead workers lose their sessions, and the server closes out their records so
capacity can recover.

If a browser crashes, all sessions on that worker end. The grid restores
capacity; your client code must decide whether to retry its work.

Read the [security boundary](/browserthing/docs/security/) before you use the grid for clients
that do not trust each other.
