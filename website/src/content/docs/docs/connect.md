---
title: Connect with Playwright
description: Connect your application's Playwright code to BrowserThing from Node.js or Python.
---

Use Playwright's `connect()` method in your application with the BrowserThing
WebSocket URL. The server selects an available worker that matches the browser
type and the client's Playwright major and minor version.

```text
Application -> Playwright commands -> Browser worker
            <- Results            <-
```

BrowserThing v0.6.0 images use Playwright **1.63.0**. The examples below use that
version. Use `wss://` when your endpoint has TLS.

The examples save a screenshot as a small browser task. Use the same connection
for the browser actions your application needs.

## Node.js

```sh
npm install playwright@1.63.0
```

Save this as `connect.mjs`:

```js
import { chromium } from 'playwright';

const browser = await chromium.connect('ws://localhost:8080');
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: 'preview.png', fullPage: true });
} finally {
  await browser.close();
}
```

Run `node connect.mjs`. It saves `preview.png` in the current directory on the
client machine. Replace `https://example.com` with your application's page URL.

## Python

```sh
python -m pip install playwright==1.63.0
```

Save this as `connect.py`:

```python
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect("ws://localhost:8080")
        try:
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto("https://example.com")
            await page.screenshot(path="preview.png", full_page=True)
        finally:
            await browser.close()


asyncio.run(main())
```

Run `python connect.py`. It saves `preview.png` in the current directory on the
client machine.

Java and .NET clients use their corresponding `BrowserType.connect()` /
`ConnectAsync()` methods with the same endpoint and version requirement.

## PDF exports

Use a Chromium worker for PDF generation. In either example above, replace the
screenshot call with a PDF call after the page has loaded:

```js
await page.pdf({ path: 'report.pdf', format: 'A4', printBackground: true });
```

```python
await page.pdf(path="report.pdf", format="A4", print_background=True)
```

Playwright saves `report.pdf` on the client machine. [PDF generation](https://playwright.dev/docs/api/class-page#page-pdf) uses print
styles by default. To use screen styles, call `page.emulateMedia({ media: 'screen' })`
in Node.js or `page.emulate_media(media="screen")` in Python before the PDF call.

For an application response or file upload, omit `path` from `screenshot()` or
`pdf()` and use the returned bytes. Your application decides where to store or
send the result.

## Firefox and WebKit

Start a worker with `BROWSER_TYPE=firefox` or `BROWSER_TYPE=webkit` first. A worker
serves one browser type. Then select it in the connection URL:

```js
import { firefox, webkit } from 'playwright';

const firefoxBrowser = await firefox.connect(
  'ws://localhost:8080/?browser=firefox',
);
await firefoxBrowser.close();

const webkitBrowser = await webkit.connect(
  'ws://localhost:8080/?browser=webkit',
);
await webkitBrowser.close();
```

The repository's
[local Compose file](https://github.com/mbroton/browserthing/blob/v0.6.0/docker-compose.local.yaml)
shows a stack with all three browser types. It builds from source and requires a
repository checkout.

## API keys

After you create an API key, clients must send it with each connection. For a
Node.js client, use an authorization header:

```js
const browser = await chromium.connect('wss://grid.example.com', {
  headers: { Authorization: `Bearer ${process.env.BROWSERTHING_API_KEY}` },
});
```

Clients can also pass `?token=pwd_...` in the URL. Keep keys out of source control
and shared logs. Every valid key has full access to the service in v0.6.0. See
[security](/browserthing/docs/security/).

## Session lifetime

Create your own browser context after you connect. Close the browser connection
in a `finally` block so the worker can release the session slot.

A session ends when its connection closes. Reconnecting to a completed session
is not supported in v0.6.0. The [API guide](/browserthing/docs/api/) explains how to create a
pending session and attach to it by ID.
