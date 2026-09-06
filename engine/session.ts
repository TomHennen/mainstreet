import type { Flags } from './flags';
import type { Episode, EpisodeItem, EpisodeNpc, EpisodeSign, World, WorldCopy } from './schema';

/** Which convention-named assets actually exist in the world pack. */
export interface AssetIndex {
  buildings: Set<string>;
  chars: Set<string>;
  portraits: Set<string>;
}

export interface Session {
  world: World;
  copy: WorldCopy;
  episode: Episode;
  flags: Flags;
  assets: AssetIndex;
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
