// The game page: a generated world you walk through and build in. Left click digs, right click places the block picked
// with 1 to 9 or the wheel. ?seed=N picks the terrain (7 by default), ?debug=1 shows the view distance panel.
// With ?gateway=ws://...&world=NAME&token=ID_TOKEN the edits are saved to that world in Felix; without it they are
// not saved. (There is no sign-in page yet: on the dev stack `curl 'http://127.0.0.1:9400/token?sub=ana&aud=felix-blocks'`
// mints a token.)
// scripts/check-play.mjs reads window.__play once window.__ready is true.
import * as THREE from 'three';
import { atlasTexture, buildAtlas } from './atlas';
import { loadTiles } from './assets';
import { ChunkView } from './chunk-view';
import { Controls, SLOTS } from './controls';
import { loadBlockTable } from './core';
import { DebugOverlay } from './debug-overlay';
import { EditableWorld } from './editable-world';
import { EditSync } from './edit-sync';
import { GatewayClient } from 'felix-gateway-client';
import { Mesher } from './mesher';
import { HALF_WIDTH, HEIGHT, Player } from './player';
import { blocksPlayer, lookDirection, raycast, REACH, targetTable } from './raycast';
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
    /** Block reads and edits, for the check scripts (headless Chromium has no pointer lock for clicks). */
    __edit?: {
      block(x: number, y: number, z: number): number;
      set(x: number, y: number, z: number, id: number): boolean;
      /** Resolves once every edit has reached Felix. */
      saved(): Promise<void>;
      /** Whether the page is saving to a world. */
      saving: boolean;
    };
  }
}

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const status = document.getElementById('status')!;
const hint = document.getElementById('hint')!;
const hotbar = document.getElementById('hotbar')!;

/**
 * Joins the world through the gateway with an ID token, and watches its chunks. The entries on join are loaded as they
 * are; a later change carries no version, so it only tells the sync to read that chunk.
 */
async function join(sync: EditSync, gateway: string, world: string, token: string) {
  const client = await GatewayClient.connect(gateway, { token, world }, ['cache_versions']);
  client.onCacheEntries = (cache, entries) => {
    if (cache !== 'chunks') return;
    for (const entry of entries) sync.ingest(entry.key, entry.payload);
  };
  client.onCacheChange = (cache, entry) => {
    if (cache === 'chunks') sync.changed(entry.key);
  };
  return client;
}

async function run() {
  const table = await loadBlockTable();
  const atlas = buildAtlas(await loadTiles(table.tiles));
  await loadGenerator();
  const world = new EditableWorld(createGeneratedWorld(seed));
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

  // What the number keys place: the first nine blocks that are not water.
  const palette = table.blocks.filter((b) => b.pass !== 'water').slice(0, SLOTS);
  const targets = targetTable(table.blocks);
  let client: GatewayClient | null = null;
  let closed = false;
  const sync = new EditSync(
    world,
    {
      cacheGetVersioned: (...a) => client!.cacheGetVersioned(...a),
      cachePutIf: (...a) => client!.cachePutIf(...a),
    },
    {
      onChanged: (chunks) => view.invalidate(chunks),
      onError: (e) => {
        console.error('saving to Felix failed', e);
        // The disconnected message says more than the write errors that follow it.
        if (closed) return;
        status.textContent = `not saved: ${e instanceof Error ? e.message : e}`;
        status.className = 'fail';
      },
    },
  );
  const gateway = params.get('gateway');
  const worldName = params.get('world');
  const token = params.get('token');
  if (gateway && worldName && token) {
    client = await join(sync, gateway, worldName, token);
    client.cacheWatch('chunks');
    client.onClose = () => {
      closed = true;
      sync.stop();
      status.textContent = sync.dirty
        ? 'disconnected: reload to keep building (edits not saved yet are lost)'
        : 'disconnected: reload to keep building';
      status.className = 'fail';
    };
    sync.start();
  }
  window.__edit = {
    block: (x, y, z) => blocks.block(x, y, z),
    set: (x, y, z, id) => sync.edit(x, y, z, id),
    saved: async () => {
      for (let tries = 0; client && sync.dirty && tries < 400; tries++) {
        await sync.flush();
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    saving: client !== null,
  };
  const showSlots = () => {
    hotbar.replaceChildren(
      ...palette.map((b, i) => {
        const slot = document.createElement('span');
        slot.textContent = `${i + 1} ${b.name}`;
        slot.className = i === controls.slot ? 'on' : '';
        return slot;
      }),
    );
  };
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

  let shown = -1;
  const build = () => {
    if (shown !== controls.slot) {
      shown = controls.slot;
      showSlots();
    }
    const actions = controls.takeActions();
    if (actions.length === 0) return;
    const dir = lookDirection(controls.yaw, controls.pitch);
    for (const action of actions) {
      const hit = raycast(blocks, [player.x, player.eyeY, player.z], dir, targets, REACH);
      if (!hit) continue;
      if (action === 'dig') sync.edit(hit.x, hit.y, hit.z, 0);
      else if (hit.distance > 0) {
        const [x, y, z] = hit.before;
        const id = palette[controls.slot]?.id;
        if (id !== undefined && !blocksPlayer(hit.before, player, HALF_WIDTH, HEIGHT)) sync.edit(x, y, z, id);
      }
    }
  };

  const recent: number[] = [];
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let last = performance.now();
  const frame = (now: number) => {
    const delta = now - last;
    last = now;
    // Next frame first, so a throw below shows in the console without freezing the picture.
    requestAnimationFrame(frame);
    frames.count++;
    if (controls.takeFlyToggle()) player.toggleFlying();
    player.update(Math.min(delta / 1000, 0.1), controls.sample(), blocks);
    build();

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
    // A disconnect or a failed write during loading stays on screen.
    if (status.className === 'fail') return;
    status.textContent = `world ${seed}`;
    status.className = 'ok';
  })
  .catch((e) => {
    console.error(e);
    status.textContent = String(e);
    status.className = 'fail';
  })
  .finally(() => {
    window.__ready = true;
  });
