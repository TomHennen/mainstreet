/**
 * The tiles a square footprint overlaps, in tile units.
 *
 * Shared by the player's own hitbox (`playerTiles` in engine/scenes/map.ts)
 * and the give-way sweep test that checks a car never overlaps it
 * (engine/vehicle.sweep.test.ts) — one rectangle, read the same way in both
 * places, rather than two hand-copied versions of it drifting apart.
 *
 * `x`/`y` is the footprint's own top-left corner, in tiles (as floats); `size`
 * is its full side length in tiles (1 for a single ordinary tile's own
 * hitbox); `inset` shrinks it by this many tiles on every side — the margin a
 * sprite's hitbox keeps clear of a tile's own edge, so two people brushing
 * past each other in a doorway are not squeezed by their corners. Checking
 * all four (inset) corners is enough: a box no bigger than one tile touches
 * at most a 2x2 huddle of them, and every one of those is one of the four.
 */
import type { Vec2 } from './schema';

export function footprintTiles(x: number, y: number, size: number, inset: number): Vec2[] {
  const lo = inset;
  const hi = size - inset;
  const tiles: Vec2[] = [];
  for (const ox of [lo, hi]) {
    for (const oy of [lo, hi]) {
      const tx = Math.floor(x + ox);
      const ty = Math.floor(y + oy);
      if (!tiles.some((tile) => tile[0] === tx && tile[1] === ty)) tiles.push([tx, ty]);
    }
  }
  return tiles;
}
