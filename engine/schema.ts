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
  /**
   * Walkable front-row tile the standing sign board is read from, for a
   * building that also has an interior (see `signBoardTile`). Omitted means
   * the default; meaningless — and never consulted — on a building with no
   * interior, since the door itself still reads the sign there.
   */
  signAt?: Vec2;
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

/**
 * Where a building's standing sign is read from, once it also has an
 * interior (DESIGN.md §2). A door that opens is only ever the way in, so a
 * building with both needs a second place for its day-to-day sign to live: a
 * little board the engine draws beside the door. Its default side is the far
 * side of the door from wherever `plaqueTile` actually put the plaque — so an
 * explicit `plaque` that flips sides carries the board along with it, and the
 * two never crowd the same tile — or, with no plaque to dodge at all
 * (`"plaque": false`), the side `plaqueTile` would have defaulted to, which
 * keeps the board clear of wherever a plaque could still go. Unlike the
 * plaque, which may sit a tile beyond a narrow footprint, the board's column
 * is clamped to the building's own — it never wanders onto a neighbour's
 * frontage. A placement's `signAt` overrides the default outright, for the
 * rare case it lands somewhere awkward (astride a road, or — since a door in
 * an edge column leaves no far side inside the footprint to clamp to — on the
 * door itself). Returns null for a building with no interior, where the door
 * itself still reads the sign, and there is nothing beside it to draw.
 */
export function signBoardTile(placement: BuildingPlacement): Vec2 | null {
  if (!placement.interior) return null;
  if (placement.signAt) return [placement.signAt[0], placement.signAt[1]];

  const left = placement.pos[0];
  const right = placement.pos[0] + placement.size[0] - 1;
  const plaque = plaqueTile(placement);
  const step = plaque ? (plaque[0] > placement.door[0] ? -1 : 1) : placement.door[0] >= right ? -1 : 1;
  const x = Math.min(right, Math.max(left, placement.door[0] + step));
  return [x, placement.door[1]];
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
export const FIXTURE_KINDS = ['suggestion-box', 'woodpile', 'firepit'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export interface Fixture {
  kind: FixtureKind;
  pos: Vec2;
  /**
   * What reading this fixture says, one page per entry — the same shape as a
   * `MapSign`'s lines and read the same way. A fixture with none of these
   * falls back to the world's own copy for the kind, which is how the
   * suggestion box gets its words.
   */
  lines?: string[];
  /**
   * **The carry verbs** (DESIGN.md §2). A fixture with `give` hands the player
   * a token when they read it; a fixture with `take` spends that same token.
   * That is the whole mechanic: a log off the pile, a log on the fire.
   *
   * The token is a string the world pack picks and only these two fixtures
   * ever see. It lives in this visit to this map and nowhere else — it is not
   * an inventory, it is never saved, and walking out of the yard drops it
   * (engine/scenes/map.ts). Nothing branches on it, no flag is set, and no
   * episode can read it: it is a small warm thing to do, not a puzzle.
   *
   * `lines` is what the fixture says when the exchange happens and `otherwise`
   * is what it says when it cannot — the player already has one, or has
   * nothing to give. Both are plain world copy; the engine only knows that
   * the token moved.
   */
  give?: string;
  take?: string;
  /** What it says when `give`/`take` has nothing to do. See above. */
  otherwise?: string[];
  /**
   * What the "with you" panel calls the token this fixture hands over
   * (DESIGN.md §2, `engine/inventory.ts`), while the player is holding it.
   * Belongs on the `give` fixture, the one place the token is named; the
   * `take` fixture that spends it needs neither this nor `heldBlurb`. The
   * engine never invents player-facing English from the token — no
   * title-casing it — so leaving this out shows the token's own name
   * verbatim instead ("log", not "Log").
   */
  heldName?: string;
  /**
   * One line for the "with you" panel while the player is holding this
   * fixture's token — what it's like to have it in hand, since `lines` is the
   * moment of picking it up rather than a description for later. Leaving it
   * out still shows the token on the panel, just with no second line under it
   * (hard rule 3) — the exchange itself is unaffected either way.
   */
  heldBlurb?: string;
  /**
   * Seconds this fixture glows warmly after a successful `take` — a fire that
   * has just been fed. One soft light disc over its tile, no strobe, and its
   * art switches to the kind's lit variant for as long as it lasts
   * (engine/lighting.ts). Left out, nothing lights up.
   */
  glow?: number;
}

/**
 * Something on this map that can be read where it stands: a door with a note
 * on it, a wall worth stopping at, a board propped in a corner. The shape is
 * an episode prop sign's (DESIGN.md §3) minus the story — no `requires`,
 * because this belongs to the place rather than to any one week, and it is
 * still there when no episode is running.
 *
 * A sign is not a tile and does not block anything: whatever is drawn at
 * `pos` decides that. Read from beside it, like an episode's prop sign.
 */
export interface MapSign {
  pos: Vec2;
  lines: string[];
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
  /** Tiles per second. Default: the player's walking speed x 0.45, an amble. */
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
 * is not empty between weeks. They have a look and somewhere to be, and by
 * default no dialogue at all — pressing A gets one kind passing line from
 * `copy.json` `ui.passerby`, picked from the list by their id so the same
 * person always says the same thing.
 *
 * `lines`, when given, is that person's own standing line instead — one or
 * two pages, in their own voice, the same every time (a barista behind a
 * counter, say). It shows with `name` (or `copy.json`'s `ui.passerbyName`) as
 * the speaker, exactly like an episode NPC's dialogue, but it is still not a
 * story: it never branches on a flag and never sets one. Anybody whose line
 * needs to change with the story is an episode NPC instead.
 *
 * A person with neither `route` nor `wander` simply stands still on `pos` —
 * useful for someone posted behind a counter. The validator only checks that
 * `pos` itself is stand-able ground, never that a player could actually walk
 * there, so a spot in a staff strip sealed off from the rest of the room
 * (see `engine/validate.ts`, and `scripts/make-room.ts`'s `sealStrip`) is
 * fine: the player talks to them across the counter, within an interior's
 * talking reach, not by walking up to them (engine/scenes/map.ts).
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
  /** This person's own standing line(s), in place of `ui.passerby`. See above. */
  lines?: string[];
}

/**
 * The vehicles the engine knows how to draw (DESIGN.md §2). A fixed
 * vocabulary, like `FIXTURE_KINDS` and the hair styles: a world pack can only
 * ask for a shape the engine can actually paint, and a typo is a validator
 * error rather than a car that quietly turns into a saloon.
 */
export const VEHICLE_KINDS = ['car', 'pickup', 'van'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

/**
 * A car going about its day on a village's paved route (DESIGN.md §2).
 *
 * It is ambient and nothing else: it is never solid, never a hazard, has
 * nothing to say, is not a tap target, and never touches a save. It gives way
 * to the player rather than the other way round — see `engine/vehicle.ts`.
 *
 * `path` is waypoints in order, exactly as a person's `route` is, and the
 * engine's own pathfinder fills in the tiles between them. Every one of those
 * tiles has to carry the tileset's `drive` property, which is what keeps cars
 * on the paved routes and off the quiet side streets (engine/validate.ts).
 *
 * A vehicle with no `path` at all is a **parked** one: it sits on `pos`,
 * facing where it was left, drawn exactly like a moving one and just as
 * un-solid. That is how somebody's pickup ends up in a lot for an episode
 * without the engine gaining any idea of whose it is.
 */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  /** Body colour of the engine-drawn placeholder. Ignored once painted. */
  colour: string;
  /** The tile it sits on. Defaults to the first waypoint; required when parked. */
  pos?: Vec2;
  /** Which way it points. Default 'down'; a moving car turns as it drives. */
  facing?: Facing;
  /** Waypoints, in order. Each one has to be somewhere a vehicle can drive. */
  path?: Vec2[];
  /** Back to the first waypoint after the last. Default true. */
  loop?: boolean;
  /** Tiles per second. Default: the player's walking speed x 3. */
  speed?: number;
  /** Seconds spent standing at each waypoint. Default 0.8. */
  pause?: number;
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
 * A road that runs out rather than going anywhere (DESIGN.md §2): a
 * rectangle shaped exactly like an exit's `at`, but instead of leading
 * somewhere it shows `lines` in the say box, narrator-voiced, the moment the
 * player walks into it. Once per visit — leaving the rectangle and coming
 * back shows it again, but standing there (or the box staying open) never
 * repeats it. No flags, no effects, nothing saved: it is scenery talking,
 * not the story.
 *
 * `edges` is how a *particular* road gets its own line ("NY 10 keeps going
 * north from here..."); a road at a map's edge with no `exits` entry and no
 * matching `edges` entry falls back to the engine's own generic
 * `copy.ui.roadEnd` instead (never shown for grass or trees, only for a road
 * that simply hasn't been mapped further).
 */
export interface MapEdge {
  id: string;
  /** Trigger area in tiles: [x, y, w, h], the same shape as an exit's `at`. */
  at: Rect;
  lines: string[];
}

/**
 * What happens when the player walks off the map over open ground (DESIGN.md
 * §2) — the grass and trees at a village's edge that `edges` and `ui.roadEnd`
 * deliberately say nothing about, because they read as open country rather
 * than a road that ran out. Keep going into it and the narrator says `lines`
 * in the say box; when the last one is dismissed the player is taken to `to`
 * on the road card and set down at `spawn`, facing `facing`. It is the one
 * way off a map that is not an exit, and like an edge it is scenery talking:
 * no flags, no effects, nothing saved. A map without `lost` simply has a
 * quiet boundary there, as before.
 */
export interface MapLost {
  /** Narrator lines shown in the say box, then the player is sent `to`/`spawn`. */
  lines: string[];
  to: string;
  spawn: Vec2;
  facing: Facing;
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
  /** Roads that dead-end here with their own line, rather than an exit (DESIGN.md §2). */
  edges?: MapEdge[];
  /** What happens when the player walks off the map over open ground (DESIGN.md §2). */
  lost?: MapLost;
  /** Engine-drawn street fixtures on this map. Optional; usually absent. */
  fixtures?: Fixture[];
  /** Things on this map that can be read where they stand. Optional. */
  signs?: MapSign[];
  /**
   * Townspeople who belong to the village rather than to an episode: two or
   * three per map is plenty, and the validator says so (DESIGN.md §2).
   */
  people?: Person[];
  /**
   * Ambient traffic on this map's paved routes (DESIGN.md §2). One or two per
   * village is what makes a street read as lived-in; the validator says so.
   */
  vehicles?: Vehicle[];
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
 * `art.form` is the form's `formResponse` address — a Google Form's own name
 * for the URL a plain HTML form post goes to — and `art.fields` names the
 * field the form expects each part of a submission in. Send never posts to
 * this address itself: it opens the form's own page, prefilled, in a new tab,
 * so the painter presses Submit there and sees Google's own confirmation
 * (the Studio can never read a cross-origin post's answer, so it stopped
 * guessing). That page is `art.page` when the pack gives one, or else
 * `art.form` with a trailing `/formResponse` swapped for `/viewform` — the
 * same form's own two addresses for the same set of fields. A world with no
 * `submit.art` keeps the older behaviour, where Send hands the drawing to the
 * painter's own email app instead. Nothing here is an account, and nothing is
 * a third-party service the world's owner does not already own (hard rule 7).
 */
export interface Submit {
  art?: {
    /** The form's post address. https, always. */
    form: string;
    /**
     * The form's own page to open prefilled, if it isn't `art.form` with
     * `/formResponse` swapped for `/viewform`. https, always. Optional, and
     * usually absent.
     */
    page?: string;
    /** The form's own field ids, by what the Studio writes into each. */
    fields: {
      /**
       * Optional: the code's first two segments already carry the world and
       * building ids, so a form need not ask. A named field is filled in when
       * present (browsers may autofill an empty "name"-like box, so most forms
       * are better off without these two questions).
       */
      building?: string;
      world?: string;
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
  /**
   * A line for the foot of the site's front page, in the world's own words —
   * where it is made, or who by, e.g. "Made in the Catskills". Optional, and
   * the engine never reads it: it is there so the site can say something true
   * about a world without the build knowing anything about that world.
   */
  tagline?: string;
  /**
   * How far along the world is, for its card on the front page — a short
   * phrase, e.g. "Just getting started" or "A story a week". Optional; with
   * none, the site prints "Just getting started". The engine never reads it.
   */
  status?: string;
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
     * One-word verb stacked over the reach prompt's little bubble, for
     * whichever kind of thing it is currently floating over (DESIGN.md §2):
     * `enter` for a door with an interior behind it, `read` for everything
     * else the prompt shows for — a sign board, a plaque, a prop, a fixture.
     * Either or both missing means no label over the bubble for that kind
     * (hard rule 3) — the glyph on the bubble itself (⌂ for a door, A for
     * everything else) still tells the two apart on its own.
     */
    enter?: string;
    read?: string;
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
     * What the narrator says when a road simply runs out — the player has
     * walked a stretch of paving right up to the edge of what is mapped, and
     * there is neither an `exits` entry there nor that map's own `edges`
     * line for the spot (DESIGN.md §2). One is picked by the tile's own
     * position, so the same dead end always says the same thing rather than
     * changing on every visit. Never shown for grass or trees at an edge,
     * only for a road that hasn't been mapped further; a world with none of
     * these simply shows nothing there (hard rule 3).
     */
    roadEnd?: string[];
    /**
     * What a car hollers out the window once the player specifically has
     * held it stopped in the road for a moment (DESIGN.md §2) — never a car
     * waiting on another car, which has nobody to holler at. Shown the same
     * lightweight way any ambient one-liner is, picked so the same car
     * doesn't repeat itself right after saying it (`Driver.takeHoller` in
     * engine/vehicle.ts). A world with none of these simply never hollers
     * (hard rule 3) — keep them good-natured, the kind of ribbing everyone
     * in the scene would smile at, never actually cross.
     */
    holler?: string[];
    /**
     * The name on the dialogue box when one of those townspeople has none of
     * their own (DESIGN.md §2). A world person is somebody the player passes
     * rather than somebody they are introduced to, so a world pack usually
     * leaves their `name` out and lets this stand in for all of them — "A
     * neighbour", say. No `passerbyName` and the box simply shows no name.
     */
    passerbyName?: string;
    /**
     * A pinch of local trivia (DESIGN.md §2), an easter egg rather than
     * something to notice: about one time in five, a world person's small
     * talk gives way to one of these instead of their usual line
     * (`engine/session.ts`'s `smallTalkFor`) — a real roll, not tied to who
     * is asked and never saved, so it is only ever a nice surprise, never a
     * rung to climb. Keep each one true, kind, and short — under 140
     * characters is plenty. Optional; a world with none simply never rolls
     * for it.
     */
    trivia?: string[];
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
     *
     * Four more label the Credits screen's own closing rows (issue #65
     * addendum): `source` is "Open source on GitHub" — the repository URL
     * itself is never a world's to know, so it comes from the engine's own
     * build instead (`import.meta.env.VITE_REPOSITORY`, set in
     * `vite.config.ts` from `package.json`) and this only supplies the
     * label. `about` links to the site's front page and `paint` to the
     * Studio for this world (falling back to the contributing page when the
     * world names no Studio of its own, via `world.contribute`) — both
     * worked out from where the page itself is served, never typed
     * anywhere. `back` is the button, last on the list, that returns to the
     * episode list — offered alongside the screen's existing tap-anywhere
     * and A-to-close, for anyone who didn't know either of those would work.
     * Any of the four left out simply isn't drawn (hard rule 3), and
     * `source`/`about`/`paint` each also depend on their URL actually being
     * available.
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
      source?: string;
      about?: string;
      paint?: string;
      back?: string;
    };
    /**
     * The "with you" panel (DESIGN.md §2, `engine/inventory.ts`): a glance at
     * what the player is carrying, not an inventory — no counts, no slots,
     * nothing to manage. `button` labels the HUD button that opens it, `title`
     * is the panel's own heading, and `empty` is the one warm line it shows
     * with nothing to list. The engine draws each entry's name (title-cased
     * off its id) and a placeholder swatch itself; only the words are
     * copy. `button` is what switches the whole feature on — with no label
     * for it there is nothing to tap or bind a key to, so the panel, the HUD
     * button and the keyboard shortcut all simply do not appear (hard rule
     * 3). `title` and `empty` left out just leave that one line off the
     * open panel.
     */
    withYou?: {
      button?: string;
      title?: string;
      empty?: string;
    };
  };
  intro?: {
    speaker: string;
    lines: string[];
    /**
     * Lets the intro's first line follow the real calendar (DESIGN.md §2/§3):
     * each entry names a "MM-DD" `from`/`to` range (inclusive, and a range may
     * wrap the year end, e.g. "12-01" to "02-28" for deep winter) and the
     * line to use in it. `engine/season.ts`'s `introLineFor` picks the first
     * range containing the device's local date at boot — never saved
     * (CLAUDE.md hard rule 7) — and falls back to `lines[0]` when none match,
     * or when this is left out entirely. Optional; a world with no ranges
     * simply always shows `lines[0]`.
     */
    byDate?: { from: string; to: string; line: string }[];
  };
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
  /**
   * What the "with you" panel calls this item (DESIGN.md §2,
   * `engine/inventory.ts`). The engine never invents player-facing English —
   * no title-casing an id — so leaving this out shows the item's own id
   * verbatim instead ("pen", not "Pen").
   */
  name?: string;
  /**
   * One line for the "with you" panel: what this is, now that it's in hand,
   * since `lines` is the moment of picking it up rather than a description to
   * keep reading later. Leaving it out still shows the item on the panel,
   * just with no second line under it (hard rule 3).
   */
  blurb?: string;
  /**
   * A declared flag (like `requires`) that takes this item off the "with
   * you" panel once it's true — the beat the item is handed back or used up,
   * usually the same flag that finishes the episode ("done"). Without it the
   * item stays on the panel for good once picked up: `withYou` only ever
   * reads `session().taken`, never the item's own `effects`, so an item with
   * no `until` simply has no moment of leaving. The validator checks it names
   * a flag the episode actually declares, the same as `requires` and every
   * effect's `set`.
   */
  until?: string;
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

/**
 * A vehicle an episode brings with it (DESIGN.md §3): the same `Vehicle` a
 * village lists on a map, plus the map it belongs to, and standing on that
 * map only while this episode is the one being played.
 *
 * A village's own `maps.<id>.vehicles` is the traffic that is there every
 * week; this is the pickup parked outside the gas station because *this*
 * week's story needs somebody to be about to drive down the valley. The
 * engine merges the two — `vehiclesOn` in engine/session.ts — so nothing
 * downstream of that knows or cares which list a car came off, and an episode
 * that ends takes its own cars away with it. They are validated exactly like
 * a map's own (engine/validate.ts): a kind the engine can draw, a colour it
 * can paint, and either a drivable path or a `pos` a car could be left on.
 */
export interface EpisodeVehicle extends Vehicle {
  /** Which map it is parked or driving on. */
  map: string;
}

export interface Episode {
  id: string;
  title: string;
  flags: string[];
  npcs: EpisodeNpc[];
  items?: EpisodeItem[];
  signs?: EpisodeSign[];
  /** Cars this week's story brings with it: see `EpisodeVehicle`. */
  vehicles?: EpisodeVehicle[];
  /** Staged moments: see `EpisodeScene` and DESIGN.md §3. */
  scenes?: EpisodeScene[];
  /** Flag-gated patches to a village's one canonical map. */
  overlays?: MapOverlay[];
  /**
   * This episode's own opening, shown right after `copy.json`'s world `intro`
   * on a fresh start of this episode — never on Continue, since that is
   * exactly when the world intro is skipped too (DESIGN.md §3). The world
   * intro sets the place and the controls, once; this is the one or two
   * lines that say what this particular week is about, in the world intro's
   * own voice. Optional: an episode with nothing to add here simply adds
   * nothing. Each line must be non-empty.
   */
  intro?: string[];
  /**
   * This week's small talk (DESIGN.md §3). A world person with no dialogue of
   * their own ordinarily says one of `copy.json`'s `ui.passerby` lines, the
   * same person always getting the same line; when the running episode sets
   * `smallTalk`, its lines take passerby's place for the length of that
   * episode, picked the same way, so what the village is chatting about can
   * change with the week's story without every episode having to repeat
   * `ui.passerby`'s lines. Optional: an episode with nothing to say here
   * simply leaves `ui.passerby` standing. Each line must be non-empty.
   * `engine/session.ts`'s `smallTalkFor` is where this is read.
   */
  smallTalk?: string[];
}

// --- scenes (DESIGN.md §3) ---------------------------------------------------

/**
 * What the lights are doing (DESIGN.md §3). Engine-drawn, so a world pack asks
 * for a mood rather than shipping an asset: `dim` is a warm evening wash over
 * the whole map, `party` adds a few soft coloured discs at the tiles listed in
 * `at` that drift slowly through `colours`, plus a gentle wash of the same
 * colours over the floor. `off` puts the lights back to plain daylight.
 *
 * Slowly is the whole of it: there is no strobe and no flash anywhere in here,
 * and a device asking for reduced motion slows the drift to a crawl
 * (engine/lighting.ts).
 */
export interface LightSpec {
  mode: 'off' | 'dim' | 'party';
  /** Hex colours the discs and the wash move through. Party only. */
  colours?: string[];
  /** Tiles a light disc hangs over. Party only. */
  at?: Vec2[];
  /** Seconds for one turn round the whole set of colours. Default 12. */
  period?: number;
  /** Stays lit through a map change. Default false: walking out clears it. */
  keep?: boolean;
}

/** `move.who` for the player themselves, as opposed to an episode NPC. */
export const SCENE_PLAYER = 'player';

/**
 * `move.who` prefix for something that moves but is nobody: a car on a map's
 * `vehicles` list — or on the running episode's own (`EpisodeVehicle`) —
 * addressed as `"vehicle:<id>"`. The scene runner treats
 * every `who` as an opaque id and hands it to whatever is driving the scene,
 * so a new kind of thing that can be given a path and says when it has
 * arrived needs no change to the runner at all.
 */
export const SCENE_VEHICLE = 'vehicle:';

/** Somebody walks somewhere: to one tile, or along a list of them. */
export interface MoveStep {
  /** An episode NPC's id, `"player"`, or `"vehicle:<id>"`. */
  who: string;
  /** Exactly one of `to` or `path`. */
  to?: Vec2;
  path?: Vec2[];
  /** Tiles per second, for this move only. */
  speed?: number;
}

/** A line or three in the dialogue box. The scene waits for it to be read. */
export interface SayStep {
  /** An episode NPC's id. Left out, the world's narrator says it. */
  who?: string;
  lines: string[];
}

export interface CameraStep {
  /** A tile to look at, or `"player"` to hand the camera back. */
  to: Vec2 | 'player';
  /** Tiles per second. Default 8. */
  speed?: number;
}

/**
 * One beat of a scene. Exactly one of these fields is set; anything else is a
 * malformed step and the validator says so. Every one of them is data — there
 * is no step that runs code (CLAUDE.md hard rule 2).
 */
export interface SceneStep {
  move?: MoveStep;
  say?: SayStep;
  toast?: string;
  /** Seconds to hold, at most `MAX_WAIT`. A is enough to cut it short. */
  wait?: number;
  camera?: CameraStep;
  /** Sets an episode flag — which is also how a scene turns an overlay on. */
  set?: string;
  light?: LightSpec;
  /** Ends the scene here, whatever follows in the list. */
  end?: boolean;
}

/** The longest a `wait` step may hold. A beat, never a pause with weight. */
export const MAX_WAIT = 3;

/** Exactly one of `flag` (when it is set) or `enter` (on arriving at a map). */
export interface SceneTrigger {
  flag?: string;
  enter?: string;
  /** `enter` only: further flags that all have to be true on arrival. */
  requires?: string[];
}

export interface EpisodeScene {
  id: string;
  on: SceneTrigger;
  /** Runs once ever, remembered as `scene:<id>`. Default true. */
  once?: boolean;
  steps: SceneStep[];
}

/** The flag a `once` scene records itself with. Declared for the episode automatically. */
export const sceneFlag = (id: string): string => `scene:${id}`;

/** Every flag an episode's scenes declare on its behalf. */
export function sceneFlags(episode: { scenes?: EpisodeScene[] }): string[] {
  return (episode.scenes ?? []).filter((scene) => scene.once !== false).map((scene) => sceneFlag(scene.id));
}

// --- map overlays (DESIGN.md §3) ---------------------------------------------

/**
 * One tile an overlay paints. `tile` is a tile in the world's tileset — its id
 * on its own where a world has one tileset, or `"<tileset>:<id>"` where a map
 * draws on more than one.
 */
export interface OverlayTile {
  pos: Vec2;
  tile: number | string;
}

/** A readable thing an overlay brings with it: the same as an episode prop sign. */
export interface OverlayProp {
  pos: Vec2;
  lines: string[];
}

/**
 * A flag-gated patch to a canonical map (DESIGN.md §3). There is one map per
 * village, ever; a story changes what is standing on it by painting tiles over
 * it while its flags hold, and nothing about that is saved — overlays derive
 * from flags, so Start over undoes them.
 *
 * `requires` is an AND, as everywhere else; `unless` is its opposite, so the
 * before and after of the same place can never both be on. Overlays apply in
 * the order the episode lists them, and where two paint the same tile the
 * later one shows.
 */
export interface MapOverlay {
  id: string;
  map: string;
  requires: string[];
  unless?: string[];
  tiles: OverlayTile[];
  props?: OverlayProp[];
  fixtures?: Fixture[];
}
