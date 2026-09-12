import type { Paint } from './figure';

/**
 * The door arrow: a small chunky arrow, pointing up into the door, painted
 * on the doorstep of a door that actually opens (CLAUDE.md #4, DESIGN.md
 * §2). Kept out of engine/art.ts for the same reason engine/figure.ts and
 * engine/motor.ts are — all this asks of a canvas is `fillStyle` and
 * `fillRect` — so the same recipe can be drawn straight into a Phaser
 * texture (`engine/art.ts` `doorArrowArt`) or into the Studio's plain
 * `<canvas>` reference preview (`studio/studio.ts`) without either of them
 * duplicating the pixels or pulling Phaser into the other's bundle.
 *
 * Two-tone like a stencilled road marking — a light fill outlined in the
 * engine's own dark ink, the same pair the doormat this replaced was
 * painted in — never a colour a world hands in (hard rule 1).
 */

/** The arrow, in pixels: a stubby arrowhead over a short stem. */
export const DOOR_ARROW_W = 10;
export const DOOR_ARROW_H = 9;

const OUTLINE = '#6b4a35';
const FILL = '#caa06a';

/** The arrowhead over its stem, one row at a time (y, x, w) — widest at the
 *  base of the head, pointing up toward the door above. */
const ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 4, 2], // tip
  [2, 3, 4],
  [3, 2, 6],
  [4, 1, 8], // base of the head
  [5, 3, 4], // stem
  [6, 3, 4],
  [7, 3, 4]
];

/**
 * Paints the arrow at `ox, oy` in `ctx` — the outline first (each row's own
 * span widened by a pixel either side, plus its unwidened span copied a
 * pixel above and below, which, drawn for every row before any fill goes
 * down, leaves a clean one-pixel border all the way round, corners and
 * steps included), then the fill on top. Fits a `DOOR_ARROW_W x
 * DOOR_ARROW_H` box exactly, so a caller sizing a canvas to that has no
 * clipping to worry about.
 */
export function paintDoorArrow(ctx: Paint, ox = 0, oy = 0): void {
  ctx.fillStyle = OUTLINE;
  for (const [y, x, w] of ROWS) {
    ctx.fillRect(ox + x - 1, oy + y, w + 2, 1);
    ctx.fillRect(ox + x, oy + y - 1, w, 1);
    ctx.fillRect(ox + x, oy + y + 1, w, 1);
  }
  ctx.fillStyle = FILL;
  for (const [y, x, w] of ROWS) {
    ctx.fillRect(ox + x, oy + y, w, 1);
  }
}

/**
 * The stairs-down marker: a door whose `doorStyle` is `"stairs"` (a shop
 * reached by going down rather than walking straight in at street level —
 * `BuildingPlacement.doorStyle`, DESIGN.md §2) draws this instead of
 * `paintDoorArrow`, never both, since stairs already say "go in" on their
 * own — and unlike the arrow, the wall behind it stays plain: there is no
 * door-shaped opening for this one to point into (`engine/art.ts`'s
 * placeholder facade skips its door cutout for this `doorStyle`, and so does
 * the Studio's reference preview). Same box (`DOOR_ARROW_W x
 * DOOR_ARROW_H`) as the arrow it replaces.
 *
 * Drawn as a dark opening cut into the doorstep tile itself — not a shape
 * standing on top of the ground the way the arrow is — with treads inside
 * it going from the doorstep (nearest the player, at the bottom of the box,
 * still in daylight, so the lightest) down to under the building (nearest
 * the wall, at the top of the box, the deepest and so the darkest), and a
 * thin light handrail down one side. Reads as a stairwell going down and
 * away, never as a door to walk up to.
 */

/** The dark cut edge all the way round the opening. */
const PIT_EDGE = '#2b2018';
/** The treads, nearest-and-lightest to farthest-and-darkest. */
const TREADS = ['#caa06a', '#a9855a', '#8a6a45', '#6b4a35'] as const;
/** The thin light rail down the opening's left side. */
const RAIL = '#e8ddc6';

/** Each tread's row span inside the opening (`y`, `h`), nearest the doorstep
 *  (lightest, paired with `TREADS[0]`) to nearest the wall the door used to
 *  open in (darkest, `TREADS[3]`). */
const TREAD_ROWS: ReadonlyArray<readonly [number, number]> = [
  [6, 2], // nearest the doorstep — lightest
  [4, 2],
  [2, 2],
  [1, 1] // nearest the wall — darkest
];

/**
 * Paints the stairwell at `ox, oy` in `ctx`. Fits a `DOOR_ARROW_W x
 * DOOR_ARROW_H` box exactly, same as the arrow.
 */
export function paintStairsDown(ctx: Paint, ox = 0, oy = 0): void {
  // The cut edge, filled first so a 1px border of it survives all the way
  // round once the treads and rail are painted inside it.
  ctx.fillStyle = PIT_EDGE;
  ctx.fillRect(ox, oy, DOOR_ARROW_W, DOOR_ARROW_H);

  TREAD_ROWS.forEach(([y, h], i) => {
    ctx.fillStyle = TREADS[i];
    ctx.fillRect(ox + 1, oy + y, DOOR_ARROW_W - 2, h);
  });

  ctx.fillStyle = RAIL;
  ctx.fillRect(ox + 1, oy + 1, 1, DOOR_ARROW_H - 2);
}
