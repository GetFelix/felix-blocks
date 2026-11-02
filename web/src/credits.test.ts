import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';

const assets = new URL('../assets/', import.meta.url);
const credits = readFileSync(new URL('CREDITS.md', assets), 'utf8');
const packs = readdirSync(assets, { withFileTypes: true }).filter((e) => e.isDirectory());

test('there is a pack to check', () => {
  expect(packs.length).toBeGreaterThan(0);
});

test.each(packs.map((p) => p.name))('%s has a licence file and a credits row naming its folder', (pack) => {
  const licence = readFileSync(new URL(`${pack}/License.txt`, assets), 'utf8');
  expect(licence).toMatch(/Creative Commons Zero|CC0/);
  const row = credits.split('\n').find((line) => line.startsWith('|') && line.includes(`\`${pack}/`));
  expect(row, `CREDITS.md has no row for ${pack}/`).toBeDefined();
  expect(row).toMatch(/https:\/\/kenney\.nl\//);
  expect(row).toMatch(/CC0/);
});
