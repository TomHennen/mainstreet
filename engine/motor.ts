import type { Facing, VehicleKind } from './schema';
import type { Paint } from './figure';

/**
 * The placeholder vehicle, drawn from a kind and a colour (DESIGN.md §2/§4,
 * issue #72).
 *
 * The sibling of engine/figure.ts, and kept out of engine/art.ts for the same
 * reason: all it asks of a canvas is `fillStyle` and `fillRect`, so a car can
 * be drawn — and tested — without a browser. Nothing here knows about any
 * world. A painted `assets/vehicles/<id>.png` replaces the whole of it for
 * that vehicle (CLAUDE.md hard rule 3).
 *
 * A car is drawn 16 across and 32 along, in a 32x32 cell so the same cell
 * holds it lengthways or across. There are four of them, one per facing, in
 * the same order as a character sheet — a painted sheet is therefore 32x128.
 *
 * Every recipe is written once, in **car space**: 16 wide by 32 long with the
 * front at the top, x to the driver's right and y running back from the nose.
 * `put` turns that into the cell for whichever way the car is pointing, so
 * there is one car to get right rather than four.
 */

/** One frame of a vehicle sheet, square so it holds the car either way round. */
export const VEHICLE_CELL = 32;
/** The car itself inside that cell. */
export const VEHICLE_W = 16;
export const VEHICLE_L = 32;

const GLASS = '#3e3546';
const TYRE = '#2e222f';
const LAMP = '#c7dcd0';
const TAIL = '#6e2727';

/**
 * One frame: a `kind` in `colour` at `ox, oy` in the cell, pointing `dir`.
 * Shading is translucent white and black over the body colour, the same way
 * the tile recipes shade themselves, so one recipe works for any colour a
 * world hands it.
 */
export function drawVehicle(ctx: Paint, ox: number, oy: number, dir: Facing, kind: VehicleKind, colour: string): void {
  const fill = (color: string) => {
    ctx.fillStyle = color;
  };

  /** A rectangle in car space, painted wherever the car is pointing. */
  const put = (x: number, y: number, w: number, h: number) => {
    switch (dir) {
      case 'up':
        ctx.fillRect(ox + 8 + x, oy + y, w, h);
        break;
      case 'down':
        ctx.fillRect(ox + 8 + (VEHICLE_W - x - w), oy + (VEHICLE_L - y - h), w, h);
        break;
      case 'left':
        ctx.fillRect(ox + y, oy + 8 + (VEHICLE_W - x - w), h, w);
        break;
      case 'right':
        ctx.fillRect(ox + (VEHICLE_L - y - h), oy + 8 + x, h, w);
        break;
    }
  };

  // The cast shadow is the one thing that does not turn with the car: the town
  // is lit from the top left, so it always falls down and to the right.
  const along = dir === 'left' || dir === 'right';
  fill('rgba(0,0,0,.22)');
  if (along) ctx.fillRect(ox + 2, oy + 10, 30, 15);
  else ctx.fillRect(ox + 9, oy + 3, 15, 29);

  // Wheels first, so the body sits over them.
  fill(TYRE);
  put(-1, 5, 1, 6);
  put(VEHICLE_W, 5, 1, 6);
  put(-1, 21, 1, 6);
  put(VEHICLE_W, 21, 1, 6);

  // The body, with the nose and tail a pixel narrower so it reads as a car
  // rather than a brick.
  fill(colour);
  put(0, 2, VEHICLE_W, 28);
  put(1, 0, VEHICLE_W - 2, 2);
  put(1, 30, VEHICLE_W - 2, 2);

  switch (kind) {
    case 'pickup':
      // A cab up front and an open bed behind it.
      fill('rgba(255,255,255,.20)');
      put(2, 8, 12, 7);
      fill(GLASS);
      put(2, 5, 12, 3);
      put(3, 15, 10, 2);
      fill('rgba(0,0,0,.30)');
      put(2, 18, 12, 11);
      fill('rgba(0,0,0,.16)');
      put(3, 19, 10, 9);
      break;

    case 'van':
      // Roof nearly the whole length, windows only at the front.
      fill('rgba(255,255,255,.20)');
      put(2, 7, 12, 22);
      fill(GLASS);
      put(2, 4, 12, 3);
      put(2, 8, 1, 5);
      put(13, 8, 1, 5);
      break;

    case 'car':
    default:
      // A lit roof panel between a windscreen and a rear window.
      fill('rgba(255,255,255,.20)');
      put(2, 11, 12, 10);
      fill(GLASS);
      put(2, 8, 12, 3);
      put(2, 21, 12, 3);
      break;
  }

  // Sills: lit down the driver's left, shaded down the right.
  fill('rgba(255,255,255,.14)');
  put(0, 2, 1, 28);
  fill('rgba(0,0,0,.22)');
  put(VEHICLE_W - 1, 2, 1, 28);

  fill(LAMP);
  put(1, 0, 3, 1);
  put(VEHICLE_W - 4, 0, 3, 1);
  fill(TAIL);
  put(1, 31, 3, 1);
  put(VEHICLE_W - 4, 31, 3, 1);
}
