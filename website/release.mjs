import { readFileSync } from 'node:fs';

const release = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'));

const values = {
  release: release.release,
  playwright: release.playwright,
  'playwright-minor': release.playwright.split('.').slice(0, 2).join('.'),
  'playwright-python': release.playwrightPython,
};

export const placeholderPattern = /\{\{[a-z-]+\}\}/;

/** Replaces each `{{name}}` placeholder with its value from release.json. */
export function fillRelease(text) {
  return text.replace(/\{\{([a-z-]+)\}\}/g, (match, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Unknown release placeholder ${match}`);
    return values[name];
  });
}

const fillProperty = (key) => (node, ctx) => {
  const filled = fillRelease(node[key]);
  if (filled !== node[key]) ctx.setProperty(node, key, filled);
};

/** Sätteri mdast plugin that fills release placeholders in text, code, and link URLs. */
export const releasePlugin = {
  name: 'release',
  text: fillProperty('value'),
  inlineCode: fillProperty('value'),
  code: fillProperty('value'),
  link: fillProperty('url'),
};
