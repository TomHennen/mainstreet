/**
 * Flag-gated map overlays (DESIGN.md §3).
 *
 * There is one canonical map per village and there always will be: an episode
 * that changes what is standing on it paints tiles over the top of it while
 * its flags hold, rather than shipping a copy of the map. Nothing about an
 * overlay is saved — it derives from flags, so Start over undoes it — and the
 * whole of it is data (CLAUDE.md hard rules 1 and 2).
 *
 * Pure, and Phaser-free: the patch it works out is a plain extra tile layer,
 * which is what makes collision, pathfinding, `isSolid` and the validator all
 * follow an overlay for free.
 */
import type { Fixture, GameMap, MapOverlay, OverlayProp, Vec2 } from './schema';
import type { TileDef, TileGrid } from './tiled';

/** Reads flags the way `engine/flags.ts` does, without importing it. */
export interface FlagView {
  get(name: string): boolean;
  met(names: string[] | undefined): boolean;
}

/**
 * The overlays on one map that are on right now, in the order the episode
 * lists them — which is the order they paint in, so where two of them cover
 * the same tile the later one shows.
 */
export function activeOverlays(overlays: MapOverlay[] | undefined, mapId: string, flags: FlagView): MapOverlay[] {
  return (overlays ?? []).filter(
    (overlay) =>
      overlay.map === mapId &&
      flags.met(overlay.requires) &&
      !(overlay.unless ?? []).some((name) => flags.get(name))
  );
}

/**
 * A tile reference as an episode writes it: the tile's id on its own where a
 * world has one tileset, or `"<tileset>:<id>"` where a map draws on more than
 * one. Null when no tileset this map uses has that tile.
 */
export function resolveTile(grid: Pick<TileGrid, 'tilesets'>, ref: number | string): TileDef | null {
  if (typeof ref === 'number') {
    for (const tileset of grid.tilesets) {
      const tile = tileset.tiles.get(ref);
      if (tile) return tile;
    }
    return null;
  }
  const at = ref.lastIndexOf(':');
  if (at <= 0) return null;
  const id = Number(ref.slice(at + 1));
  if (!Number.isInteger(id)) return null;
  const tileset = grid.tilesets.find((entry) => entry.name === ref.slice(0, at));
  return tileset?.tiles.get(id) ?? null;
}

/** What a set of overlays adds to a map, worked out once. */
export interface OverlayPatch {
  /** Cell index into the grid, to the tile painted there. */
  cells: Map<number, TileDef>;
  fixtures: Fixture[];
  props: OverlayProp[];
  /** Tile refs no tileset on this map has — reported by the validator. */
  unknown: { overlay: string; pos: Vec2; tile: number | string }[];
}

export function patchFor(map: GameMap, overlays: MapOverlay[]): OverlayPatch {
  const cells = new Map<number, TileDef>();
  const fixtures: Fixture[] = [];
  const props: OverlayProp[] = [];
  const unknown: OverlayPatch['unknown'] = [];

  for (const overlay of overlays) {
    for (const paint of overlay.tiles ?? []) {
      const [x, y] = paint.pos;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const tile = resolveTile(map, paint.tile);
      if (!tile) {
        unknown.push({ overlay: overlay.id, pos: [x, y], tile: paint.tile });
        continue;
      }
      cells.set(y * map.width + x, tile);
    }
    for (const fixture of overlay.fixtures ?? []) fixtures.push(fixture);
    for (const prop of overlay.props ?? []) props.push(prop);
  }

  return { cells, fixtures, props, unknown };
}

/** The name of the tile layer an overlay's tiles are painted into. */
export const OVERLAY_LAYER = 'overlay';

/**
 * The map as it is with these overlays on: the same grid with one more tile
 * layer over the top, and any fixtures they bring. Everything that reads a map
 * — the collision test, the pathfinder, the drawn texture, the validator —
 * takes it from here without knowing an overlay was involved.
 *
 * The map is handed straight back when nothing is on, so an ordinary week
 * costs nothing at all.
 */
export function withOverlays(map: GameMap, overlays: MapOverlay[]): GameMap {
  if (!overlays.length) return map;
  const patch = patchFor(map, overlays);
  if (!patch.cells.size && !patch.fixtures.length) return map;

  const cells: (TileDef | null)[] = new Array(map.width * map.height).fill(null);
  for (const [index, tile] of patch.cells) cells[index] = tile;

  return {
    ...map,
    layers: [...map.layers, { name: OVERLAY_LAYER, cells }],
    fixtures: patch.fixtures.length ? [...(map.fixtures ?? []), ...patch.fixtures] : map.fixtures
  };
}

/**
 * Whether these overlays could ever be on at the same time. Flags are plain
 * booleans, so the only thing that keeps two apart is one of them requiring a
 * flag the other rules out — which is exactly what `unless` is for
 * (DESIGN.md §3: flood is `requires: [damBuilt], unless: [damBroken]`).
 */
export function canCoOccur(overlays: MapOverlay[]): boolean {
  const required = new Set<string>();
  const barred = new Set<string>();
  for (const overlay of overlays) {
    for (const name of overlay.requires ?? []) required.add(name);
    for (const name of overlay.unless ?? []) barred.add(name);
  }
  for (const name of required) if (barred.has(name)) return false;
  return true;
}

/**
 * Every set of overlays on one map that could be on together, smallest first,
 * the empty set (the ordinary map) included. Subsets grow exponentially, so
 * past `MAX_EXHAUSTIVE` overlays on one map this settles for every single one
 * and every pair — which is where an overlap or an unreachable door actually
 * shows up.
 */
export const MAX_EXHAUSTIVE = 8;

export function combinations(overlays: MapOverlay[]): MapOverlay[][] {
  const out: MapOverlay[][] = [];
  if (overlays.length <= MAX_EXHAUSTIVE) {
    for (let mask = 0; mask < 1 << overlays.length; mask++) {
      const set = overlays.filter((_, index) => (mask >> index) & 1);
      if (canCoOccur(set)) out.push(set);
    }
    return out;
  }
  out.push([]);
  for (let i = 0; i < overlays.length; i++) {
    out.push([overlays[i]]);
    for (let j = i + 1; j < overlays.length; j++) {
      const pair = [overlays[i], overlays[j]];
      if (canCoOccur(pair)) out.push(pair);
    }
  }
  return out;
}

/**
 * Tiles more than one of these overlays paints. Reported rather than refused:
 * layering two patches on one tile is allowed, and the later one wins, but it
 * has to be somebody's decision rather than an accident.
 */
export function overlapsIn(overlays: MapOverlay[]): { pos: Vec2; ids: string[] }[] {
  const painters = new Map<string, string[]>();
  for (const overlay of overlays) {
    for (const paint of overlay.tiles ?? []) {
      const key = `${paint.pos[0]},${paint.pos[1]}`;
      const list = painters.get(key) ?? [];
      if (!list.includes(overlay.id)) list.push(overlay.id);
      painters.set(key, list);
    }
  }
  const out: { pos: Vec2; ids: string[] }[] = [];
  for (const [key, ids] of painters) {
    if (ids.length < 2) continue;
    const [x, y] = key.split(',').map(Number);
    out.push({ pos: [x, y], ids });
  }
  return out;
}
