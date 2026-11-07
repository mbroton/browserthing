import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightPageActions from 'starlight-page-actions';
import { satteri } from '@astrojs/markdown-satteri';
import { releasePlugin } from './release.mjs';

export default defineConfig({
  site: 'https://mbroton.github.io',
  base: '/browserthing',
  trailingSlash: 'always',
  markdown: { processor: satteri({ mdastPlugins: [releasePlugin] }) },
  integrations: [
    starlight({
      title: 'BrowserThing',
      description: 'A self-hosted browser pool for Playwright applications. Reuse running browsers for short tasks, with session cleanup and configurable browser recycling.',
      favicon: '/browserthing-icon.svg',
      logo: { src: './src/assets/mark.svg' },
      disable404Route: true,
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mbroton/browserthing' }],
      editLink: { baseUrl: 'https://github.com/mbroton/browserthing/edit/main/website/' },
      customCss: [
        '@fontsource-variable/schibsted-grotesk',
        '@fontsource/fragment-mono',
        './src/styles/docs.css',
      ],
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderRadius: '0.6rem',
          borderColor: 'var(--line)',
          codeBackground: 'var(--surface)',
          frames: {
            editorBackground: 'var(--surface)',
            editorTabBarBackground: 'var(--paper)',
            editorActiveTabBackground: 'var(--surface)',
            terminalBackground: 'var(--surface)',
            terminalTitlebarBackground: 'var(--paper)',
            terminalTitlebarBorderBottomColor: 'var(--line)',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
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
          { slug: 'docs/own-setup' },
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
