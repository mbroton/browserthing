---
title: API reference
description: Inspect capacity and workers, create sessions, and attach Playwright clients by session ID.
---

BrowserThing provides a REST control plane and WebSocket connections for
Playwright. The examples use a local server. Add
`-H "Authorization: Bearer $BROWSERTHING_API_KEY"` to REST requests after you
enable authentication.

The full request and response schemas are in the
[v0.6.0 OpenAPI document](https://github.com/mbroton/browserthing/blob/v0.6.0/server/openapi.yaml).
WebSocket routes are documented separately below.

## Capacity and workers

| Method and path | Purpose |
| --- | --- |
| `GET /v1/capacity` | Read browser capacity, free slots, and queue depth. |
| `GET /v1/workers` | List worker records. |
| `GET /healthz` | Check process health without authentication. |
| `GET /readyz` | Check database readiness without authentication. |

```sh
curl -fsS http://localhost:8080/v1/capacity
curl -fsS http://localhost:8080/v1/workers
```

For one idle Chromium worker with five slots, `GET /v1/capacity` returns
`200 OK` with these values:

```json
{
  "browsers": [
    {
      "browser": "chromium",
      "workers": 1,
      "max_slots": 5,
      "active_sessions": 0,
      "available_slots": 5
    }
  ],
  "totals": {
    "workers": 1,
    "max_slots": 5,
    "active_sessions": 0,
    "available_slots": 5
  },
  "queued": 0,
  "max_queue_size": 100
}
```

The `queued` capacity value belongs to the server replica that handles the
request. It is not a sum across replicas.

## Create and attach a session

`POST /v1/sessions` reserves a session. Supply the browser type and the client's
Playwright version so the server can select a matching worker:

```sh
curl -fsS http://localhost:8080/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"browser":"chromium","playwright_version":"1.63.0"}'
```

Success returns `201 Created` and a session object. These are selected fields
from an example response; IDs differ for each session:

```json
{
  "id": "6fb174a2-4dc3-4c29-a33c-20f3b05da4bd",
  "browser": "chromium",
  "playwright_version": "1.63.0",
  "mode": "default",
  "status": "pending",
  "started_at": null,
  "connect_metadata": {}
}
```

Attach before the pending session expires (30 seconds by default). This complete
example creates the session and uses its returned ID immediately. It needs
Node.js 20 or later and the matching client:

```sh
npm install playwright@1.63.0
```

Save this as `create-session.mjs`. Set `BROWSERTHING_URL` for a remote server and
`BROWSERTHING_API_KEY` if authentication is enabled. The key is used for both the
REST request and the WebSocket connection.

```js
import { chromium } from 'playwright';

const server = process.env.BROWSERTHING_URL || 'http://localhost:8080';
const key = process.env.BROWSERTHING_API_KEY;
const headers = key ? { Authorization: `Bearer ${key}` } : {};

const response = await fetch(new URL('/v1/sessions', server), {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ browser: 'chromium', playwright_version: '1.63.0' }),
});
if (!response.ok) {
  throw new Error(`Create session: HTTP ${response.status}: ${await response.text()}`);
}

const session = await response.json();
const endpoint = new URL(`/sessions/${session.id}`, server);
endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

const browser = await chromium.connect(endpoint.href, { headers });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: 'preview.png', fullPage: true });
} finally {
  await browser.close();
}
```

Run `node create-session.mjs`. It saves `preview.png` on the client machine.

This attaches to a pending session. It does not resume a session after its
connection has closed. The connecting client's major and minor version must
match the session's worker.

## Inspect or terminate a session

| Method and path | Purpose |
| --- | --- |
| `POST /v1/sessions` | Create a pending session. |
| `GET /v1/sessions/{id}` | Read one session record. |
| `DELETE /v1/sessions/{id}` | Complete a pending or running session. |

```sh
curl -fsS http://localhost:8080/v1/sessions/SESSION_ID
curl -fsS -X DELETE http://localhost:8080/v1/sessions/SESSION_ID
```

`GET` returns `200 OK` with the session object. A successful `DELETE` returns
`204 No Content` with no response body. An unknown ID returns `404 Not Found`.

For a running session, the relay notices deletion on its next heartbeat and
closes both WebSocket peers with code `1001`. The normal delay is at most one
`SESSION_HEARTBEAT_INTERVAL` (10 seconds by default).

## WebSocket routes

```text
GET /?browser=chromium
  -> create session -> select worker -> relay Playwright traffic

GET /sessions/{id}
  -> attach to pending session -> relay Playwright traffic
```

Both routes accept `Authorization: Bearer pwd_...` or `?token=pwd_...`. The first
route uses `DEFAULT_BROWSER_TYPE` when `browser` is omitted. Supported browser
types are `chromium`, `firefox`, and `webkit`.

The relay forwards `User-Agent` and `x-playwright-*` headers to workers, plus
its own `x-pwd-session-id`. It does not forward client authorization, cookies,
or query tokens to the worker.

## Error responses

REST errors include an HTTP status and a JSON body with details. For example,
requesting `mode: dedicated` returns `422 Unprocessable Entity` with these fields:

```json
{
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "dedicated mode is not available yet"
}
```

Use `curl -sS -i` to see both the status and error body. `curl -f` hides the body
on errors. Failed WebSocket connections return their error before the upgrade;
their JSON bodies contain a `message` field. See [HTTP errors](/browserthing/docs/troubleshooting/#http-errors)
for causes and next actions.

## API keys

Manage keys with the server CLI:

```sh
docker compose exec server server apikey create --name client
docker compose exec server server apikey list
docker compose exec server server apikey revoke --id KEY_ID
```

All valid keys have full access in v0.6.0. Worker registration and lifecycle
routes under `/internal/workers` are for the worker protocol; their schemas are
also included in OpenAPI.
