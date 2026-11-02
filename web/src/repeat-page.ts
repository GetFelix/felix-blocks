// The tile repeat test scene: one 16 x 16 floor drawn two ways, as the single merged quad the mesher makes and as
// 256 separate one-block quads cut straight from the atlas, seen at a low angle so the mip level runs from the
// sharpest to the blurriest. scripts/check-chunks.mjs reads window.__repeatResult once window.__ready is true.
// ?gradients=0 wraps the tile coordinate before choosing the mip level, which must show seams.
import * as THREE from 'three';
import { atlasTexture, buildAtlas, tileUv } from './atlas';
import { loadTiles } from './assets';
import { loadBlockTable } from './core';
import { loadMesher, meshChunk, neighbourIndex } from './meshing';
import { passGeometry, useAtlas } from './terrain';

const TOLERANCE = 24;
const [WIDTH, HEIGHT] = [640, 480];

interface Result {
  quads: number;
  pixels: number;
  /** Pixels where the merged quad differs from the separate blocks. */
  bad: number;
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __repeatResult?: Result;
  }
}

const unwrappedGradients = new URLSearchParams(location.search).get('gradients') !== '0';
const result: Result = { quads: 0, pixels: 0, bad: 0, failures: [] };

async function run() {
  const table = await loadBlockTable();
  const ids = Object.fromEntries(table.blocks.map((b) => [b.name, b.id]));
  const atlas = buildAtlas(await loadTiles(table.tiles));
  await loadMesher();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0xff00ff);
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 200);
  camera.position.set(7.3, 2.2, 21);
  camera.lookAt(8.6, 0, 0);
  const texture = atlasTexture(atlas, 1);

  // The floor as the mesher makes it: a full layer of brick, with nothing known about the chunks around it.
  const floor = new Uint8Array(4096);
  floor.fill(ids.Brick!, 0, 256);
  const mesh = meshChunk(Array.from({ length: 27 }, (_, i) => (i === neighbourIndex(0, 0, 0) ? floor : null)))[0];
  result.quads = mesh.indices.length / 6;
  if (result.quads !== 1) result.failures.push(`the floor meshed to ${result.quads} quads, not 1`);
  const merged = new THREE.Scene();
  const material = useAtlas(new THREE.MeshBasicMaterial({ vertexColors: true }), texture, atlas.layout, table.tiles, {
    unwrappedGradients,
  });
  merged.add(new THREE.Mesh(passGeometry(mesh), material));

  // The same floor from one quad per block, each cut straight from the atlas.
  const tile = table.blocks.find((b) => b.name === 'Brick')!.top;
  const [u0, v0, u1, v1] = tileUv(atlas.layout, tile);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const base = positions.length / 3;
      for (const [a, c] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        positions.push(x + a, 1, z + c);
        uvs.push(u0 + a * (u1 - u0), v0 + (1 - c) * (v1 - v0));
      }
      // Wound to face up, like the mesher's.
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  const separate = new THREE.BufferGeometry();
  separate.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  separate.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  separate.setIndex(indices);
  const blocks = new THREE.Scene();
  blocks.add(new THREE.Mesh(separate, new THREE.MeshBasicMaterial({ map: texture })));

  const gl = renderer.getContext();
  const read = (scene: THREE.Scene) => {
    renderer.render(scene, camera);
    const px = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const expected = read(blocks);
  const actual = read(merged);
  for (let i = 0; i < actual.length; i += 4) {
    const covered = expected[i] !== 255 || expected[i + 1] !== 0 || expected[i + 2] !== 255;
    if (!covered) continue;
    result.pixels++;
    if ([0, 1, 2].some((c) => Math.abs(actual[i + c]! - expected[i + c]!) > TOLERANCE)) result.bad++;
  }
}

const status = document.getElementById('status')!;
run()
  .catch((e) => result.failures.push(String(e)))
  .finally(() => {
    const ok = result.failures.length === 0 && result.bad === 0;
    status.textContent = ok
      ? `one merged quad matches ${result.pixels} pixels of separate blocks`
      : [...result.failures, `${result.bad} of ${result.pixels} pixels differ`].join('; ');
    status.className = ok ? 'ok' : 'fail';
    window.__repeatResult = result;
    window.__ready = true;
  });
