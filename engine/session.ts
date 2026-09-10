/**
 * The running session and the lookups over it (DESIGN.md §2/§3).
 *
 * Everything here is a lookup over already-loaded data, and every import is a
 * type: `scripts/build-site.mjs` imports `joinCredits` from this file under
 * plain Node, which can only strip types away. The save side, which does need
 * code at runtime, lives in `engine/progress.ts`.
 */
import { hashId } from './mover.ts';
import { activeOverlays } from './overlay.ts';
import type { SaveFile } from './save';
import type { Flags } from './flags';
import type {
  Credits,
  Episode,
  EpisodeItem,
  EpisodeNpc,
  EpisodeSign,
  Facing,
  GameMap,
  LightSpec,
  MapOverlay,
  Person,
  Vec2,
  Vehicle,
  World,
  WorldCopy
} from './schema';

/** Which convention-named assets actually exist in the world pack. */
export interface AssetIndex {
  buildings: Set<string>;
  chars: Set<string>;
  portraits: Set<string>;
  /** Tilesets whose image is painted; the rest fall back to drawn tiles. */
  tilesets: Set<string>;
  /** Vehicles with a painted sheet; the rest fall back to the drawn car. */
  vehicles: Set<string>;
}

export interface Session {
  world: World;
  /** world.json's map metadata joined to the Tiled grids, by map id. */
  maps: Record<string, GameMap>;
  copy: WorldCopy;
  episode: Episode;
  flags: Flags;
  assets: AssetIndex;
  /** Art credits, or {} if the world pack has none. */
  credits: Credits;
  /** True while a dialogue box or a transition owns the input. */
  dialogueOpen: boolean;
  lastDialogueClose: number;
  locked: boolean;
  /**
   * True from the moment a staged scene (DESIGN.md §3, `engine/scene.ts`)
   * starts until its last step finishes — mirrors `MapScene`'s own
   * `this.runner !== null`, so a check elsewhere (the "with you" panel's own
   * guard against opening mid-scene, `engine/scenes/ui.ts`) doesn't need a
   * scene reference. Unlike `locked`, which only the travel interstitial
   * sets, this covers a staged scene's quieter beats too — a `wait` or a walk
   * with no dialogue box open — when input would otherwise look free.
   */
  sceneRunning: boolean;
  /** Shown once, on the first village the player lands in. */
  introShown: boolean;
  /**
   * Items already picked up. Derivable from the flags an item sets, but kept
   * in its own right so a save can say plainly what is gone (DESIGN.md §2).
   */
  taken: Set<string>;
  /**
   * The carry-verb token the player is holding, if any — a split log off the
   * pile, nothing else (DESIGN.md §2). Mirrors the map scene's own `held`
   * field so `engine/inventory.ts`'s `withYou` can read it without a scene
   * reference; kept exactly the same way — this map only, never saved, and
   * cleared whenever a map loads.
   */
  held: string | null;
  /** Where the player is standing, kept current by the map scene for the save. */
  place: { map: string; pos: Vec2; facing: Facing };
  /**
   * The lighting a scene asked to keep through a map change (DESIGN.md §3).
   * Null is plain daylight, which is what walking out of a lit room gives you
   * unless the scene said otherwise. Never saved: an episode relights what it
   * wants lit, so a save can never strand somebody in the dark.
   */
  light: LightSpec | null;
  /** The world's save file, in memory: mutated, then written in one go. */
  save: SaveFile;
  /**
   * Whether this session writes to the save at all. A `?episode=` review run
   * plays from the start and leaves the player's own progress alone
   * (DESIGN.md §3).
   */
  recording: boolean;
}

let current: Session | null = null;

export function startSession(session: Session): void {
  current = session;
}

export function session(): Session {
  if (!current) throw new Error('session used before boot finished');
  return current;
}

/** The session if there is one, for callers that would rather not throw. */
export function sessionOrNull(): Session | null {
  return current;
}

export const npcsOn = (mapId: string): EpisodeNpc[] =>
  session().episode.npcs.filter((npc) => npc.map === mapId);

/**
 * The townspeople a village keeps whether or not a story is running
 * (DESIGN.md §2). They come from `world.json`, not from the episode, so they
 * are on the street every week — and they carry no dialogue, only a look and
 * somewhere to be.
 */
export const peopleOn = (mapId: string): Person[] => session().world.maps[mapId]?.people ?? [];

/** About one time in five, a world person's small talk gives way to trivia instead (DESIGN.md §2). */
export const TRIVIA_CHANCE = 0.2;

/**
 * The lines a world person with no story of their own draws small talk from
 * (DESIGN.md §2/§3): the running episode's own `smallTalk` when it has any,
 * else the world's `ui.passerby`. Either way it is picked by the person's id,
 * so the same person always says the same thing.
 */
const smallTalkLines = (): string[] => session().episode.smallTalk ?? session().copy.ui.passerby ?? [];

/**
 * Whether pressing A on a world person with no story of their own does
 * anything at all. `ui.trivia` never counts on its own here: it only ever
 * displaces an existing small-talk line (below), so it cannot make somebody
 * with nothing ordinarily to say suddenly worth talking to.
 */
export function hasSmallTalk(): boolean {
  return smallTalkLines().length > 0;
}

/**
 * What a world person with no story of their own says when spoken to
 * (DESIGN.md §2/§3). Ordinarily their small talk (`smallTalkLines`, above),
 * picked by id so the same person always says the same thing — but about one
 * time in five `ui.trivia` gets a turn instead: a real roll, not tied to who
 * is asked and never saved, so the same person might say it twice running or
 * never at all. Returns undefined when there is nothing at all to say.
 * `random` defaults to `Math.random`; a test supplies its own to make the
 * roll land a chosen way.
 */
export function smallTalkFor(person: { id: string }, random: () => number = Math.random): string | undefined {
  const trivia = session().copy.ui.trivia ?? [];
  if (smallTalkLines().length > 0 && trivia.length > 0 && random() < TRIVIA_CHANCE) {
    return trivia[Math.floor(random() * trivia.length)];
  }
  const lines = smallTalkLines();
  if (!lines.length) return undefined;
  return lines[hashId(person.id) % lines.length];
}

/**
 * The overlays patching this map right now (DESIGN.md §3): this episode's, in
 * the order it lists them, with every `requires` met and no `unless` set.
 */
export const overlaysOn = (mapId: string): MapOverlay[] =>
  activeOverlays(session().episode.overlays, mapId, session().flags);

/**
 * The traffic on a map (DESIGN.md §2/§3): the village's own ambient cars
 * first, then any the running episode parks or drives here.
 *
 * The two lists are merged in exactly one place — here — so everything
 * downstream (the scene that draws them, the scene runner that can send one
 * somewhere) sees one list and never learns which of them a car came off. A
 * village's cars are there every week; an episode's stand only while that
 * episode is the one being played, which is what lets a story park somebody's
 * pickup outside for a morning without the village gaining a pickup for ever.
 */
export const vehiclesOn = (mapId: string): Vehicle[] => [
  ...(session().world.maps[mapId]?.vehicles ?? []),
  ...(session().episode.vehicles ?? []).filter((vehicle) => vehicle.map === mapId)
];

export const itemsOn = (mapId: string): EpisodeItem[] =>
  (session().episode.items ?? []).filter((item) => item.map === mapId);

/**
 * An item is gone once it has been picked up, or once every flag it sets is
 * true. `state` defaults to the running session; `engine/inventory.ts` passes
 * one explicitly so `withYou` stays a pure function over a session it's handed
 * rather than the global one.
 */
export function itemTaken(item: EpisodeItem, state: Session = session()): boolean {
  if (state.taken.has(item.id)) return true;
  return item.effects.every((effect) => !effect.set || state.flags.get(effect.set));
}

export function itemVisible(item: EpisodeItem): boolean {
  return session().flags.met(item.requires) && !itemTaken(item);
}

/** First match wins, exactly as with dialogue. */
export function signFor(buildingId: string): EpisodeSign | undefined {
  const { episode, flags } = session();
  return (episode.signs ?? []).find((sign) => sign.building === buildingId && flags.met(sign.requires));
}

/**
 * What a building's door actually says: the episode's sign for this building,
 * when it has one whose `requires` are met, followed by the standing sign the
 * world pack gives the building (DESIGN.md §3). The story goes on top of the
 * ordinary day rather than in place of it — a flyer in the window does not
 * take the window with it — unless the episode's sign sets `replace`, which
 * gives the door over to the story entirely. A building with neither kind of
 * sign returns nothing at all, and the scene decides what to do with a door
 * that has nothing to say.
 */
export function signLinesFor(buildingId: string): string[] {
  const standing = session().world.buildings[buildingId]?.sign ?? [];
  const sign = signFor(buildingId);
  if (!sign) return [...standing];
  if (sign.replace) return [...sign.lines];
  return [...sign.lines, ...standing];
}

/**
 * Joins painter names the way the plaque reads them out loud, no Oxford
 * comma: one name alone, two joined by "and", three or more comma-separated
 * with "and" before the last — "Tom", "Tom and Lana", "Tom, Lana and Alice".
 * Shared by `creditFor` and by whatever else turns a `credits.json` entry
 * (a single name today, or an array in order of contribution) into copy.
 */
export function joinCredits(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A building's art credit, if it has one and is actually painted (DESIGN.md
 * §2/§4: "painted ones carry an art credit" — an unpainted building has
 * nothing to credit yet, even if credits.json names it ahead of time). Read
 * by the plaque beside the door, which is where the painter — or painters —
 * are thanked, and by the title screen's Credits list, which has no running
 * session to read `assets`/`credits` from — hence the second argument,
 * defaulted to the session's own for every other caller. A `credits.json`
 * entry may be one name or an array of names, in order of contribution;
 * either way this returns one joined line.
 */
export function creditFor(
  buildingId: string,
  ctx: { assets: AssetIndex; credits: Credits } = session()
): string | undefined {
  const { assets, credits } = ctx;
  if (!assets.buildings.has(buildingId)) return undefined;
  const entry = credits.buildings?.[buildingId];
  if (entry === undefined) return undefined;
  return joinCredits(Array.isArray(entry) ? entry : [entry]);
}

/**
 * Prop signs sit on a map tile instead of a building (DESIGN.md §3). One per
 * tile: first match wins there too.
 */
export function propSignsOn(mapId: string): EpisodeSign[] {
  const { episode, flags } = session();
  const seen = new Set<string>();
  const out: EpisodeSign[] = [];
  const add = (sign: EpisodeSign) => {
    if (!sign.pos) return;
    const at = `${sign.pos[0]},${sign.pos[1]}`;
    if (seen.has(at)) return;
    seen.add(at);
    out.push(sign);
  };
  for (const sign of episode.signs ?? []) {
    if (sign.map !== mapId || !sign.pos || !flags.met(sign.requires)) continue;
    add(sign);
  }
  // A prop an overlay brought with it reads exactly like any other one; its
  // `requires` are the overlay's, which is what put it on the map at all
  // (DESIGN.md §3). The episode's own signs are listed first, so a sign
  // written for a tile still wins over a patch that covers the same tile.
  for (const overlay of overlaysOn(mapId)) {
    for (const prop of overlay.props ?? []) {
      add({ map: mapId, pos: prop.pos, requires: overlay.requires, lines: prop.lines });
    }
  }
  return out;
}

export function dialogueFor(npc: EpisodeNpc) {
  const flags = session().flags;
  return npc.dialogue.find((entry) => flags.met(entry.requires));
}
