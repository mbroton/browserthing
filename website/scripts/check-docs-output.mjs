import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../dist/', import.meta.url);
const site = new URL('https://mbroton.github.io/browserthing/');
const fullDocs = await readFile(new URL('llms-full.txt', output), 'utf8');

async function checkTarget(href) {
  const url = new URL(href, site);
  assert.equal(url.origin, site.origin, `Unexpected docs origin: ${href}`);
  assert.ok(url.pathname.startsWith(site.pathname), `Missing base path: ${href}`);
  const relative = url.pathname.slice(site.pathname.length);
  const target = new URL(relative.endsWith('/') ? `${relative}index.html` : relative, output);
  assert.ok((await stat(target)).isFile(), `Missing export target: ${href}`);
  return target;
}

// Read the published controls, so a change to a plugin's URL mapping cannot
// silently leave working HTML pages with broken Markdown downloads.
const docsDir = new URL('docs/', output);
const pages = [new URL('index.html', docsDir)];
for (const entry of await readdir(docsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) pages.push(new URL(`${entry.name}/index.html`, docsDir));
}

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const exports = [...html.matchAll(/href="(\/browserthing\/[^"]+\.md)"/g)].map((match) => match[1]);
  assert.ok(exports.length > 0, `No Markdown link: ${fileURLToPath(page)}`);
  for (const href of new Set(exports)) {
    const markdown = await readFile(await checkTarget(href), 'utf8');
    assert.ok(markdown.startsWith('# '), `Missing Markdown title: ${href}`);
    const title = markdown.split('\n')[0];
    assert.ok(fullDocs.includes(`${title}\n`), `Page missing from full docs: ${title}`);
    for (const [, link] of markdown.matchAll(/\]\((\/[^)]+)\)/g)) {
      await checkTarget(link);
    }
  }
}

const index = await readFile(new URL('llms.txt', output), 'utf8');
assert.ok(index.startsWith('# BrowserThing\n'));
assert.ok(index.includes('https://mbroton.github.io/browserthing/llms-full.txt'));
for (const [, link] of index.matchAll(/\]\((https:[^)]+)\)/g)) await checkTarget(link);

// The abridged export must retain limits that affect safe use of the grid.
for (const name of ['llms-full.txt', 'llms-small.txt']) {
  const text = await readFile(new URL(name, output), 'utf8');
  assert.ok(text.includes('Every valid API key has full browser and control-plane access'), name);
  assert.ok(text.includes('remaining sessions are closed'), name);
}

console.log(`Checked Markdown exports for ${pages.length} docs pages and both documentation bundles.`);
