import type { Flags } from './flags';
import type { Credits, Episode, EpisodeItem, EpisodeNpc, EpisodeSign, GameMap, World, WorldCopy } from './schema';

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
}

let current: Session | null = null;

export function startSession(session: Session): void {
  current = session;
}

export function session(): Session {
  if (!current) throw new Error('session used before boot finished');
  return current;
}

export const npcsOn = (mapId: string): EpisodeNpc[] =>
  session().episode.npcs.filter((npc) => npc.map === mapId);

export const itemsOn = (mapId: string): EpisodeItem[] =>
  (session().episode.items ?? []).filter((item) => item.map === mapId);

/** An item is gone once every flag it sets is true. */
export function itemTaken(item: EpisodeItem): boolean {
  const flags = session().flags;
  return item.effects.every((effect) => !effect.set || flags.get(effect.set));
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
 * What a building's door actually says: the episode's sign when it has one for
 * this building and its `requires` are met, otherwise the standing sign the
 * world pack gives the building (DESIGN.md §3). A story always wins over the
 * ordinary day, and a building with neither returns nothing at all — the scene
 * decides what to do with a door that has nothing to say.
 */
export function signLinesFor(buildingId: string): string[] {
  const sign = signFor(buildingId);
  if (sign) return [...sign.lines];
  return [...(session().world.buildings[buildingId]?.sign ?? [])];
}

/**
 * A building's art credit, if it has one and is actually painted (DESIGN.md
 * §2/§4: "painted ones carry an art credit" — an unpainted building has
 * nothing to credit yet, even if credits.json names it ahead of time). Read
 * by the plaque beside the door, which is where the painter is thanked.
 */
export function creditFor(buildingId: string): string | undefined {
  const { assets, credits } = session();
  if (!assets.buildings.has(buildingId)) return undefined;
  return credits.buildings?.[buildingId];
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
