// The atlas test scene: every tile at a distance, trilinear filtered, and a count of pixels that differ
// from the same tile drawn from a texture of its own. scripts/check-atlas.mjs reads window.__atlasResult once window.__ready is true.
// ?pad=N builds the atlas with N pixels of padding, so the check can show that too little lets neighbours bleed in.
import * as THREE from 'three';
import { loadTiles, TILE_SIZE } from './assets';
import { atlasTexture, buildAtlas, PAD, tileUv, type Atlas } from './atlas';
import { loadBlockTable } from './core';

/** On-screen sizes in pixels, not powers of two: at exactly 128 / 2^n a pixel centre lands on a texel centre and nothing bleeds. */
const SIZES = [60, 44, 28, 12];
const GAP = 4;
/** Smeared edge pixels are not quite a clamped mip edge, and the tiles have hard edges, so a little difference is expected. */
const TOLERANCE = 24;

interface Result {
  pad: number;
  tiles: number;
  quads: number;
  bad: { tile: string; size: number; pixels: number }[];
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __atlasResult?: Result;
  }
}

const pad = Number(new URLSearchParams(location.search).get('pad') ?? PAD);
const result: Result = { pad, tiles: 0, quads: 0, bad: [], failures: [] };

/** The tile alone in its own texture, clamped at the edges: what the atlas has to look like at every distance. */
function aloneMaterial(atlas: Atlas, name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  canvas.getContext('2d')!.putImageData(new ImageData(atlas.tiles.get(name)!, TILE_SIZE, TILE_SIZE), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return new THREE.MeshBasicMaterial({ map: texture });
}

function quad(uv: readonly number[], size: number, x: number, y: number, material: THREE.Material) {
  const [u0, v0, u1, v1] = uv as [number, number, number, number];
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x + size / 2, y + size / 2, 0);
  return mesh;
}

async function run() {
  const table = await loadBlockTable();
  const atlas = buildAtlas(await loadTiles(table.tiles), pad);
  result.tiles = table.tiles.length;

  const width = GAP + table.tiles.length * (SIZES[0]! + GAP);
  const height = GAP + SIZES.reduce((h, s) => h + s + GAP, 0);
  const canvas = document.getElementById('strip') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0xff00ff);

  // The same quads twice: cut out of the atlas, and from a texture of the tile alone.
  const atlasMaterial = new THREE.MeshBasicMaterial({ map: atlasTexture(atlas, 1) });
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1, 1);
  const rects: { tile: string; size: number; x: number; y: number }[] = [];
  const fromAtlas = new THREE.Scene();
  const alone = new THREE.Scene();
  let y = GAP;
  for (const size of SIZES) {
    table.tiles.forEach((tile, i) => {
      const x = GAP + i * (SIZES[0]! + GAP);
      fromAtlas.add(quad(tileUv(atlas.layout, tile), size, x, y, atlasMaterial));
      alone.add(quad([0, 0, 1, 1], size, x, y, aloneMaterial(atlas, tile)));
      rects.push({ tile, size, x, y });
    });
    y += size + GAP;
  }
  const gl = renderer.getContext();
  const read = (scene: THREE.Scene) => {
    renderer.render(scene, camera);
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const expected = read(alone);
  const px = read(fromAtlas);

  for (const r of rects) {
    let pixels = 0;
    for (let yy = r.y; yy < r.y + r.size; yy++) {
      for (let xx = r.x; xx < r.x + r.size; xx++) {
        const i = (yy * width + xx) * 4;
        for (let c = 0; c < 3; c++) {
          if (Math.abs(px[i + c]! - expected[i + c]!) > TOLERANCE) {
            pixels++;
            break;
          }
        }
      }
    }
    result.quads++;
    if (pixels) result.bad.push({ tile: r.tile, size: r.size, pixels });
  }

  const img = new Image();
  img.src = atlas.canvas.toDataURL();
  img.alt = 'the atlas';
  document.getElementById('atlas')!.append(img);
}

const status = document.getElementById('status')!;
run()
  .catch((e) => result.failures.push(String(e)))
  .finally(() => {
    const ok = result.failures.length === 0 && result.bad.length === 0;
    status.textContent = ok
      ? `${result.tiles} tiles, ${result.quads} quads, no bleeding (padding ${pad} px)`
      : [...result.failures, ...result.bad.map((b) => `${b.tile} at ${b.size} px: ${b.pixels} bad pixels`)].join('; ');
    status.className = ok ? 'ok' : 'fail';
    window.__atlasResult = result;
    window.__ready = true;
  });
