import Phaser from 'phaser';
import { parseTiledMap, parseTileset, tilesetSources } from './tiled';
import type { TilesetDef } from './tiled';
import type { Credits, Episode, GameMap, World, WorldCopy } from './schema';
import type { AssetIndex } from './session';

// Prefixed with Vite's base path so the build works under a sub-path such as
// GitHub Pages' `/<repo>/`. BASE_URL always ends with a slash.
const worldRoot = (worldId: string) => `${import.meta.env.BASE_URL}worlds/${worldId}`;

/** Resolves a path written inside a world-pack file, relative to that file. */
const relative = (from: string, to: string) => new URL(to, new URL(from, location.href)).toString();

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Same as `json`, but a missing file is not an error — used for world-pack
 * files that are optional by convention (credits.json: CLAUDE.md hard rule 3,
 * DESIGN.md §2/§4). Any other fetch failure still throws.
 */
async function optionalJson<T>(url: string, fallback: T): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (response.status === 404) return fallback;
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface LoadedWorld {
  world: World;
  copy: WorldCopy;
  episodes: Episode[];
  /** world.json's per-map metadata joined to each map's Tiled grid. */
  maps: Record<string, GameMap>;
  /** Every tileset the maps reference, by name. */
  tilesets: TilesetDef[];
  /** Art credits, or {} if the world pack has none (DESIGN.md §2/§4). */
  credits: Credits;
}

export async function loadWorld(worldId: string): Promise<LoadedWorld> {
  const root = worldRoot(worldId);
  const [world, copy, credits] = await Promise.all([
    json<World>(`${root}/world.json`),
    json<WorldCopy>(`${root}/copy.json`),
    optionalJson<Credits>(`${root}/credits.json`, {})
  ]);

  if (world.id !== worldId) {
    throw new Error(`world pack at ${root} declares id "${world.id}"`);
  }

  const episodes = await Promise.all(
    world.episodes.map((id) => json<Episode>(`${root}/episodes/${id}.json`))
  );

  // Maps load by convention: one Tiled file per map id in world.json
  // (DESIGN.md §2). Their external tilesets are fetched in a second pass,
  // because only the map files say which ones they need.
  const mapIds = Object.keys(world.maps);
  const mapUrls = Object.fromEntries(mapIds.map((id) => [id, `${root}/maps/${id}.json`]));
  const rawMaps = Object.fromEntries(
    await Promise.all(mapIds.map(async (id) => [id, await json<unknown>(mapUrls[id])] as const))
  );

  const tilesetUrls = new Set<string>();
  for (const id of mapIds) {
    for (const source of tilesetSources(rawMaps[id], mapUrls[id])) {
      tilesetUrls.add(relative(mapUrls[id], source));
    }
  }
  const byUrl = new Map<string, TilesetDef>(
    await Promise.all(
      [...tilesetUrls].map(async (url) => {
        const tileset = parseTileset(await json<unknown>(url), url);
        // The tileset says where its PNG lives; the loader turns that into a
        // URL it can probe and hand to Phaser.
        tileset.imageUrl = relative(url, tileset.image);
        return [url, tileset] as const;
      })
    )
  );

  const maps: Record<string, GameMap> = {};
  for (const id of mapIds) {
    const grid = parseTiledMap(
      rawMaps[id],
      (source) => byUrl.get(relative(mapUrls[id], source)),
      mapUrls[id]
    );
    maps[id] = { ...world.maps[id], ...grid };
  }

  return { world, copy, episodes, maps, tilesets: [...byUrl.values()], credits };
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

export async function indexAssets(loaded: LoadedWorld): Promise<AssetIndex> {
  const { world, episodes, tilesets } = loaded;
  const root = worldRoot(world.id);
  const buildingIds = Object.keys(world.buildings);
  const charIds = [world.player.id, ...episodes.flatMap((episode) => episode.npcs.map((npc) => npc.id))];

  const [buildings, chars, portraits, painted] = await Promise.all([
    filterExisting(buildingIds, (id) => `${root}/assets/buildings/${id}.png`),
    filterExisting(charIds, (id) => `${root}/assets/chars/${id}.png`),
    filterExisting(charIds, (id) => `${root}/assets/portraits/${id}.png`),
    // A tileset names its own image, so that path is probed rather than a
    // conventional one; the fallback is the engine-drawn placeholder sheet.
    filterExisting(
      tilesets.map((tileset) => tileset.name),
      (name) => tilesets.find((tileset) => tileset.name === name)?.imageUrl ?? ''
    )
  ]);

  return { buildings, chars, portraits, tilesets: painted };
}

async function filterExisting(ids: string[], url: (id: string) => string): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => exists(url(id))));
  return new Set(unique.filter((_, index) => found[index]));
}

/** Hands the discovered assets to Phaser's loader, keyed by convention. */
export function queueAssets(load: Phaser.Loader.LoaderPlugin, loaded: LoadedWorld, assets: AssetIndex): void {
  const root = worldRoot(loaded.world.id);
  for (const id of assets.buildings) load.image(`art:building:${id}`, `${root}/assets/buildings/${id}.png`);
  for (const id of assets.chars) {
    load.spritesheet(`art:char:${id}`, `${root}/assets/chars/${id}.png`, { frameWidth: 16, frameHeight: 32 });
  }
  for (const id of assets.portraits) load.image(`art:portrait:${id}`, `${root}/assets/portraits/${id}.png`);
  for (const tileset of loaded.tilesets) {
    if (assets.tilesets.has(tileset.name) && tileset.imageUrl) {
      load.image(`art:tiles:${tileset.name}`, tileset.imageUrl);
    }
  }
}
