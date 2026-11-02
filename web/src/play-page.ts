// The game page so far: a generated world you walk through. ?seed=N picks the terrain (7 by default), ?debug=1 shows
// the view distance panel. scripts/check-play.mjs reads window.__play once window.__ready is true.
import * as THREE from 'three';
import { atlasTexture, buildAtlas } from './atlas';
import { loadTiles } from './assets';
import { ChunkView } from './chunk-view';
import { Controls } from './controls';
import { loadBlockTable } from './core';
import { DebugOverlay } from './debug-overlay';
import { Mesher } from './mesher';
import { Player } from './player';
import { createLook } from './scene';
import { blocksOf, solidTable, waterIds } from './solid';
import { terrainMaterials, warmUp } from './terrain';
import { fogFor, ViewDistance } from './view-distance';
import { createGeneratedWorld, loadGenerator, terrainLayers, worldChunks } from './worldgen';

declare global {
  interface Window {
    __ready?: boolean;
    /** The player's state, for the check script. */
    __play?: () => { x: number; y: number; z: number; onGround: boolean; flying: boolean; frames: number };
  }
}

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const status = document.getElementById('status')!;
const hint = document.getElementById('hint')!;

async function run() {
  const table = await loadBlockTable();
  const atlas = buildAtlas(await loadTiles(table.tiles));
  await loadGenerator();
  const world = createGeneratedWorld(seed);
  const [wx, wy, wz] = Array.from(worldChunks()) as [number, number, number];
  const blocks = blocksOf(world, [wx, wy, wz]);

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const look = createLook(canvas);
  const { renderer, scene } = look;
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 900);
  const size = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  };
  size();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  addEventListener('resize', size);

  const materials = terrainMaterials(
    atlasTexture(atlas, renderer.capabilities.getMaxAnisotropy()),
    atlas.layout,
    table.tiles,
  );
  const view = new ChunkView(
    scene,
    new Mesher(),
    materials,
    (cx, cy, cz) => (world.chunk(cx, cy, cz) ? world.neighbourhood(cx, cy, cz) : null),
    terrainLayers(),
  );
  const distance = new ViewDistance({ start: 8 });
  const overlay = new DebugOverlay();
  overlay.toggle(params.get('debug') === '1');
  const fog = scene.fog as THREE.Fog;
  Object.assign(fog, fogFor(distance.tier));

  // The middle of the world, dropped from above the highest ground onto whatever is there.
  const player = new Player(wx * 8 + 0.5, wy * 16 - 100, wz * 8 + 0.5, solidTable(table), waterIds(table));
  const controls = new Controls(window, canvas);
  const frames = { count: 0 };
  window.__play = () => ({
    x: player.x,
    y: player.y,
    z: player.z,
    onGround: player.onGround,
    flying: player.flying,
    frames: frames.count,
  });
  document.addEventListener('pointerlockchange', () =>
    hint.classList.toggle('hidden', document.pointerLockElement === canvas),
  );

  const recent: number[] = [];
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let last = performance.now();
  const frame = (now: number) => {
    const delta = now - last;
    last = now;
    frames.count++;
    if (controls.takeFlyToggle()) player.toggleFlying();
    player.update(Math.min(delta / 1000, 0.1), controls.sample(), blocks);

    camera.position.set(player.x, player.eyeY, player.z);
    euler.set(controls.pitch, controls.yaw, 0);
    camera.quaternion.setFromEuler(euler);
    look.followWithShadow(camera.position);
    view.update(camera.position, distance.tier);

    recent.push(delta);
    if (recent.length > 30) recent.shift();
    if (distance.record(delta, view.pending) !== null) Object.assign(fog, fogFor(distance.tier));
    overlay.update({
      tier: distance.tier,
      fps: 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length),
      loaded: view.loadedChunks,
      meshing: view.pending,
      changes: distance.changes,
    });
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };

  // Load what is around the start before the first frame, so the player does not fall through a blank world.
  camera.position.set(player.x, player.eyeY, player.z);
  view.update(camera.position, distance.tier);
  while (view.pending > 0) await new Promise((r) => requestAnimationFrame(r));
  warmUp(renderer, scene, camera, materials);
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
  });
}

run()
  .then(() => {
    status.textContent = `world ${seed}`;
    status.className = 'ok';
  })
  .catch((e) => {
    status.textContent = String(e);
    status.className = 'fail';
  })
  .finally(() => {
    window.__ready = true;
  });
