---
title: Security
description: Understand BrowserThing authentication, browser isolation, and network boundaries.
---

BrowserThing is built for applications you trust. It trusts authenticated clients.
In bootstrap mode, it trusts every client that can reach the server. Browsers can
visit untrusted pages, but the service is not a security boundary between hostile
clients.

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

A server with zero active API keys starts in open bootstrap mode. Create the
first key to enable authentication. Every valid key has equal access, including
the ability to inspect or delete other sessions.

Once locked, the running server stays locked even if you revoke all keys. If
you restart it with zero active keys in the database, it returns to bootstrap
mode. Plan key rotation before you revoke your last usable key.

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
