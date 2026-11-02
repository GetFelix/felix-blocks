// The chunk test scene: a generated world meshed in the worker and drawn the way the game draws it, while the camera
// walks across chunk boundaries. scripts/check-chunks.mjs reads window.__chunksResult once window.__ready is true.
// ?inline=1 meshes on the page instead, to show what the worker saves. ?adapt=1 lets the frame time choose the view
// distance, starting at 8, and shows the debug panel; ?tier=N holds the view distance at N chunks; ?debug=1 shows the
// panel; ?slow=N adds N ms of work to every frame, to make it step down.
import * as THREE from 'three';
import { atlasTexture, buildAtlas } from './atlas';
import { loadTiles } from './assets';
import { ChunkView } from './chunk-view';
import { loadBlockTable } from './core';
import { Mesher } from './mesher';
import { loadMesher, meshChunk, meshedHere } from './meshing';
import { DebugOverlay } from './debug-overlay';
import { createLook } from './scene';
import { terrainMaterials, warmUp } from './terrain';
import { createGeneratedWorld, loadGenerator, terrainLayers } from './worldgen';
import { fogFor, MAX_TIER, MIN_TIER, ViewDistance } from './view-distance';

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
// The walk runs north along one line, a few chunks from the middle of a world.
const SEED = 7;
const WALK_X = 2061.5;
const WALK_FROM = 2160;
const WALK_TO = 2128;
const inline = params.get('inline') === '1';
const held = Number(params.get('tier') ?? NaN);
const fixedTier = Number.isFinite(held) ? Math.max(MIN_TIER, Math.min(MAX_TIER, Math.round(held))) : null;
// A held distance wins over adapting.
const adapt = params.get('adapt') === '1' && fixedTier === null;
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
  const atlas = buildAtlas(await loadTiles(table.tiles));
  await loadGenerator();
  const layers = terrainLayers();
  const world = createGeneratedWorld(SEED);

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
    layers,
  );

  const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
  // Fixed at 4 chunks unless asked otherwise, so the same walk loads the same chunks every time.
  const distance = new ViewDistance({ start: fixedTier ?? (adapt ? 8 : 4) });
  const overlay = new DebugOverlay();
  overlay.toggle(adapt || params.get('debug') === '1');
  const recent: number[] = [];
  const fog = scene.fog as THREE.Fog;
  const applyTier = () => Object.assign(fog, fogFor(distance.tier));
  applyTier();
  result.tiers.push(distance.tier);
  const eye = (x: number, z: number) => new THREE.Vector3(x, world.surface(x, z) + 1 + 1.62 + 4, z);
  // Looks ahead along the walk, at the ground there.
  const lookAhead = (z: number) => new THREE.Vector3(WALK_X + 3, world.surface(WALK_X, z - 24) + 1, z - 24);
  const place = (z: number) => {
    camera.position.copy(eye(WALK_X, z));
    camera.lookAt(lookAhead(z));
    look.followWithShadow(camera.position);
  };

  // Load what is around the start, then walk north so new chunks stream in at every boundary.
  place(WALK_FROM);
  view.update(camera.position, distance.tier);
  while (view.pending > 0) await frame();
  warmUp(renderer, scene, camera, materials);
  // The first frame uploads everything loaded so far, which is the loading screen's job and not the walk's.
  renderer.render(scene, camera);
  await frame();

  // One frame's bookkeeping, for the walk and for the live page after it. True if the view distance moved.
  const tick = (delta: number) => {
    recent.push(delta);
    if (recent.length > 30) recent.shift();
    const changed = adapt && distance.record(delta, view.pending) !== null;
    if (changed) applyTier();
    overlay.update({
      tier: distance.tier,
      fps: 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length),
      loaded: view.loadedChunks,
      meshing: view.pending,
      changes: distance.changes,
    });
    return changed;
  };
  const busy = () => {
    for (const start = performance.now(); performance.now() - start < slow; );
  };

  let frames = 0;
  let last = await frame();
  for (let z = WALK_FROM; z >= WALK_TO; z -= 0.4) {
    place(z);
    view.update(camera.position, distance.tier);
    renderer.render(scene, camera);
    busy();
    const now = await frame();
    frames++;
    const delta = now - last;
    last = now;
    if (tick(delta)) result.tiers.push(distance.tier);
  }
  while (view.pending > 0) await frame();
  place(WALK_TO);
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
      for (let cy = 0; cy < layers; cy++) {
        if ((cx - px) ** 2 + (cz - pz) ** 2 > RADIUS * RADIUS || !world.chunk(cx, cy, cz)) continue;
        result.wanted++;
        if (view.has(cx, cy, cz)) result.drawn++;
      }
  if (result.drawn !== result.wanted)
    result.failures.push(`${result.drawn} of ${result.wanted} chunks in range are drawn`);
  if (view.stats.meshed === 0) result.failures.push('no chunk was meshed');
  if (view.loadedChunks === 0) result.failures.push('nothing was drawn');

  // The scripted walk is over, so the camera stays where it ended. The page keeps drawing, and keeps adapting and
  // updating the panel for anyone looking at it; the result above is already final and is not touched again.
  let prev = 0;
  const live = (now: number) => {
    // The first frame after the walk's waiting loops has no meaningful delta.
    if (prev > 0 && tick(now - prev)) view.update(camera.position, distance.tier);
    prev = now;
    renderer.render(scene, camera);
    busy();
    requestAnimationFrame(live);
  };
  requestAnimationFrame(live);
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
