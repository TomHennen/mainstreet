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

/**
 * The engine's own little street fixtures — things it draws and lets a player
 * press A on that belong to no building and no episode. Like the plaque, a
 * fixture is drawn by the engine so nobody has to paint one, and like the
 * plaque it is a shape with a job, never a specific world's furniture: what
 * the box in a particular town says comes from `copy.json`.
 *
 * A fixture stands on its own tile and blocks it, so the player walks up
 * beside it rather than through it. Painted art for one would arrive by the
 * usual convention (an `assets/props/<kind>.png` alongside the other asset
 * directories); that is not wired up yet, and the drawn fixture is what
 * ships until it is.
 */
export const FIXTURE_KINDS = ['suggestion-box'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export interface Fixture {
  kind: FixtureKind;
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
  /** Engine-drawn street fixtures on this map. Optional; usually absent. */
  fixtures?: Fixture[];
}

/** A map as the engine plays it: world.json's metadata plus its Tiled grid. */
export interface GameMap extends MapMeta, TileGrid {}

export interface BuildingDef {
  name: string;
  wall: string;
  roof: string;
  /**
   * The building's standing sign: what is chalked up, posted or going on at
   * the door on an ordinary day, one array entry per dialogue page. It is the
   * place's own copy rather than any one story's, so it stays on the door
   * while a story runs: an episode sign whose `requires` are met reads first
   * and this follows it, the way a flyer taped to the window sits on top of
   * the place without erasing it. An episode that wants the door entirely to
   * itself sets `replace` on its sign (DESIGN.md §3). With neither kind of
   * sign, the door falls back to `copy.ui.unpainted` — a stand-in the
   * validator keeps for buildings no map places yet, since every building
   * that is actually standing on a map has to carry one of its own.
   */
  sign?: string[];
}

/**
 * Where a world sends someone who has something to say — a story idea, or a
 * correction. Either an address to mail or a full URL to open; the engine
 * composes the link and never knows what either one is (CLAUDE.md hard rule
 * 1). A world with no `feedback` simply gets no link (hard rule 3).
 */
export interface Feedback {
  /** Address a "write to us" link mails. */
  email?: string;
  /** A page to open instead — a form, say. Wins over `email` when both are set. */
  url?: string;
  /** Subject line for the mail. Ignored when `url` is used. */
  subject?: string;
}

export interface World {
  id: string;
  title: string;
  subtitle?: string;
  /** Shown on unpainted buildings, per DESIGN.md §2. */
  contribute?: string;
  /** Where a suggestion-box fixture writes to (DESIGN.md §2). */
  feedback?: Feedback;
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
 * optional; keys are asset ids (building/npc/tileset ids). A value is either
 * a single name (as it has always been) or an array of names, in order of
 * contribution, for something more than one person worked on — a repaint or
 * a touch-up credits everyone who painted it. `engine/session.ts`'s
 * `creditFor` (and the landing page's build step) turn either shape into one
 * line to read: "Tom", "Tom and Lana", "Tom, Lana and Alice".
 */
export interface Credits {
  buildings?: Record<string, string | string[]>;
  chars?: Record<string, string | string[]>;
  portraits?: Record<string, string | string[]>;
  tiles?: Record<string, string | string[]>;
}

/** UI strings. Anything the player reads that is not episode dialogue. */
export interface WorldCopy {
  ui: {
    narrator: string;
    advance: string;
    /**
     * The stand-in for an unpainted building with no sign copy at all — none
     * this episode, and none standing in `world.json` either — since without
     * it the box would open empty. Keep it short and kind: a building with
     * sign copy of either kind never shows this. `{building}` and
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
     * Label on the link to the Studio, offered on a painted building's plaque
     * so touching up the art is as close at hand as painting it the first
     * time (DESIGN.md §2). No label means no link — the plaque still reads
     * fine on its own. The engine points it at the same building, with
     * `improve=1` added so the Studio opens with the shipped painting
     * already on the canvas (`engine/paint.ts` `improveUrl`).
     */
    improve?: string;
    /**
     * What the little plaque beside a building's door says (DESIGN.md §2/§4).
     * It is the one place in the game where art is talked about, so the sign
     * box can stay entirely story: `painted` thanks the painter named in
     * `credits.json`, `anonymous` covers a painted building with no credit on
     * file, and `unpainted` is the invitation, shown beside the "Paint it"
     * link. `{building}` and `{credit}` are substituted; `{credit}` reads as
     * one or more names joined in a list ("Tom, Lana and Alice") when
     * `credits.json` names more than one painter.
     */
    plaque: {
      painted: string;
      anonymous: string;
      unpainted: string;
    };
    /**
     * What a `suggestion-box` fixture says (DESIGN.md §2). `lines` is the
     * dialogue, `link` labels the "write to us" link beside it — no label
     * means no link, and the box still reads fine on its own — and `body`
     * is the note the link starts the writer off with, one array entry per
     * line. All of it is world copy: the engine supplies the box and the
     * link, never a word of either.
     */
    suggest?: {
      lines: string[];
      link?: string;
      body?: string[];
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
  /**
   * Building signs only. By default these lines are read first and the
   * building's standing sign in `world.json` follows them, so a story never
   * costs the player the colour of the place it is set in (DESIGN.md §3).
   * `true` drops the standing sign for as long as this sign is the one
   * showing — for the rare week when the door is entirely the story's.
   */
  replace?: boolean;
}

export interface Episode {
  id: string;
  title: string;
  flags: string[];
  npcs: EpisodeNpc[];
  items?: EpisodeItem[];
  signs?: EpisodeSign[];
}
