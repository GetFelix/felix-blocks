// Every colour in the game comes from here. docs/art.md says why each one is what it is.

/** Felix cyan, hsl(192, 90%, 46%): the cursor outline, the selected slot and Felix state. */
export const CYAN = { h: 192, s: 0.9, l: 0.46 } as const;
export const CYAN_CSS = `hsl(${CYAN.h}, ${CYAN.s * 100}%, ${CYAN.l * 100}%)`;

/**
 * Grass, leaves and tufts are recoloured by brightness, the way a biome tint works: the tile keeps its
 * texture and only the hue changes. The greens follow the logo.
 */
export const TINT = {
  grass: [102, 174, 62],
  leaves: [66, 146, 58],
  tuft: [94, 166, 58],
} as const satisfies Record<string, readonly [number, number, number]>;

/** Sky gradient and fog. The horizon and the fog match, so the world fades into the sky. */
export const SKY = {
  day: { zenith: 0x3f93dc, horizon: 0xcfe8f6, fog: 0xc6e2f3 },
  night: { zenith: 0x0a1430, horizon: 0x2b3f68, fog: 0x1f2d4f },
} as const;

export const PLAYER_COLOURS = { coral: 0xff7a59, violet: 0xa37cf0 } as const;

export const UI = {
  panel: 'rgba(12, 20, 28, 0.62)',
  text: '#e8eef3',
  muted: '#93a3b1',
} as const;

type Rgb = readonly [number, number, number];

/**
 * How the atlas restyles a tile when it is built. Tiles not listed here are used as they are.
 * `tint` recolours the green pixels by brightness; `saturate` and `brightness` work like the CSS filters of the
 * same names; `underlay` is a colour drawn behind the tile so glass reads as glass and not as holes.
 */
export interface TileStyle {
  tint?: Rgb;
  saturate?: number;
  brightness?: number;
  underlay?: readonly [number, number, number, number];
}

export const TILE_STYLES: Readonly<Record<string, TileStyle>> = {
  grass_top: { tint: TINT.grass },
  dirt_grass: { tint: TINT.grass },
  leaves_transparent: { tint: TINT.leaves },
  grass1: { tint: TINT.tuft },
  grass2: { tint: TINT.tuft },
  grass3: { tint: TINT.tuft },
  grass4: { tint: TINT.tuft },
  stone: { saturate: 0.7 },
  greystone: { saturate: 0.6, brightness: 1.3 },
  gravel_stone: { saturate: 0.7 },
  stone_coal: { saturate: 0.7 },
  stone_iron: { saturate: 0.7 },
  wood_red: { saturate: 0.85 },
  glass: { underlay: [205, 235, 250, 0.28] },
};
