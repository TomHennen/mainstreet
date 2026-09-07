/**
 * The running session and the lookups over it (DESIGN.md §2/§3).
 *
 * Everything here is a lookup over already-loaded data, and every import is a
 * type: `scripts/build-site.mjs` imports `joinCredits` from this file under
 * plain Node, which can only strip types away. The save side, which does need
 * code at runtime, lives in `engine/progress.ts`.
 */
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
  Person,
  Vec2,
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
  /** Shown once, on the first village the player lands in. */
  introShown: boolean;
  /**
   * Items already picked up. Derivable from the flags an item sets, but kept
   * in its own right so a save can say plainly what is gone (DESIGN.md §2).
   */
  taken: Set<string>;
  /** Where the player is standing, kept current by the map scene for the save. */
  place: { map: string; pos: Vec2; facing: Facing };
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

export const itemsOn = (mapId: string): EpisodeItem[] =>
  (session().episode.items ?? []).filter((item) => item.map === mapId);

/** An item is gone once it has been picked up, or once every flag it sets is true. */
export function itemTaken(item: EpisodeItem): boolean {
  const state = session();
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
 * are thanked. A `credits.json` entry may be one name or an array of names,
 * in order of contribution; either way this returns one joined line.
 */
export function creditFor(buildingId: string): string | undefined {
  const { assets, credits } = session();
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
  for (const sign of episode.signs ?? []) {
    if (sign.map !== mapId || !sign.pos || !flags.met(sign.requires)) continue;
    const at = `${sign.pos[0]},${sign.pos[1]}`;
    if (seen.has(at)) continue;
    seen.add(at);
    out.push(sign);
  }
  return out;
}

export function dialogueFor(npc: EpisodeNpc) {
  const flags = session().flags;
  return npc.dialogue.find((entry) => flags.met(entry.requires));
}
