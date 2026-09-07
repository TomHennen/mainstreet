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

// --- how a placeholder person looks (DESIGN.md §4) ---------------------------

/**
 * The hair the engine knows how to draw. A fixed vocabulary rather than free
 * text, so a world pack can only ask for something the engine can actually
 * paint, and a typo is caught by the validator instead of quietly falling back
 * (engine/figure.ts draws them).
 */
export const HAIR_STYLES = ['flat', 'short', 'long', 'curly', 'ponytail', 'bun', 'cap', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** How wide a person is through the shoulders — a pixel or two either way. */
export const BUILDS = ['slim', 'regular', 'broad'] as const;
export type Build = (typeof BUILDS)[number];

/**
 * How one person looks *before anyone has painted them*: the recipe the engine
 * draws its placeholder townsperson from, so a cast reads as a cast while it
 * waits for art (CLAUDE.md hard rule 3). Every field is optional and falls
 * back to the original townsperson, so old content keeps the look it had.
 *
 * This is a vocabulary, not a picture: the engine owns the shapes and the
 * world pack owns who wears which. A painted `assets/chars/<id>.png` replaces
 * the placeholder outright and the look is then ignored.
 */
export interface Look {
  hair?: HairStyle;
  hairColor?: string;
  skin?: string;
  /** Shirt colour. The older spelling for the same thing is `accent`. */
  shirt?: string;
  build?: Build;
}

/**
 * One person's look, with the older `accent` spelling folded in. `accent` came
 * first and is still how most of a world pack names a shirt colour, so it
 * keeps working everywhere; an explicit `look.shirt` wins where both are set.
 */
export function lookOf(who: { accent?: string; look?: Look }): Look {
  const look = who.look ?? {};
  if (look.shirt !== undefined || who.accent === undefined) return look;
  return { ...look, shirt: who.accent };
}

/**
 * A person who walks (DESIGN.md §2/§3). Both shapes are pure data: the engine
 * walks them with `engine/mover.ts` and the world pack never says how.
 *
 * A `route` is a list of tiles walked in order, the engine's own pathfinder
 * filling in the way between one waypoint and the next, so an author places
 * the corners of a stroll rather than every step of it. A `wander` is the
 * cheap variant: a tile to live near and how far from it is reasonable.
 */
export interface Route {
  /** Waypoints, in order. Each one has to be somewhere a person can stand. */
  path: Vec2[];
  /** Back to the first waypoint after the last. Default true. */
  loop?: boolean;
  /** Seconds spent standing at each waypoint. Default 1.5. */
  pause?: number;
  /** Tiles per second. Default: the player's walking speed x 0.8. */
  speed?: number;
}

export interface Wander {
  /** How far from the home tile, in tiles. At least 1. */
  radius: number;
  /** Seconds spent standing between wanders. Default 1.5. */
  pause?: number;
}

/**
 * A townsperson who belongs to the village rather than to any one story
 * (DESIGN.md §2): somebody on the street when no episode is running, so a map
 * is not empty between weeks. They have a look and somewhere to be, and no
 * dialogue at all — pressing A gets one kind passing line from `copy.json`
 * `ui.passerby`, picked from the list by their id so the same person always
 * says the same thing. Anybody with something to say is an episode NPC.
 */
export interface Person {
  id: string;
  /** Optional: without one the dialogue box simply shows no name. */
  name?: string;
  pos: Vec2;
  facing?: Facing;
  /** Shirt colour of the fallback townsperson. Shorthand for `look.shirt`. */
  accent?: string;
  look?: Look;
  route?: Route;
  wander?: Wander;
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
  /**
   * Townspeople who belong to the village rather than to an episode: two or
   * three per map is plenty, and the validator says so (DESIGN.md §2).
   */
  people?: Person[];
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

/**
 * Where a world's finished art goes when someone presses Send in the Studio
 * (CLAUDE.md hard rule 1: the form and every field id are world data, so no
 * address and no form ever appears in the Studio's code).
 *
 * `art.form` is the URL a plain HTML form post goes to — a Google Form's
 * `formResponse` address, say — and `art.fields` names the field the form
 * expects each part of a submission in. The Studio posts across origins and so
 * can never read the answer back; a world with no `submit.art` keeps the older
 * behaviour, where Send hands the drawing to the painter's own email app
 * instead. Nothing here is an account, and nothing is a third-party service
 * the world's owner does not already own (hard rule 7).
 */
export interface Submit {
  art?: {
    /** Where the post goes. https, always. */
    form: string;
    /** The form's own field ids, by what the Studio writes into each. */
    fields: {
      building: string;
      world: string;
      credit: string;
      code: string;
      /** Optional free text from the painter. No field, no textarea. */
      notes?: string;
    };
  };
}

export interface World {
  id: string;
  title: string;
  subtitle?: string;
  /** Shown on unpainted buildings, per DESIGN.md §2. */
  contribute?: string;
  /** Where a suggestion-box fixture writes to (DESIGN.md §2). */
  feedback?: Feedback;
  /** Where the Studio sends a finished drawing (DESIGN.md §4). */
  submit?: Submit;
  palette?: string;
  /** What the palette is called, and where it can be fetched — for anyone
   *  painting outside the Studio. Both optional; the engine never reads them. */
  paletteName?: string;
  paletteLink?: string;
  episodes: string[];
  /** The player's own placeholder look; `accent` is `look.shirt`'s older name. */
  player: { id: string; accent?: string; look?: Look };
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
  /**
   * Who wrote an episode's story, keyed by episode id — separate from the art
   * credits above because a story has no PNG to have painted, so there is no
   * "actually painted" gate on it (contrast `creditFor`). Optional, and
   * usually absent: most worlds simply don't fill it in, and the title
   * screen's Credits list leaves out the whole "Story by" group when it is.
   */
  stories?: Record<string, string | string[]>;
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
    /**
     * What a townsperson with no story to tell says (DESIGN.md §2). A world
     * person carries no dialogue of their own, so the engine picks one of
     * these by their id — the same person always says the same thing — and
     * a world with none simply has nothing for them to say (hard rule 3).
     * Keep them short, warm and about nobody in particular.
     */
    passerby?: string[];
    /**
     * The name on the dialogue box when one of those townspeople has none of
     * their own (DESIGN.md §2). A world person is somebody the player passes
     * rather than somebody they are introduced to, so a world pack usually
     * leaves their `name` out and lets this stand in for all of them — "A
     * neighbour", say. No `passerbyName` and the box simply shows no name.
     */
    passerbyName?: string;
    /**
     * The title screen (DESIGN.md §2). The engine draws the world's name and
     * its list of episodes; every word on it comes from here. `play` is the
     * action on an episode not started yet, `continue` on one with a save to
     * carry on from, `again` on one already finished, `done` is the little
     * mark beside a finished episode's title, and `write` labels the "write
     * to us" link that sits at the foot of the list when `world.json` has a
     * `feedback` block (the same link the suggestion box offers). Anything
     * missing simply isn't drawn — no wording of any of it is in the engine
     * (CLAUDE.md hard rules 1 and 3).
     *
     * `reset` is the secondary action offered beside `continue`/`again` — a
     * true reset, forgetting the episode was ever finished, as opposed to
     * `again`'s replay, which keeps it on the done list. `resetAsk` and
     * `forgetAsk` are the one-step confirmation's question, asked in place on
     * the same row, with `yes`/`keep` as its two answers. `forget` is the
     * "wipe the whole save" item at the foot of the list; leaving it out
     * simply leaves that item off (hard rule 3). `credits` labels the item
     * that opens the Credits list; `palette` and `licence` are its two fixed
     * closing lines — plain copy, so the engine never has to name a person or
     * a licence itself.
     */
    title?: {
      play?: string;
      continue?: string;
      again?: string;
      done?: string;
      write?: string;
      reset?: string;
      resetAsk?: string;
      yes?: string;
      keep?: string;
      forget?: string;
      forgetAsk?: string;
      credits?: string;
      /** Heading over an episode's writer(s) on the Credits list, when `credits.json` has a `stories` entry for it. */
      storyBy?: string;
      palette?: string;
      licence?: string;
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

/**
 * The flag an episode sets when its story is over. It is a convention of the
 * schema, not of any world: every episode that can be finished declares a
 * flag by this name and sets it on the line that ends the story, and the
 * engine treats that as "complete" — which is what puts the episode's id in
 * the save's `completed` list and its done mark on the title screen. An
 * episode that never declares it simply never completes.
 */
export const DONE_FLAG = 'done';

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
  /** Shirt colour of the fallback townsperson. Shorthand for `look.shirt`. */
  accent?: string;
  /** How the fallback townsperson is drawn — ignored once a sheet is painted. */
  look?: Look;
  /**
   * Somewhere to walk while the story waits (DESIGN.md §3). `pos` stays the
   * tile they start on and the one an author places them by; a person with a
   * route or a wander is simply not always standing on it. At most one of the
   * two. Both stop while the player is close by, so somebody with something
   * to say is never chased around the village.
   */
  route?: Route;
  wander?: Wander;
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
