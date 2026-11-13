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

## Private network access

A browser can open every address that its worker can reach. If a browser task
loads a URL or HTML that a user supplies, the page can send the browser to
internal services. It can do this with a direct URL, a redirect, an iframe, or
a hostname that resolves to an internal address. Examples are admin pages,
the cloud metadata address `169.254.169.254`, and the BrowserThing server API.

Workers that test your own internal apps need this access. Workers that render
user-supplied content, for example link previews, screenshots, or email HTML,
usually do not. For these workers, set `BLOCK_PRIVATE_NETWORKS=true`.

### Block private networks

With `BLOCK_PRIVATE_NETWORKS=true`, the worker sends all browser traffic
through a proxy in the worker process. For each connection, the proxy resolves
the hostname, checks the IP address, and connects only to the address that it
checked. Because of this, the check also applies to redirects, iframes, subresources,
WebSockets, and service workers. A hostname cannot change to an internal
address after the check.

The proxy refuses these addresses:

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
  `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, multicast
  `224.0.0.0/4`, and the reserved ranges `192.0.0.0/24`, `192.0.2.0/24`,
  `192.88.99.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, and
  `240.0.0.0/4`.
- IPv6: `::/96` (includes `::1`), `fc00::/7`, `fe80::/10`, `fec0::/10`,
  multicast `ff00::/8`, and the reserved and tunnel ranges `100::/64`,
  `2001::/32`, `2001:db8::/32`, `2002::/16`, and `64:ff9b:1::/48`.
- IPv4-mapped addresses such as `::ffff:10.0.0.1` and NAT64 addresses such as
  `64:ff9b::10.0.0.1` get the result of their IPv4 address.

A refused request fails in the client with `net::ERR_SOCKS_CONNECTION_FAILED`.
Other connection errors, for example a hostname that does not resolve, also
show this error. The worker logs the warning `Blocked a browser connection to a private network`
with the target. The worker process does not use the proxy, so it continues to
register and send heartbeats to the server.

Know these limits before you turn it on:

- **Chromium only.** A Firefox or WebKit worker with this setting does not start.
- **All sessions on the worker.** There is no allowlist. Workers that must also
  reach internal apps need a separate BrowserThing deployment.
- **Clients can turn it off.** A client that sets its own `proxy` on a browser
  context replaces the guard for that context. The guard protects you from
  page content, not from clients. `context.request` and `route.fetch()` use
  the guard unless the context sets its own proxy.
- **WebRTC uses only the proxy.** WebRTC cannot send UDP through the proxy, so
  the worker stops all WebRTC UDP. Peer connections that need UDP fail.
- **Same container as the browser.** For high-risk deployments, also apply a
  network policy to the workers. See the next section.

When you render email or other untrusted HTML with `setContent()`, you can
also stop all frames with `page.route()`:

```ts
await page.route('**/*', route =>
  route.request().isNavigationRequest() && route.request().frame().parentFrame()
    ? route.abort()
    : route.continue(),
);
```

### Worker network policy

A network policy on the worker host or cluster is a second layer. It does not
depend on the worker process. It cannot replace the guard: the worker process
must reach the server, so the policy must allow the server for the browser
too. Allow the server and DNS, allow the public internet, and block the
private ranges.

This Kubernetes `NetworkPolicy` does this for worker pods with the label
`app: browserthing-worker` and server pods with the label
`app: browserthing-server`. Your cluster network plugin must support network
policies. For Compose hosts, apply the same rules with the host firewall.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: browserthing-worker-egress
spec:
  podSelector:
    matchLabels:
      app: browserthing-worker
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: browserthing-server
      ports:
        - protocol: TCP
          port: 8080
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 0.0.0.0/8
              - 10.0.0.0/8
              - 100.64.0.0/10
              - 127.0.0.0/8
              - 169.254.0.0/16
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 224.0.0.0/4
              - 240.0.0.0/4
        - ipBlock:
            cidr: ::/0
            except:
              - ::/96
              - fc00::/7
              - fe80::/10
              - ff00::/8
```

The policy limits only traffic that the worker starts. The server can still
open relay connections to the workers. Some network plugins always allow
traffic from a pod to the node that runs it. Test the policy with your plugin.

## Authentication

Every request except `/healthz` and `/readyz` needs a valid API key. A server
with zero active keys refuses all other requests with `401` and logs how to
create a key. Every valid key has equal access, including the ability to
inspect or delete other sessions. Create the replacement key before you revoke
your last usable key.

Workers must reach the server, so a page that a worker renders can also reach
it. Authentication keeps such a page out of the server's API. With
[`BLOCK_PRIVATE_NETWORKS=true`](#block-private-networks), the page also cannot
connect to a server on a private address.

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
