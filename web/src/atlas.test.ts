import { expect, test } from 'vitest';
import { TILE_SIZE } from './assets';
import { layoutAtlas, packAtlas, PAD, tileUv } from './atlas';

const names = Array.from({ length: 22 }, (_, i) => `t${i}`);

test('22 tiles fill three rows of eight cells', () => {
  const l = layoutAtlas(names);
  expect(l.width).toBe(8 * (TILE_SIZE + 2 * PAD));
  expect(l.height).toBe(3 * (TILE_SIZE + 2 * PAD));
});

test('every tile has its own cell with the padding inside it', () => {
  const l = layoutAtlas(names);
  const cell = TILE_SIZE + 2 * PAD;
  for (const { x, y } of l.origin.values()) {
    expect((x - PAD) % cell).toBe(0);
    expect((y - PAD) % cell).toBe(0);
    expect(x + TILE_SIZE + PAD).toBeLessThanOrEqual(l.width);
    expect(y + TILE_SIZE + PAD).toBeLessThanOrEqual(l.height);
  }
  expect(new Set([...l.origin.values()].map((o) => `${o.x},${o.y}`)).size).toBe(names.length);
});

test('the padding keeps at least one texel of border through mip level 4', () => {
  expect(layoutAtlas(names).pad / 2 ** 4).toBeGreaterThanOrEqual(1);
});

test('uv rectangles sit inside the atlas, are one tile wide and do not overlap', () => {
  const l = layoutAtlas(names);
  const rects = names.map((n) => tileUv(l, n));
  for (const [u0, v0, u1, v1] of rects) {
    expect(u0).toBeGreaterThanOrEqual(0);
    expect(v0).toBeGreaterThanOrEqual(0);
    expect(u1).toBeLessThanOrEqual(1);
    expect(v1).toBeLessThanOrEqual(1);
    expect((u1 - u0) * l.width).toBeCloseTo(TILE_SIZE);
    expect((v1 - v0) * l.height).toBeCloseTo(TILE_SIZE);
  }
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      const apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
      expect(apart).toBe(true);
    }
  }
});

test('an unknown tile is an error', () => {
  expect(() => tileUv(layoutAtlas(names), 'nope')).toThrow(/no tile named nope/);
});

test('edge pixels are smeared into the padding and the corners are the corner pixels', () => {
  const l = layoutAtlas(['a']);
  const tile = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) tile.set([x, y, 7, 255], (y * TILE_SIZE + x) * 4);
  }
  const atlas = packAtlas(new Map([['a', tile]]), l);
  const at = (x: number, y: number) => [...atlas.slice((y * l.width + x) * 4, (y * l.width + x) * 4 + 4)];
  const { x: ox, y: oy } = l.origin.get('a')!;
  expect(at(ox + 5, oy + 9)).toEqual([5, 9, 7, 255]);
  expect(at(ox - PAD, oy + 9)).toEqual([0, 9, 7, 255]);
  expect(at(ox + TILE_SIZE + PAD - 1, oy + 9)).toEqual([127, 9, 7, 255]);
  expect(at(ox + 5, oy - 1)).toEqual([5, 0, 7, 255]);
  expect(at(ox + 5, oy + TILE_SIZE + PAD - 1)).toEqual([5, 127, 7, 255]);
  expect(at(ox - 1, oy - 1)).toEqual([0, 0, 7, 255]);
  expect(at(ox + TILE_SIZE, oy + TILE_SIZE)).toEqual([127, 127, 7, 255]);
});
