/**
 * World-pack and episode schema (DESIGN.md §2 and §3).
 *
 * Everything here describes *data*. The engine must never gain a type, field or
 * branch that refers to a specific world, village, building or character.
 */

import type { TileGrid } from './tiled';

export type Vec2 = [number, number];
export type Rect = [number, number, number, number];
export type Facing = 'down' | 'left' | 'right' | 'up';

/** Facing order is also the row order of a character sheet (DESIGN.md §4). */
export const FACINGS: readonly Facing[] = ['down', 'left', 'right', 'up'];

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
  /** Floating name plate above the building, painted or not. Default true. */
  label?: boolean;
  /**
   * Walkable front-row tile the plaque beside the door is read from. Omitted
   * means the default (see `plaqueTile`); `false` means this building has no
   * plaque at all.
   */
  plaque?: Vec2 | false;
}

/**
 * Where a building's plaque is read from (DESIGN.md §2/§4). Every building has
 * one unless it opts out: it is where the painter is thanked, and where an
 * unpainted building carries its invitation.
 *
 * The default is the tile immediately right of the door — or immediately left
 * when the door already sits in the building's right-most column, so the
 * plaque stays in front of the building rather than wandering off the end of
 * it. Returns null when the placement sets `"plaque": false`.
 */
export function plaqueTile(placement: BuildingPlacement): Vec2 | null {
  if (placement.plaque === false) return null;
  if (placement.plaque) return [placement.plaque[0], placement.plaque[1]];
  const rightMost = placement.pos[0] + placement.size[0] - 1;
  const step = placement.door[0] >= rightMost ? -1 : 1;
  return [placement.door[0] + step, placement.door[1]];
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

/**
 * Everything about a map that world.json holds: its name, whether it is a
 * village or an interior, and every gameplay position on it. The tiles
 * themselves live in a Tiled file at `maps/<map id>.json` (DESIGN.md §2).
 */
export interface MapMeta {
  name: string;
  kind: 'village' | 'interior';
  buildings: BuildingPlacement[];
  labels: MapLabel[];
  exits: MapExit[];
}

/** A map as the engine plays it: world.json's metadata plus its Tiled grid. */
export interface GameMap extends MapMeta, TileGrid {}

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
  maps: Record<string, MapMeta>;
}

/**
 * Art credits, loaded by convention from `worlds/<id>/credits.json` with
 * graceful fallback (no file = no credits, DESIGN.md §2/§4). Every field is
 * optional; keys are asset ids (building/npc/tileset ids), values are the
 * credit text shown in-game.
 */
export interface Credits {
  buildings?: Record<string, string>;
  chars?: Record<string, string>;
  portraits?: Record<string, string>;
  tiles?: Record<string, string>;
}

/** UI strings. Anything the player reads that is not episode dialogue. */
export interface WorldCopy {
  ui: {
    narrator: string;
    advance: string;
    /**
     * The stand-in for an unpainted building that has no sign copy at all this
     * episode — without it the box would open empty. Keep it short and kind:
     * a building with sign copy never shows this. `{building}` and
     * `{contribute}` are substituted.
     */
    unpainted: string;
    /**
     * Label on the link to the world's contribution page, shown for the whole
     * of an unpainted building's plaque dialogue (DESIGN.md §2). No label
     * means no link — the plaque still reads fine on its own.
     */
    paint?: string;
    /**
     * What the little plaque beside a building's door says (DESIGN.md §2/§4).
     * It is the one place in the game where art is talked about, so the sign
     * box can stay entirely story: `painted` thanks the painter named in
     * `credits.json`, `anonymous` covers a painted building with no credit on
     * file, and `unpainted` is the invitation, shown beside the "Paint it"
     * link. `{building}` and `{credit}` are substituted.
     */
    plaque: {
      painted: string;
      anonymous: string;
      unpainted: string;
    };
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
