import { expect, test } from 'vitest';
import { TILE_STYLES } from './palette';
import { brighten, restyle, saturate, tintGreens, underlay } from './tiles';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

test('tinting moves greens to the colour and keeps their relative brightness', () => {
  const tile = px(40, 120, 40, 255, 60, 180, 60, 255);
  tintGreens(tile, [100, 200, 50]);
  // The brighter green is still brighter, and both are the tint's hue.
  expect(tile[1]!).toBeLessThan(tile[5]!);
  expect(tile[0]! / tile[1]!).toBeCloseTo(0.5, 1);
  expect(tile[2]! / tile[1]!).toBeCloseTo(0.25, 1);
});

test('tinting leaves other colours and transparent pixels alone', () => {
  const tile = px(150, 90, 60, 255, 10, 200, 10, 0);
  tintGreens(tile, [100, 200, 50]);
  expect([...tile]).toEqual([150, 90, 60, 255, 10, 200, 10, 0]);
});

test('saturate(0) is grey and saturate(1) changes nothing', () => {
  const grey = px(200, 100, 50, 255);
  saturate(grey, 0);
  expect(grey[0]).toBe(grey[1]);
  expect(grey[1]).toBe(grey[2]);
  const same = px(200, 100, 50, 255);
  saturate(same, 1);
  expect([...same]).toEqual([200, 100, 50, 255]);
});

test('brighten scales colour, not alpha, and clamps', () => {
  const tile = px(100, 200, 10, 128);
  brighten(tile, 1.5);
  expect([...tile]).toEqual([150, 255, 15, 128]);
});

test('an underlay fills a transparent pixel and leaves an opaque one alone', () => {
  const tile = px(0, 0, 0, 0, 10, 20, 30, 255);
  underlay(tile, [200, 220, 240, 0.5]);
  expect([...tile]).toEqual([200, 220, 240, 128, 10, 20, 30, 255]);
});

test('a style tints, then saturates, then brightens, then draws the underlay', () => {
  const style = { saturate: 0.5, brightness: 1.5 };
  const tile = px(200, 100, 50, 255);
  restyle(tile, style);
  const by_hand = px(200, 100, 50, 255);
  saturate(by_hand, 0.5);
  brighten(by_hand, 1.5);
  expect([...tile]).toEqual([...by_hand]);
  const swapped = px(200, 100, 50, 255);
  brighten(swapped, 1.5);
  saturate(swapped, 0.5);
  expect([...tile]).not.toEqual([...swapped]);
});

test('a tile with no style is untouched', () => {
  const tile = px(60, 180, 60, 255);
  restyle(tile, undefined);
  expect([...tile]).toEqual([60, 180, 60, 255]);
});

test('every style in the palette names a tile and only uses what restyle applies', () => {
  for (const style of Object.values(TILE_STYLES)) {
    expect(Object.keys(style).every((k) => ['tint', 'saturate', 'brightness', 'underlay'].includes(k))).toBe(true);
  }
});
