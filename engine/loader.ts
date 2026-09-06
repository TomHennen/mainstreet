import Phaser from 'phaser';
import type { Episode, World, WorldCopy } from './schema';
import type { AssetIndex } from './session';

const worldRoot = (worldId: string) => `/worlds/${worldId}`;

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface LoadedWorld {
  world: World;
  copy: WorldCopy;
  episodes: Episode[];
}

export async function loadWorld(worldId: string): Promise<LoadedWorld> {
  const root = worldRoot(worldId);
  const [world, copy] = await Promise.all([
    json<World>(`${root}/world.json`),
    json<WorldCopy>(`${root}/copy.json`)
  ]);

  if (world.id !== worldId) {
    throw new Error(`world pack at ${root} declares id "${world.id}"`);
  }

  const episodes = await Promise.all(
    world.episodes.map((id) => json<Episode>(`${root}/episodes/${id}.json`))
  );

  return { world, copy, episodes };
}

/**
 * Assets load by convention with graceful fallback (CLAUDE.md hard rule 3): ask
 * whether each conventional path exists, and let the caller draw a placeholder
 * for every one that does not. A 404 here is the normal case for an unpainted
 * world, not an error.
 */
async function exists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

export async function indexAssets(world: World, episodes: Episode[]): Promise<AssetIndex> {
  const root = worldRoot(world.id);
  const buildingIds = Object.keys(world.buildings);
  const charIds = [world.player.id, ...episodes.flatMap((episode) => episode.npcs.map((npc) => npc.id))];

  const [buildings, chars, portraits] = await Promise.all([
    filterExisting(buildingIds, (id) => `${root}/assets/buildings/${id}.png`),
    filterExisting(charIds, (id) => `${root}/assets/chars/${id}.png`),
    filterExisting(charIds, (id) => `${root}/assets/portraits/${id}.png`)
  ]);

  return { buildings, chars, portraits };
}

async function filterExisting(ids: string[], url: (id: string) => string): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => exists(url(id))));
  return new Set(unique.filter((_, index) => found[index]));
}

/** Hands the discovered assets to Phaser's loader, keyed by convention. */
export function queueAssets(load: Phaser.Loader.LoaderPlugin, world: World, assets: AssetIndex): void {
  const root = worldRoot(world.id);
  for (const id of assets.buildings) load.image(`art:building:${id}`, `${root}/assets/buildings/${id}.png`);
  for (const id of assets.chars) {
    load.spritesheet(`art:char:${id}`, `${root}/assets/chars/${id}.png`, { frameWidth: 16, frameHeight: 32 });
  }
  for (const id of assets.portraits) load.image(`art:portrait:${id}`, `${root}/assets/portraits/${id}.png`);
}
