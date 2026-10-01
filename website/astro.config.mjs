import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightPageActions from 'starlight-page-actions';

export default defineConfig({
  site: 'https://mbroton.github.io',
  base: '/browserthing',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'BrowserThing',
      description: 'A self-hosted browser service for Playwright. Use browsers from your application code while BrowserThing runs and manages them on separate workers.',
      favicon: '/browserthing-icon.svg',
      disable404Route: true,
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mbroton/browserthing' }],
      editLink: { baseUrl: 'https://github.com/mbroton/browserthing/edit/main/website/' },
      customCss: ['./src/styles/docs.css'],
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt(),
        starlightPageActions({
          position: 'table-of-contents',
          actions: { chatgpt: false, claude: false, markdown: true },
        }),
      ],
      sidebar: [
        { label: 'Start here', items: [
          { slug: 'docs' },
          { slug: 'docs/quick-start' },
          { slug: 'docs/connect' },
          { slug: 'docs/benchmarks' },
        ] },
        { label: 'Run your browser service', items: [
          { slug: 'docs/architecture' },
          { slug: 'docs/deployment' },
          { slug: 'docs/scaling' },
          { slug: 'docs/security' },
        ] },
        { label: 'Reference', items: [
          { slug: 'docs/configuration' },
          { slug: 'docs/api' },
          { slug: 'docs/troubleshooting' },
          { slug: 'docs/upgrading' },
        ] },
      ],
    }),
  ],
});
