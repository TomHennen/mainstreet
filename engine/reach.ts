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
 * in a diagonal neighbour, not far enough to reach past one. A prop (a wall
 * panel, a bathroom door, the chalkboard, a shelf) only prompts when the
 * player is actually touching it: an orthogonally adjacent tile centre is
 * exactly 1 tile away, a diagonal one is √2 (~1.41) away. 1.1 clears the
 * former with enough slack for a walk that settles a little off the grid
 * (movement measured in headless play lands as far as ~1.05 off-centre)
 * while staying well clear of the latter. Something on the wall behind a
 * counter is therefore read from the counter: its sign sits on the counter
 * tile in front (scripts/make-room.ts `signAt`).
 */
export const REACH = { npcVillage: 2.0, npcInterior: 2.3, item: 2.0, door: 2.2, prop: 1.1, plaque: 0.75, fixture: 1.5 } as const;

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

/**
 * Whether the line from tile `a` to tile `b` passes through nothing opaque —
 * a wall, or anything else a world says cannot be seen or reached through
 * (the `opaque` tile property, engine/tiled.ts). Reach is a plain distance,
 * and two rooms can sit back to back with one wall tile between them, so
 * reach alone would read a shelf through the wall behind it. This is the
 * other half of "in reach": a straight line, centre to centre (Bresenham),
 * with every tile strictly between the two checked and the two themselves
 * left out, so a sign hung on an opaque wall is still read from beside it
 * and a counter, which is solid but not opaque, is still read across.
 * Neighbours, diagonal ones included, have nothing between them, so they
 * are always clear.
 */
export function clearBetween(a: [number, number], b: [number, number], isOpaque: (x: number, y: number) => boolean): boolean {
  let [x, y] = a;
  const [bx, by] = b;
  const dx = Math.abs(bx - x);
  const dy = -Math.abs(by - y);
  const sx = x < bx ? 1 : -1;
  const sy = y < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === bx && y === by) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === bx && y === by) return true;
    if (isOpaque(x, y)) return false;
  }
}
