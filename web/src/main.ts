// The asset page: every tile the block table names and every character, loaded the way the game loads them.
// scripts/check-assets.mjs reads window.__result once window.__ready is true.
import { CHARACTERS, loadCharacter, loadTiles, tileUrl } from './assets';
import { loadBlockTable } from './core';

interface Result {
  tiles: { total: number; loaded: number };
  characters: { total: number; loaded: number };
  failures: string[];
}

declare global {
  interface Window {
    __ready?: boolean;
    __result?: Result;
  }
}

const status = document.getElementById('status')!;
const result: Result = {
  tiles: { total: 0, loaded: 0 },
  characters: { total: CHARACTERS.length, loaded: 0 },
  failures: [],
};

async function run() {
  const table = await loadBlockTable();
  result.tiles.total = table.tiles.length;

  const tiles = document.getElementById('tiles')!;
  for (const name of table.tiles) {
    try {
      await loadTiles([name]);
      result.tiles.loaded++;
    } catch (e) {
      result.failures.push(String(e));
    }
    const fig = document.createElement('figure');
    const img = new Image();
    img.src = tileUrl(name);
    img.alt = name;
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    fig.append(img, cap);
    tiles.append(fig);
  }

  const list = document.getElementById('characters')!;
  for (const name of CHARACTERS) {
    try {
      const gltf = await loadCharacter(name);
      result.characters.loaded++;
      const li = document.createElement('li');
      li.textContent = `${name}: ${gltf.animations.map((a) => a.name).join(', ')}`;
      list.append(li);
    } catch (e) {
      result.failures.push(`${name}: ${e}`);
    }
  }
}

run()
  .catch((e) => result.failures.push(String(e)))
  .finally(() => {
    const ok = result.failures.length === 0;
    status.textContent = ok
      ? `${result.tiles.loaded} tiles and ${result.characters.loaded} characters loaded`
      : result.failures.join('; ');
    status.className = ok ? 'ok' : 'fail';
    window.__result = result;
    window.__ready = true;
  });
