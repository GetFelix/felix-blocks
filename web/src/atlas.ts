// The block atlas: every tile in one texture, with padding so mipmaps never pull a neighbour's colour into a tile.
// The layout and the pixels are plain arithmetic on bytes; only decoding the PNGs and the texture touch the browser.
import * as THREE from 'three';
import { TILE_SIZE } from './assets';
import { TILE_STYLES } from './palette';
import { restyle } from './tiles';

/**
 * Pixels of edge colour around each tile. A tile is 128 px, so mip levels 1 to 3 (64, 32 and 16 px) shrink the
 * border to 8, 4 and 2 px and 16 px covers the first four levels, past which a tile is a few pixels on screen.
 */
export const PAD = 16;
const COLUMNS = 8;

export interface AtlasLayout {
  width: number;
  height: number;
  pad: number;
  /** Top left corner of each tile's own pixels. */
  origin: Map<string, { x: number; y: number }>;
}

export function layoutAtlas(names: readonly string[], pad = PAD): AtlasLayout {
  const cell = TILE_SIZE + 2 * pad;
  const origin = new Map<string, { x: number; y: number }>();
  names.forEach((name, i) => {
    origin.set(name, { x: (i % COLUMNS) * cell + pad, y: Math.floor(i / COLUMNS) * cell + pad });
  });
  return { width: COLUMNS * cell, height: Math.ceil(names.length / COLUMNS) * cell, pad, origin };
}

/** The tile's texture coordinates as [u0, v0, u1, v1], with v counted up from the bottom of the atlas. */
export function tileUv(layout: AtlasLayout, name: string): [number, number, number, number] {
  const o = layout.origin.get(name);
  if (!o) throw new Error(`no tile named ${name} in the atlas`);
  const { width, height } = layout;
  return [o.x / width, 1 - (o.y + TILE_SIZE) / height, (o.x + TILE_SIZE) / width, 1 - o.y / height];
}

/**
 * Lays styled tiles out as RGBA bytes. Each tile's edge pixels are copied outward into its padding, and each
 * corner pixel into the corner of the padding.
 */
export function packAtlas(tiles: ReadonlyMap<string, Uint8ClampedArray>, layout: AtlasLayout): Uint8ClampedArray {
  const { width, height, pad } = layout;
  const out = new Uint8ClampedArray(width * height * 4);
  const T = TILE_SIZE;
  for (const [name, px] of tiles) {
    const o = layout.origin.get(name);
    if (!o) throw new Error(`no tile named ${name} in the atlas`);
    for (let y = -pad; y < T + pad; y++) {
      const sy = Math.max(0, Math.min(T - 1, y));
      for (let x = -pad; x < T + pad; x++) {
        const sx = Math.max(0, Math.min(T - 1, x));
        const from = (sy * T + sx) * 4;
        const to = ((o.y + y) * width + o.x + x) * 4;
        out.set(px.subarray(from, from + 4), to);
      }
    }
  }
  return out;
}

export interface Atlas {
  layout: AtlasLayout;
  /** The atlas as a canvas, for looking at. */
  canvas: HTMLCanvasElement;
  /** Each tile after restyling, as RGBA bytes. */
  tiles: Map<string, Uint8ClampedArray>;
}

function pixelsOf(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = c.height = TILE_SIZE;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
}

/** Restyles the tiles from the palette and packs them. `pad` is only changed by the test that checks it matters. */
export function buildAtlas(images: ReadonlyMap<string, HTMLImageElement>, pad = PAD): Atlas {
  const names = [...images.keys()];
  const layout = layoutAtlas(names, pad);
  const tiles = new Map<string, Uint8ClampedArray>();
  for (const [name, img] of images) {
    const px = pixelsOf(img);
    restyle(px, TILE_STYLES[name]);
    tiles.set(name, px);
  }
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const data = new ImageData(packAtlas(tiles, layout), layout.width, layout.height);
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return { layout, canvas, tiles };
}

/** Crisp up close, mipmapped for distance. */
export function atlasTexture(atlas: Atlas, maxAnisotropy = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(atlas.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = maxAnisotropy;
  return texture;
}
