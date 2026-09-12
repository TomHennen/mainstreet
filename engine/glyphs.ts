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
 * own. Same box (`DOOR_ARROW_W x DOOR_ARROW_H`) and the same two-tone ink as
 * the arrow it replaces, so the two read as the same family of doorstep
 * marking.
 */

/** Four treads, one row each (y, x, w), each one row apart and each wider
 *  than the one above it — the nearest and widest at the doorstep, the
 *  farthest and narrowest up at the door — reading as steps going down away
 *  from the door and toward the player. The blank row left between each
 *  keeps the outline pass below from fusing them into a ramp: every tread
 *  comes out bordered on all four sides, the way a real step's edge catches
 *  a shadow. */
const STAIR_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 4, 2], // farthest tread, at the door
  [3, 3, 4],
  [5, 2, 6],
  [7, 1, 8] // nearest tread, at the doorstep
];

/**
 * Paints the stairs at `ox, oy` in `ctx`, by the same outline-then-fill
 * recipe as `paintDoorArrow` (see there for why the two passes work). Fits a
 * `DOOR_ARROW_W x DOOR_ARROW_H` box exactly, same as the arrow.
 */
export function paintStairsDown(ctx: Paint, ox = 0, oy = 0): void {
  ctx.fillStyle = OUTLINE;
  for (const [y, x, w] of STAIR_ROWS) {
    ctx.fillRect(ox + x - 1, oy + y, w + 2, 1);
    ctx.fillRect(ox + x, oy + y - 1, w, 1);
    ctx.fillRect(ox + x, oy + y + 1, w, 1);
  }
  ctx.fillStyle = FILL;
  for (const [y, x, w] of STAIR_ROWS) {
    ctx.fillRect(ox + x, oy + y, w, 1);
  }
}
