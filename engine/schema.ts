/**
 * World-pack and episode schema (DESIGN.md §2 and §3).
 *
 * Everything here describes *data*. The engine must never gain a type, field or
 * branch that refers to a specific world, village, building or character.
 */

export type Vec2 = [number, number];
export type Rect = [number, number, number, number];
export type Facing = 'down' | 'left' | 'right' | 'up';

/** Facing order is also the row order of a character sheet (DESIGN.md §4). */
export const FACINGS: readonly Facing[] = ['down', 'left', 'right', 'up'];

/** How the engine draws a tile when there is no painted tileset yet. */
export type TileStyle =
  | 'flat'
  | 'speckle'
  | 'road'
  | 'water'
  | 'tree'
  | 'flower'
  | 'prop'
  | 'block'
  | 'checker'
  | 'shelf'
  | 'mat';

export interface TileDef {
  name: string;
  style: TileStyle;
  /** Painted under the style detail; for styles that sit on top of ground. */
  base?: string;
  colors: string[];
  solid?: boolean;
}

export interface BuildingPlacement {
  id: string;
  pos: Vec2;
  size: Vec2;
  /** Walkable tile the player presses A on. */
  door: Vec2;
  /** Map id of this building's interior, if it has one yet. */
  interior?: string;
  /** Spawn tile inside that interior. */
  enter?: Vec2;
}

export interface MapLabel {
  text: string;
  pos: Vec2;
}

export interface MapExit {
  id: string;
  /** Trigger area in tiles: [x, y, w, h]. */
  at: Rect;
  to: string;
  spawn: Vec2;
  facing: Facing;
  /** 'road' plays the travel interstitial; 'door' the shorter threshold cut. */
  style: 'road' | 'door';
}

export interface GameMap {
  name: string;
  kind: 'village' | 'interior';
  legend: Record<string, TileDef>;
  tiles: string[];
  buildings: BuildingPlacement[];
  labels: MapLabel[];
  exits: MapExit[];
}

export interface BuildingDef {
  name: string;
  wall: string;
  roof: string;
}

export interface World {
  id: string;
  title: string;
  subtitle?: string;
  /** Shown on unpainted buildings, per DESIGN.md §2. */
  contribute?: string;
  palette?: string;
  episodes: string[];
  player: { id: string; accent: string };
  start: { map: string; pos: Vec2; facing: Facing };
  buildings: Record<string, BuildingDef>;
  maps: Record<string, GameMap>;
}

/** UI strings. Anything the player reads that is not episode dialogue. */
export interface WorldCopy {
  ui: {
    narrator: string;
    advance: string;
    /** `{building}` and `{contribute}` are substituted. */
    unpainted: string;
  };
  intro?: { speaker: string; lines: string[] };
  /**
   * Keyed by `MapExit.id`, or by `enter:<building id>` when stepping through a
   * door into an interior.
   */
  transitions: Record<string, { big: string; small?: string }>;
}

// --- episodes (DESIGN.md §3) -------------------------------------------------

export interface Effect {
  set?: string;
  toast?: string;
}

export interface DialogueEntry {
  requires: string[];
  lines: string[];
  effects?: Effect[];
}

export interface EpisodeNpc {
  id: string;
  name: string;
  map: string;
  pos: Vec2;
  facing?: Facing;
  /** Used for the fallback townsperson sprite when there is no character sheet. */
  accent?: string;
  dialogue: DialogueEntry[];
}

export interface EpisodeItem {
  id: string;
  map: string;
  pos: Vec2;
  requires: string[];
  effects: Effect[];
  lines: string[];
}

/**
 * Flavor text, on a building or on a prop. Exactly one of `building` (read at
 * the building's door, with a prompt) or `map` + `pos` (a prop such as a shelf
 * or a counter, examined by standing next to it, with no prompt).
 */
export interface EpisodeSign {
  building?: string;
  map?: string;
  pos?: Vec2;
  requires: string[];
  lines: string[];
}

export interface Episode {
  id: string;
  title: string;
  flags: string[];
  npcs: EpisodeNpc[];
  items?: EpisodeItem[];
  signs?: EpisodeSign[];
}
