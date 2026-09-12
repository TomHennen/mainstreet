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
