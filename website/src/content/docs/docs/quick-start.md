---
title: Quick start
description: Start BrowserThing with Docker Compose and connect your application code to a browser worker with Playwright.
---

You need Docker with the Compose plugin, `curl`, and Node.js 20 or later for the
client example. BrowserThing runs its browsers in containers. You do not need to
install browsers on the client machine.

This local setup runs the service and its browser worker on your machine.
For your application deployment, you can move workers to
[separate hosts](/browserthing/docs/scaling/#add-workers-on-other-hosts) so browser
CPU and memory use stays off your application servers.

## 1. Download the configuration

Create an empty directory for this deployment. Keep its name unchanged when you
upgrade, because Docker Compose uses it to name the database volume.

```sh
mkdir browserthing
cd browserthing
curl -fsSLO https://mbroton.github.io/browserthing/downloads/docker-compose.yaml
curl -fsSL --create-dirs -o worker/seccomp_profile.json https://raw.githubusercontent.com/mbroton/browserthing/v0.6.0/worker/seccomp_profile.json
```

This site's Compose file pins both BrowserThing images to `0.6.0`. It starts
PostgreSQL, the server, and one Chromium worker with five session slots.

## 2. Start the service

```sh
docker compose up -d
docker compose ps
curl -fsS http://localhost:8080/v1/capacity
```

The first start downloads the images. If the capacity request fails or shows no
workers, wait for startup and try again. Check `docker compose logs` if the worker
does not register.

:::note[Local setup]
The server listens on `127.0.0.1:8080`. This example uses the Compose file's local
database password and starts without API keys. Follow the
[deployment guide](/browserthing/docs/deployment/) before you expose the service to other machines.
:::

## 3. Run a browser task

Install the matching Playwright client:

```sh
npm init -y
npm install playwright@1.63.0
```

Save this as `preview.mjs`. This example saves a screenshot. Replace the task
with the browser actions your application needs:

```js
import { chromium } from 'playwright';

const browser = await chromium.connect('ws://localhost:8080');
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: 'preview.png', fullPage: true });
} finally {
  await browser.close();
}
```

Run it:

```sh
node preview.mjs
```

Open `preview.png` in the current directory to see the result. The browser runs
on the worker, and Playwright saves the screenshot on the client machine.
Closing the connection releases the session's resources for the next task.

The client and worker must have the same Playwright **major and minor** version.
For these images, use `1.63.x`.

## 4. Add capacity or stop

Start three workers for 15 concurrent session slots:

```sh
docker compose up -d --scale worker=3
```

Stop the service and keep its database volume:

```sh
docker compose down
```

Continue with [connection examples](/browserthing/docs/connect/) or [deployment](/browserthing/docs/deployment/).
