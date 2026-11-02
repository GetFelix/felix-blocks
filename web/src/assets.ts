// Loads the art from web/assets/. docs/art.md lists the packs and assets/CREDITS.md their sources and licences.
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** The Voxel Pack tiles are 128 px squares. */
export const TILE_SIZE = 128;

/** The Blocky Characters models used for other players, without the extension. */
export const CHARACTERS = ['character-b', 'character-e'] as const;
export type CharacterName = (typeof CHARACTERS)[number];

export const tileUrl = (name: string) => `assets/voxel-pack/tiles/${name}.png`;
export const characterUrl = (name: CharacterName) => `assets/blocky-characters/${name}.glb`;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Loads the named tiles. Rejects if any of them is missing or is not a 128 px square. */
export async function loadTiles(names: readonly string[]): Promise<Map<string, HTMLImageElement>> {
  const images = await Promise.all(
    names.map(async (name) => {
      const img = await loadImage(tileUrl(name));
      if (img.naturalWidth !== TILE_SIZE || img.naturalHeight !== TILE_SIZE) {
        throw new Error(`${name} is ${img.naturalWidth}x${img.naturalHeight}, not ${TILE_SIZE}x${TILE_SIZE}`);
      }
      return [name, img] as const;
    }),
  );
  return new Map(images);
}

export function loadCharacter(name: CharacterName): Promise<GLTF> {
  return new GLTFLoader().loadAsync(characterUrl(name));
}
