---
title: Benchmarks
description: Compare task time and CPU use for BrowserThing and Browserless.
---

BrowserThing keeps browsers running between sessions. This benchmark opened
and closed a Playwright connection for each task. In this setup, Browserless
2.56.0 [launched a new browser process](https://github.com/browserless/browserless/blob/v2.56.0/src/browsers/browsers.playwright.ts#L197-L209)
for each connection.

```text
BrowserThing: Connect -> Use running browser -> Open page -> Read
Browserless:  Connect -> Start new browser   -> Open page -> Read
```

Browserless also supports
[session reuse](https://docs.browserless.io/baas/session-management), which this
benchmark did not use.

## Results

The comparison used an AWS `m8i.xlarge` with 4 vCPUs and 16 GB of memory.
Both systems used the same Playwright version, with one BrowserThing worker
and one Browserless node.

| Measurement | BrowserThing | Browserless |
| --- | --- | --- |
| Get a browser, open a page, read it | **51 ms** | 217 ms |
| CPU time per task | **0.09 s** | 0.70 s |
| 1,000 such tasks, 5 at a time | **26 s** | 154 s |

These results measure a short page-read task.
Results for your application depend on the pages, hardware, and number of
concurrent sessions.

## Why browser reuse helps

BrowserThing avoids the browser launch cost on each connection. This saves
time and CPU when a service opens and closes many short sessions.

For application tasks, browser reuse reduces session startup overhead. Page
loading and browser actions still take time. Measure the complete task
with your own pages before estimating the benefit for your application.

Each session uses separate browser contexts for cookies, storage, and cache.
Sessions on the same worker share a browser process. Browser launch options
apply to the whole worker, and a browser crash ends all sessions on that worker.
See [architecture](/browserthing/docs/architecture/) and the
[security boundary](/browserthing/docs/security/) for details.

## Measure your workload

The repository includes
[benchmark scripts](https://github.com/mbroton/browserthing/tree/v0.6.0/scripts/bench)
for time to first page and session throughput. Use the
[scaling guide](/browserthing/docs/scaling/#tune-slots) to tune worker capacity
for your workload.
