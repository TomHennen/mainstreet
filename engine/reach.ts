/**
 * How close the player has to be to act on something, in tiles, measured
 * centre to centre. One table so the scene that reads things
 * (engine/scenes/map.ts) and the validator that says whether they *can* be
 * read (engine/validate.ts) agree on it.
 *
 * Interiors are tight, so an NPC behind a counter needs more. The plaque is
 * the exception: it is read standing at it, on its own tile, so the
 * building's sign keeps the rest of the front to itself. A fixture is solid,
 * so unlike the plaque it is read from the tile beside it: far enough to take
 * in a diagonal neighbour, not far enough to reach past one. A prop sign —
 * a shelf, a board, a door with a note on it — reaches a little further, two
 * tiles straight on, which is what lets something on the back wall be read
 * across the counter in front of it.
 */
export const REACH = { npcVillage: 2.0, npcInterior: 2.3, item: 2.0, door: 2.2, prop: 2.1, plaque: 0.75, fixture: 1.5 } as const;

/**
 * The tile offsets whose centres lie within `reach` of a tile's own centre —
 * every tile something could be acted on from, in the order the nearest
 * comes first.
 */
export function offsetsWithin(reach: number): [number, number][] {
  const span = Math.ceil(reach);
  const out: [number, number][] = [];
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if ((dx !== 0 || dy !== 0) && Math.hypot(dx, dy) <= reach) out.push([dx, dy]);
    }
  }
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
}
