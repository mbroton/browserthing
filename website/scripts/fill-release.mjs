import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fillRelease } from '../release.mjs';

const output = new URL('../dist/', import.meta.url);

for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(md|yaml)$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  const text = await readFile(file, 'utf8');
  const filled = fillRelease(text);
  if (filled !== text) await writeFile(file, filled);
}
