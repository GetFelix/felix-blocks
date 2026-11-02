// The chunk test scene: a made-up world meshed in the worker and drawn the way the game draws it, while the camera
// walks across chunk boundaries. scripts/check-chunks.mjs reads window.__chunksResult once window.__ready is true.
// ?inline=1 meshes on the page instead, to show what the worker saves.
import * as THREE from 'three';
import { atlasTexture, buildAtlas } from './atlas';
import { loadTiles } from './assets';
import { ChunkView } from './chunk-view';
import { loadBlockTable } from './core';
import { createFixtureWorld } from './fixture-world';
import { Mesher } from './mesher';
import { loadMesher, meshChunk } from './meshing';
import { createLook } from './scene';
import { terrainMaterials, warmUp } from './terrain';

interface Result {
  mode: 'worker' | 'inline';
  chunks: number;
  frames: number;
  /** Time the page spent per chunk turning a result into meshes. */
  applyMs: { p50: number; p95: number; max: number };
  /** Time spent meshing per chunk, in the worker or on the page. */
  meshMs: { p50: number; p95: number; max: number };
  /** Milliseconds the page was blocked by meshing itself: zero when a worker does it. */
  blockedMs: number;
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __chunksResult?: Result;
  }
}

const inline = new URLSearchParams(location.search).get('inline') === '1';
const result: Result = {
  mode: inline ? 'inline' : 'worker',
  chunks: 0,
  frames: 0,
  applyMs: { p50: 0, p95: 0, max: 0 },
  meshMs: { p50: 0, p95: 0, max: 0 },
  blockedMs: 0,
  failures: [],
};

const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: s.at(-1) ?? 0 };
};

/** Meshes on the page, one job per timer tick, so the cost lands on the main thread. */
function inlineMesher(): Pick<Mesher, 'request' | 'cancel' | 'queued' | 'busy'> & { blocked: number } {
  const self = {
    blocked: 0,
    queued: 0,
    busy: 0,
    cancel() {},
    request(_key: string, chunks: Parameters<typeof meshChunk>[0]) {
      return new Promise<{ data: ReturnType<typeof meshChunk>; ms: number } | null>((resolve) =>
        setTimeout(() => {
          const start = performance.now();
          const data = meshChunk(chunks);
          const ms = performance.now() - start;
          self.blocked += ms;
          resolve({ data, ms });
        }, 0),
      );
    },
  };
  return self;
}

async function run() {
  const table = await loadBlockTable();
  const ids = Object.fromEntries(table.blocks.map((b) => [b.name, b.id]));
  const atlas = buildAtlas(await loadTiles(table.tiles));
  const world = createFixtureWorld(ids);

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const look = createLook(canvas);
  const { renderer, scene } = look;
  renderer.setPixelRatio(1);
  const size = () => renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  size();
  const camera = new THREE.PerspectiveCamera(72, canvas.clientWidth / canvas.clientHeight, 0.05, 900);

  const texture = atlasTexture(atlas, renderer.capabilities.getMaxAnisotropy());
  const materials = terrainMaterials(texture, atlas.layout, table.tiles);

  let mesher: ReturnType<typeof inlineMesher> | Mesher;
  if (inline) {
    await loadMesher();
    mesher = inlineMesher();
  } else {
    mesher = new Mesher();
  }
  const view = new ChunkView(
    scene,
    mesher,
    materials,
    (cx, cy, cz) => (world.chunk(cx, cy, cz) ? world.neighbourhood(cx, cy, cz) : null),
    world.size[1],
  );

  const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
  const RADIUS = 4;
  const eye = (x: number, z: number) => new THREE.Vector3(x, world.surface(x, z) + 1 + 1.62 + 4, z);
  const look_at = new THREE.Vector3(64, 21, 64);
  const place = (z: number) => {
    camera.position.copy(eye(61.5, z));
    camera.lookAt(look_at);
    look.followWithShadow(camera.position);
  };

  // Load what is around the start, then walk toward the house so new chunks stream in at every boundary.
  place(112);
  view.update(camera.position, RADIUS);
  while (view.pending > 0) await frame();
  warmUp(renderer, scene, camera, materials);
  // The first frame uploads everything loaded so far, which is the loading screen's job and not the walk's.
  renderer.render(scene, camera);
  await frame();

  let frames = 0;
  for (let z = 112; z >= 80; z -= 0.4) {
    place(z);
    view.update(camera.position, RADIUS);
    renderer.render(scene, camera);
    await frame();
    frames++;
  }
  while (view.pending > 0) await frame();
  place(80);
  renderer.render(scene, camera);

  result.chunks = view.stats.meshed;
  result.frames = frames;
  result.applyMs = summary(view.stats.applyMs);
  result.meshMs = summary(view.stats.meshMs);
  result.blockedMs = 'blocked' in mesher ? mesher.blocked : 0;
  if (view.stats.meshed === 0) result.failures.push('no chunk was meshed');
  if (view.loadedChunks === 0) result.failures.push('nothing was drawn');
  if (mesher instanceof Mesher) mesher.dispose();
}

const status = document.getElementById('status')!;
run()
  .catch((e) => result.failures.push(String(e)))
  .finally(() => {
    const ok = result.failures.length === 0;
    status.textContent = ok
      ? `${result.chunks} chunks meshed ${inline ? 'on the page' : 'in workers'}, ${result.frames} frames walked`
      : result.failures.join('; ');
    status.className = ok ? 'ok' : 'fail';
    window.__chunksResult = result;
    window.__ready = true;
  });
