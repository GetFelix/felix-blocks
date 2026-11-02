// The tile repeat test scene. A merged quad has to look like the separate one-block quads it replaces, seen at a low
// angle so the mip level runs from the sharpest to the blurriest. Two shapes: a 16 x 16 floor, and a wall (a 14 x 3
// side facing -z, a 2 x 3 end facing +x, and the top) whose quads are not square. Each is drawn as the mesher's merged
// quads and as unit blocks cut straight from the atlas. scripts/check-chunks.mjs reads window.__repeatResult once
// window.__ready is true. ?gradients=0 wraps the tile coordinate before choosing the mip level, which must show seams.
import * as THREE from 'three';
import { atlasTexture, buildAtlas, tileUv } from './atlas';
import { loadTiles } from './assets';
import { loadBlockTable } from './core';
import { loadMesher, meshChunk, neighbourIndex, type ChunkNeighbourhood, type PassMesh } from './meshing';
import { passGeometry, useAtlas } from './terrain';

const TOLERANCE = 24;
const [WIDTH, HEIGHT] = [640, 480];

interface ViewResult {
  name: string;
  /** Quads the mesher made for the shape. */
  quads: number;
  pixels: number;
  /** Pixels where the merged quads differ from the separate blocks. */
  bad: number;
}

interface Result {
  views: ViewResult[];
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __repeatResult?: Result;
  }
}

const unwrappedGradients = new URLSearchParams(location.search).get('gradients') !== '0';
const result: Result = { views: [], failures: [] };

const cell = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;
const around = (chunk: Uint8Array): ChunkNeighbourhood =>
  Array.from({ length: 27 }, (_, i) => (i === neighbourIndex(0, 0, 0) ? chunk : null));

async function run() {
  const table = await loadBlockTable();
  const atlas = buildAtlas(await loadTiles(table.tiles));
  await loadMesher();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0xff00ff);
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 200);
  // The real anisotropy, as the game uses: it changes which mip level a stretched pixel takes.
  const texture = atlasTexture(atlas, renderer.capabilities.getMaxAnisotropy());
  const brick = table.blocks.find((b) => b.name === 'Brick')!;
  const material = useAtlas(new THREE.MeshBasicMaterial({ vertexColors: true }), texture, atlas.layout, table.tiles, {
    unwrappedGradients,
  });
  const gl = renderer.getContext();
  const read = (scene: THREE.Scene) => {
    renderer.render(scene, camera);
    const px = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const compare = (name: string, merged: PassMesh, separate: THREE.BufferGeometry) => {
    const a = new THREE.Scene();
    a.add(new THREE.Mesh(passGeometry(merged), material));
    const b = new THREE.Scene();
    b.add(new THREE.Mesh(separate, new THREE.MeshBasicMaterial({ map: texture })));
    const actual = read(a);
    const expected = read(b);
    const view: ViewResult = { name, quads: merged.indices.length / 6, pixels: 0, bad: 0 };
    for (let i = 0; i < actual.length; i += 4) {
      if (expected[i] === 255 && expected[i + 1] === 0 && expected[i + 2] === 255) continue;
      view.pixels++;
      if ([0, 1, 2].some((c) => Math.abs(actual[i + c]! - expected[i + c]!) > TOLERANCE)) view.bad++;
    }
    result.views.push(view);
    return view;
  };

  // The floor: a full layer of brick, which the mesher makes into one quad. The separate blocks are written out here
  // from the atlas, with no help from the mesher.
  camera.position.set(7.3, 2.2, 21);
  camera.lookAt(8.6, 0, 0);
  const floor = new Uint8Array(4096);
  floor.fill(brick.id, 0, 256);
  const [u0, v0, u1, v1] = tileUv(atlas.layout, brick.top);
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
  const blocks = new THREE.BufferGeometry();
  blocks.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  blocks.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  blocks.setIndex(indices);
  const flat = compare('floor', meshChunk(around(floor))[0], blocks);
  if (flat.quads !== 1) result.failures.push(`the floor meshed to ${flat.quads} quads, not 1`);

  // The wall: its separate blocks are the mesher's own unit block, copied to every cell, so each side face keeps the
  // orientation the mesher gives it.
  const wallCells: [number, number, number][] = [];
  for (let y = 4; y < 7; y++) for (let z = 7; z < 9; z++) for (let x = 1; x < 15; x++) wallCells.push([x, y, z]);
  const wall = new Uint8Array(4096);
  for (const [x, y, z] of wallCells) wall[cell(x, y, z)] = brick.id;
  const unit = new Uint8Array(4096);
  unit[cell(8, 8, 8)] = brick.id;
  const one = meshChunk(around(unit))[0];
  const pos: number[] = [];
  const atlasUv: number[] = [];
  const idx: number[] = [];
  for (const [x, y, z] of wallCells) {
    const base = pos.length / 3;
    for (let i = 0; i < one.positions.length; i += 3)
      pos.push(one.positions[i]! + x - 8, one.positions[i + 1]! + y - 8, one.positions[i + 2]! + z - 8);
    for (let i = 0; i < one.tiles.length; i++) {
      const [a, b, c, d] = tileUv(atlas.layout, table.tiles[one.tiles[i]!]!);
      atlasUv.push(a + one.uvs[i * 2]! * (c - a), b + one.uvs[i * 2 + 1]! * (d - b));
    }
    for (const i of one.indices) idx.push(base + i);
  }
  const wallBlocks = new THREE.BufferGeometry();
  wallBlocks.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallBlocks.setAttribute('uv', new THREE.Float32BufferAttribute(atlasUv, 2));
  wallBlocks.setIndex(idx);
  camera.position.set(28, 8.5, -12);
  camera.lookAt(8, 5.5, 7.5);
  const merged = meshChunk(around(wall))[0];
  const shape = Array.from({ length: merged.indices.length / 6 }, (_, q) => {
    const u = [0, 1, 2, 3].map((v) => merged.uvs[(q * 4 + v) * 2]!);
    const v = [0, 1, 2, 3].map((w) => merged.uvs[(q * 4 + w) * 2 + 1]!);
    return [Math.max(...u) - Math.min(...u), Math.max(...v) - Math.min(...v)].sort((a, b) => b - a).join('x');
  });
  for (const want of ['14x3', '3x2'])
    if (!shape.includes(want)) result.failures.push(`the wall has no ${want} quad, only ${shape.join(', ')}`);
  compare('wall', merged, wallBlocks);
}

const status = document.getElementById('status')!;
run()
  .catch((e) => result.failures.push(String(e)))
  .finally(() => {
    const bad = result.views.reduce((n, v) => n + v.bad, 0);
    const pixels = result.views.reduce((n, v) => n + v.pixels, 0);
    // A few pixels always land a rounding step apart, so judging the difference is the check script's job.
    const ok = result.failures.length === 0;
    status.textContent = ok ? `${bad} of ${pixels} pixels differ from separate blocks` : result.failures.join('; ');
    status.className = ok ? 'ok' : 'fail';
    window.__repeatResult = result;
    window.__ready = true;
  });
