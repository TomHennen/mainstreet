/**
 * Road ends (DESIGN.md §2): what the game says when a road simply runs out
 * at the edge of what's mapped, rather than the player bouncing off an
 * invisible wall or wandering onto grass that was never meant to lead
 * anywhere. Kept pure and separate from `MapScene` — the lookup, and the
 * "this exact spot always says the same thing" hashing — is what
 * `engine/edges.test.ts` exercises without a scene.
 */
import { tileAt } from './tiled.ts';
import type { GameMap, MapEdge, MapLost, Rect } from './schema';

const within = (at: Rect, x: number, y: number): boolean =>
  x >= at[0] && x < at[0] + at[2] && y >= at[1] && y < at[1] + at[3];

/** Whether two `at`-shaped rectangles share any tile. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** The map's own `edges` entry standing on this tile, if any. */
export function edgeAt(map: GameMap, x: number, y: number): MapEdge | undefined {
  return map.edges?.find((edge) => within(edge.at, x, y));
}

/** Bare ground: a road never "ends" here, it just isn't paved any more. */
const QUIET_KINDS = new Set(['grass', 'tree', 'flowers']);

/**
 * A deterministic pick from `lines` by tile position, so the same spot on
 * the map always says the same thing rather than changing on every visit.
 * Not cryptographic — just enough spread that neighbouring tiles usually
 * land on different lines.
 */
export function pickByPosition<T>(x: number, y: number, lines: readonly T[]): T | undefined {
  if (!lines.length) return undefined;
  const hash = (x * 374761393 + y * 668265263) >>> 0;
  return lines[hash % lines.length];
}

/**
 * The generic `ui.roadEnd` line for this tile, or none. Only at the map's
 * own boundary, only where the ground is some kind of road (never grass or
 * trees), and only for the caller to use once it has already checked there
 * is no `exits` or `edges` entry standing on the spot instead.
 */
export function roadEndLine(
  map: GameMap,
  x: number,
  y: number,
  lines: readonly string[] | undefined
): string | undefined {
  if (!lines?.length) return undefined;
  if (x !== 0 && y !== 0 && x !== map.width - 1 && y !== map.height - 1) return undefined;
  const tile = tileAt(map, x, y);
  if (!tile || QUIET_KINDS.has(tile.kind)) return undefined;
  return pickByPosition(x, y, lines);
}

/**
 * The map's `lost` entry, if walking onto this tile is walking off into the
 * woods (DESIGN.md §2): the tile is on the map's own boundary, the ground
 * there is the bare kind a road end stays quiet about, and nothing else —
 * no `exits` entry, no `edges` entry — is already standing on the spot. A
 * road at the boundary is never "lost": it is a road end, and says so.
 */
export function lostAt(map: GameMap, x: number, y: number): MapLost | undefined {
  if (!map.lost) return undefined;
  if (x !== 0 && y !== 0 && x !== map.width - 1 && y !== map.height - 1) return undefined;
  const tile = tileAt(map, x, y);
  if (!tile || !QUIET_KINDS.has(tile.kind)) return undefined;
  if (map.exits.some((exit) => within(exit.at, x, y)) || edgeAt(map, x, y)) return undefined;
  return map.lost;
}
