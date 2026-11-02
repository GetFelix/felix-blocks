// The block table and the other rules live in core/ (Rust); this is the page's handle on its WebAssembly build.
import init, { blockTable } from './core/felix_blocks_core.js';

export type Pass = 'opaque' | 'cutout' | 'glass' | 'water';

export interface BlockInfo {
  id: number;
  name: string;
  top: string;
  side: string;
  bottom: string;
  pass: Pass;
}

export interface BlockTable {
  /** Every block except air, in id order. */
  blocks: BlockInfo[];
  /** Tiles drawn as crossed quads, not as blocks. */
  plants: string[];
  /** Every tile the game draws, in atlas order. */
  tiles: string[];
}

/** Loads the WebAssembly module (once) and returns the block table. Pass the module's bytes outside a browser. */
export async function loadBlockTable(wasm?: BufferSource): Promise<BlockTable> {
  await init(wasm ? { module_or_path: wasm } : undefined);
  return JSON.parse(blockTable()) as BlockTable;
}
