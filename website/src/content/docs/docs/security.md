---
title: Security
description: Understand BrowserThing authentication, browser isolation, and network boundaries.
---

BrowserThing is built for applications you trust. It trusts authenticated clients.
Browsers can visit untrusted pages, but the service is not a security boundary
between hostile clients.

## Session isolation

```text
Worker container
└── Shared browser process
    ├── Session A -> separate browser contexts
    └── Session B -> separate browser contexts
```

Contexts separate cookies and storage. They do not provide separate operating
system processes for each session. If the shared browser crashes, the worker's
sessions end together.

Use dedicated VMs when you need a stronger boundary against hostile tenants or
browser exploits. An authenticated client can use browser network access, so
control which internal addresses workers can reach.

Browser tasks can load a URL supplied by a user. Apply network access controls
to the workers for these requests, including access to internal services.

## Authentication

Every request except `/healthz` and `/readyz` needs a valid API key. A server
with zero active keys refuses all other requests with `401` and logs how to
create a key. Every valid key has equal access, including the ability to
inspect or delete other sessions. Create the replacement key before you revoke
your last usable key.

Workers must reach the server, so a page that a worker renders can also reach
it. Authentication keeps such a page out of the server's API.

`AUTH_DISABLED=true` turns off key checks and gives every client that can
reach the server full access. The server logs a warning at startup when it is
on. Use it only for local development, as the repository's local Compose file
does.

## Transport and network access

Use TLS (`https://` and `wss://`), a VPN, or an appropriate private network.
Authentication does not encrypt traffic. Keep the database and workers private.
The supplied Compose file binds the server to localhost for initial setup.

The server accepts API keys in the authorization header or a WebSocket URL's
`token` parameter. Its request logs omit query strings, but other tools and
proxies may record URLs. Use headers where your client supports them.

## Container configuration

The worker image runs as the non-root `pwuser` user. The supplied Compose file
uses Playwright's Chromium seccomp profile. Keep these settings when you adapt
the deployment. See
[Playwright's Docker guidance](https://playwright.dev/docs/docker).

Read the [deployment guide](/browserthing/docs/deployment/) to configure keys and network access.
