// The chunk test scene: a made-up world meshed in the worker and drawn the way the game draws it, while the camera
// walks across chunk boundaries. scripts/check-chunks.mjs reads window.__chunksResult once window.__ready is true.
// ?inline=1 meshes on the page instead, to show what the worker saves. ?adapt=1 lets the frame time choose the view
// distance and shows the debug panel; ?slow=N adds N ms of work to every frame, to make it step down.
import * as THREE from 'three';
import { atlasTexture, buildAtlas } from './atlas';
import { loadTiles } from './assets';
import { ChunkView } from './chunk-view';
import { loadBlockTable } from './core';
import { createFixtureWorld } from './fixture-world';
import { Mesher } from './mesher';
import { loadMesher, meshChunk, meshedHere } from './meshing';
import { DebugOverlay } from './debug-overlay';
import { createLook } from './scene';
import { terrainMaterials, warmUp } from './terrain';
import { fogFor, ViewDistance } from './view-distance';

interface Result {
  mode: 'worker' | 'inline';
  chunks: number;
  frames: number;
  /** Time the page spent per chunk turning a result into meshes. */
  applyMs: { p50: number; p95: number; max: number };
  /** Time spent meshing per chunk, in the worker or on the page. */
  meshMs: { p50: number; p95: number; max: number };
  /** What the page meshed on its own thread: nothing at all when the workers do it. */
  onPage: { calls: number; ms: number };
  /** Chunks in range of the last position that have a result to draw, and how many of them are drawn. */
  wanted: number;
  drawn: number;
  /** The view distance at the start and after each change. */
  tiers: number[];
  /** The debug panel's text at the end. */
  panel: string;
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __chunksResult?: Result;
  }
}

const params = new URLSearchParams(location.search);
const inline = params.get('inline') === '1';
const adapt = params.get('adapt') === '1';
const slow = Number(params.get('slow') ?? 0);
const result: Result = {
  mode: inline ? 'inline' : 'worker',
  chunks: 0,
  frames: 0,
  applyMs: { p50: 0, p95: 0, max: 0 },
  meshMs: { p50: 0, p95: 0, max: 0 },
  onPage: { calls: 0, ms: 0 },
  wanted: 0,
  drawn: 0,
  tiers: [],
  panel: '',
  failures: [],
};

const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: s.at(-1) ?? 0 };
};

/** Meshes on the page, one job per timer tick, so the cost lands on the main thread. */
function inlineMesher(): Pick<Mesher, 'request' | 'cancel' | 'prioritize' | 'queued' | 'busy'> {
  return {
    queued: 0,
    busy: 0,
    cancel() {},
    prioritize: () => false,
    request(_key: string, chunks: Parameters<typeof meshChunk>[0]) {
      return new Promise<{ data: ReturnType<typeof meshChunk>; ms: number } | null>((resolve) =>
        setTimeout(() => {
          const start = performance.now();
          const data = meshChunk(chunks);
          resolve({ data, ms: performance.now() - start });
        }, 0),
      );
    },
  };
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
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 900);
  const size = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  };
  size();
  window.addEventListener('resize', size);

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
  // Fixed at 4 chunks unless the frame time is in charge, so the same walk loads the same chunks every time.
  const distance = new ViewDistance({ start: adapt ? 8 : 4 });
  const overlay = new DebugOverlay();
  overlay.toggle(adapt || params.get('debug') === '1');
  const deltas: number[] = [];
  const fog = scene.fog as THREE.Fog;
  const applyTier = () => Object.assign(fog, fogFor(distance.tier));
  applyTier();
  result.tiers.push(distance.tier);
  const eye = (x: number, z: number) => new THREE.Vector3(x, world.surface(x, z) + 1 + 1.62 + 4, z);
  const look_at = new THREE.Vector3(64, 21, 64);
  const place = (z: number) => {
    camera.position.copy(eye(61.5, z));
    camera.lookAt(look_at);
    look.followWithShadow(camera.position);
  };

  // Load what is around the start, then walk toward the house so new chunks stream in at every boundary.
  place(112);
  view.update(camera.position, distance.tier);
  while (view.pending > 0) await frame();
  warmUp(renderer, scene, camera, materials);
  // The first frame uploads everything loaded so far, which is the loading screen's job and not the walk's.
  renderer.render(scene, camera);
  await frame();

  let frames = 0;
  let last = await frame();
  for (let z = 112; z >= 80; z -= 0.4) {
    place(z);
    view.update(camera.position, distance.tier);
    renderer.render(scene, camera);
    for (const start = performance.now(); performance.now() - start < slow; );
    const now = await frame();
    frames++;
    const delta = now - last;
    last = now;
    deltas.push(delta);
    if (adapt && distance.record(delta)) {
      applyTier();
      result.tiers.push(distance.tier);
    }
    const recent = deltas.slice(-30);
    overlay.update({
      tier: distance.tier,
      fps: 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length),
      loaded: view.loadedChunks,
      meshing: view.pending,
      changes: distance.changes,
    });
  }
  while (view.pending > 0) await frame();
  place(80);
  view.update(camera.position, distance.tier);
  while (view.pending > 0) await frame();
  renderer.render(scene, camera);

  result.chunks = view.stats.meshed;
  result.frames = frames;
  result.panel = overlay.element.textContent ?? '';
  result.applyMs = summary(view.stats.applyMs);
  result.meshMs = summary(view.stats.meshMs);
  result.onPage = { calls: meshedHere.calls, ms: meshedHere.ms };
  // Everything within range of where the walk ended has to be on screen, however the requests raced on the way.
  const RADIUS = distance.tier;
  const [px, pz] = [Math.floor(camera.position.x / 16), Math.floor(camera.position.z / 16)];
  for (let cz = pz - RADIUS; cz <= pz + RADIUS; cz++)
    for (let cx = px - RADIUS; cx <= px + RADIUS; cx++)
      for (let cy = 0; cy < world.size[1]; cy++) {
        if ((cx - px) ** 2 + (cz - pz) ** 2 > RADIUS * RADIUS || !world.chunk(cx, cy, cz)) continue;
        result.wanted++;
        if (view.has(cx, cy, cz)) result.drawn++;
      }
  if (result.drawn !== result.wanted)
    result.failures.push(`${result.drawn} of ${result.wanted} chunks in range are drawn`);
  if (view.stats.meshed === 0) result.failures.push('no chunk was meshed');
  if (view.loadedChunks === 0) result.failures.push('nothing was drawn');

  // The scripted walk is over, so the camera stays where it ended; the page keeps drawing for anyone looking at it.
  const live = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(live);
  };
  live();
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
