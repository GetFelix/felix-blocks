// Restyling a tile, on RGBA bytes so it works the same in every browser and can be tested without a canvas.
import type { TileStyle } from './palette';

type Rgb = readonly [number, number, number];

const clamp = (v: number) => Math.max(0, Math.min(255, v));

/**
 * Recolours the green pixels of a tile by brightness. Brighter greens stay brighter, so the tile keeps its
 * texture and only its hue moves to `colour`. Pixels that are not green, or are transparent, are left alone.
 */
export function tintGreens(px: Uint8ClampedArray, colour: Rgb): void {
  const isGreen = (i: number) => px[i + 3]! > 0 && px[i + 1]! > px[i]! + 12 && px[i + 1]! > px[i + 2]!;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (isGreen(i)) {
      sum += px[i + 1]!;
      n++;
    }
  }
  const mean = sum / Math.max(n, 1);
  for (let i = 0; i < px.length; i += 4) {
    if (!isGreen(i)) continue;
    const k = Math.pow(px[i + 1]! / mean, 1.4);
    for (let c = 0; c < 3; c++) px[i + c] = clamp(colour[c]! * k);
  }
}

/** The CSS `saturate()` filter. 1 leaves the tile as it is and 0 turns it grey. */
export function saturate(px: Uint8ClampedArray, s: number): void {
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!];
    px[i] = clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b);
    px[i + 1] = clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b);
    px[i + 2] = clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b);
  }
}

/** The CSS `brightness()` filter. */
export function brighten(px: Uint8ClampedArray, k: number): void {
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = clamp(px[i + c]! * k);
}

/** Draws `[r, g, b, alpha]` behind the tile, keeping the tile in front. */
export function underlay(px: Uint8ClampedArray, [r, g, b, alpha]: readonly [number, number, number, number]): void {
  for (let i = 0; i < px.length; i += 4) {
    const front = px[i + 3]! / 255;
    const out = front + alpha * (1 - front);
    const behind = (alpha * (1 - front)) / out;
    px[i] = clamp(px[i]! * (1 - behind) + r * behind);
    px[i + 1] = clamp(px[i + 1]! * (1 - behind) + g * behind);
    px[i + 2] = clamp(px[i + 2]! * (1 - behind) + b * behind);
    px[i + 3] = Math.round(out * 255);
  }
}

/** Applies a tile's style, in place: tint, then saturation, then brightness, then the underlay. */
export function restyle(px: Uint8ClampedArray, style: TileStyle | undefined): void {
  if (!style) return;
  if (style.tint) tintGreens(px, style.tint);
  if (style.saturate !== undefined) saturate(px, style.saturate);
  if (style.brightness !== undefined) brighten(px, style.brightness);
  if (style.underlay) underlay(px, style.underlay);
}
