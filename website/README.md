# BrowserThing website

The landing page uses Astro. Documentation uses Starlight and Markdown. The site
is built as static files for `https://mbroton.github.io/browserthing/`.

## Develop

Use Node.js 22.12 or later and npm 9.6.5 or later.

```sh
cd website
npm ci
npm run dev
```

Open `http://localhost:4321/browserthing/`. Docs start at
`http://localhost:4321/browserthing/docs/`.

## Verify the production build

```sh
npm run check
npm run build
npm run preview
```

Starlight builds the Pagefind search index during the production build. Test
search with `npm run preview`; the development server does not provide the
production search index.

The build also validates internal documentation links, heading anchors, and
Markdown export targets. Broken links fail the build, including in pull
requests. External sites are not fetched during the build.

## Edit content

```text
src/pages/index.astro          Landing page
src/styles/landing.css         Landing page styles
src/styles/docs.css            Starlight theme colors
src/content/docs/docs/         Documentation at /docs/
public/downloads/              Release-pinned quick-start files
```

Use `import.meta.env.BASE_URL` for links and assets in Astro files. Markdown
docs use paths starting with `/browserthing/`, such as
`[configuration](/browserthing/docs/configuration/#worker)`. These paths work in
both HTML and exported Markdown. Add docs pages to the sidebar in `astro.config.mjs`.

The product message is **Use Playwright in your app. Run browsers elsewhere.**
Keep the README, landing page, site metadata, and docs overview focused on
developers who use Playwright from application code. Explain how a shared browser
service handles browser management and lets browser capacity grow separately
from application capacity. Keep specific tasks, such as screenshots, as examples
in the guides. State that the team still deploys and updates the service, and that
sessions share a browser process on each worker.

## Markdown access

`starlight-page-actions` provides page copy controls and static `.md` files.
For example, `/browserthing/docs/api/` has a Markdown version at
`/browserthing/docs/api.md`. The docs home is `/browserthing/docs.md`.

`starlight-llms-txt` generates `/browserthing/llms.txt`, `llms-full.txt`, and
`llms-small.txt` from the same content. Leave Page Actions' `baseUrl` unset so
it does not generate a second `llms.txt`. No AI account or chat backend is used.

Page copy needs HTTPS or localhost because it uses the browser Clipboard API.

## Release updates

The initial docs describe BrowserThing v0.6.0 and Playwright 1.63.0. When the
documented release changes, update the release links, client install versions,
and version labels together. Refresh `public/downloads/docker-compose.yaml`
from that release's root Compose file, with both BrowserThing image tags pinned
to the release number. Keep the seccomp profile URL on the same release tag.

The README, server README, worker README, and OpenAPI document in the repository
are the sources for the first set of guides. Check behavior against the release
code when changing those guides.

## Publish

`.github/workflows/website.yml` checks and builds pull requests. It deploys
changes to `main` when website files or the workflow change. It also supports a
manual run on `main`. Pull requests and manual runs on other branches cannot
deploy the production site.

In repository **Settings → Pages**, select **GitHub Actions** as the source.
The workflow uses GitHub's token; no domain or extra deployment secret is needed.

The Go server and Playwright workers run separately from this documentation site.
