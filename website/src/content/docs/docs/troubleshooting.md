---
title: Troubleshooting
description: Diagnose failed connections, missing workers, and capacity errors.
---

Start with the service state and logs:

```sh
docker compose ps
docker compose logs server worker
curl -fsS http://localhost:8080/readyz
```

## The client cannot connect

```text
Server ready?
    -> API key accepted?
        -> Worker registered?
            -> Browser and Playwright versions match?
                -> Server can reach worker?
```

Check the endpoint and browser type. `chromium.connect()` needs a Chromium
worker. Firefox and WebKit need their own workers and `?browser=` selection.

Check the client's Playwright version against the worker. The major and minor
versions must match. BrowserThing v0.6.0 images use Playwright 1.63.0.

## HTTP errors

REST requests and failed WebSocket connections can return these statuses:

| Status | Cause | Next action |
| --- | --- | --- |
| `401` | The API key is missing, invalid, or revoked. | Give clients and workers a valid key. |
| `409` | A session already has a client, or the attaching client's Playwright version does not match. | Read the error message. Use a new session or a matching client version. |
| `410` | The session is completed, failed, or expired. | Create a new session. A closed session cannot be resumed. |
| `422` | A REST request has invalid fields, or requests `mode: dedicated`, which is not supported. | Check the response details. Omit `mode` or use `default`; check the browser type and version. |
| `429` | All matching capacity is busy and the queue is full or disabled. | Close unused sessions, reduce concurrency, or add workers. |
| `503` | A queued request timed out, the server is shutting down, or the authentication service is unavailable. | Read the error body. Check worker availability, browser/version matches, database access, and server logs. Admission errors include `Retry-After: 1`. |

The `409` and `410` statuses apply when attaching to `/sessions/{id}`. Read a
REST error body with `curl -sS -i`; `curl -f` hides the response body.

## Requests return 401

The server requires a key after you create the first API key. Give workers
`WORKER_API_KEY`, and give clients an authorization header or a `token` query
parameter. Recreate workers after you change their environment variables.

## A remote worker registers but connections fail

The worker can reach the server, but the server may not be able to reach the
worker. Set `PRIVATE_HOSTNAME` to an address the server can resolve and reach.
Publish the configured `PORT` and permit traffic from the server through the
worker host's firewall.

## Requests wait or return 429

Inspect `GET /v1/capacity` with an API key if needed. Check available slots,
queue depth, and worker health. Close client connections after use. Add workers
if the workload needs more capacity, and measure CPU and memory before you
increase `MAX_SLOTS`.

For a `503` queue timeout, also check that a worker matches the requested browser
and Playwright version. Free slots on a different browser or version cannot
serve the request. Admission waits up to `QUEUE_WAIT_TIMEOUT` (30 seconds by
default). After `Retry-After`, use a limited retry count with increasing delays.

## Several sessions end together

Sessions on one worker share a browser process. A browser crash ends those
sessions. Recycling also closes remaining sessions when `DRAIN_TIMEOUT` expires.
A server restart ends connections on that relay. Check logs before you retry
work, especially if the automation changes data on other sites. A new connection
starts a new session; it does not resume the earlier task.

## Chromium fails during startup

Use the supplied Compose file with `init: true`, the seccomp profile, and shared
memory settings. Keep the worker's non-root user. Check the worker logs for the
startup failure instead of disabling the sandbox.

If you file a [GitHub issue](https://github.com/mbroton/browserthing/issues), include
the BrowserThing and Playwright versions, browser type, and relevant logs.
Remove API keys and private URLs before you share them.
