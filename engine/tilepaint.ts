import type { Paint } from './figure';
import { TILE } from './tiled';
import type { TileDef } from './tiled';

/**
 * Fallback tileset painting (DESIGN.md §2/§4), pulled out of engine/art.ts —
 * the same reason engine/figure.ts, engine/motor.ts and engine/glyphs.ts are
 * kept apart from it — so this can be exercised under plain Node in
 * engine/art.test.ts without pulling Phaser into the test run (vitest.config.ts).
 */

/**
 * How far down a cell the styles that stand on a raised surface — `disc`,
 * `rim`, `umbrella` — draw, shadows included. Below it is where a tile's
 * `edge` paints the front face of whatever they are standing on, so a table
 * on the near row of a deck keeps the deck's lip in front of it.
 */
const PROP_FLOOR = 12;

/**
 * One tile of the fallback tileset, drawn from the recipe its Tiled entry
 * carries. `style` is a shape, not a meaning: the meaning is the tile's class.
 * Every shape stays inside its own 16x16 cell so a tile looks the same whether
 * it is drawn here or blitted out of the tileset image.
 *
 * The town is lit from the top left, which is why anything meant to stand
 * above the ground plane gets the same three cues: a lighter top face, a
 * darker face towards the viewer, and a short cast shadow down and to the
 * right. Shading is painted as translucent black or white over the tile's own
 * colours, so one recipe works for every palette a world hands it.
 */
export function drawTile(ctx: Paint, def: TileDef, px: number, py: number): void {
  const c = def.colors;

  if (def.base) {
    ctx.fillStyle = def.base;
    ctx.fillRect(px, py, TILE, TILE);
  }

  switch (def.style) {
    case 'flat':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      break;

    case 'speck':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 4, py + 6, 3, 2);
      break;

    case 'ripple':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 5, 6, 1);
      break;

    case 'tree':
      ctx.fillStyle = c[2] ?? c[0];
      ctx.fillRect(px + 6, py + 9, 4, 6);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 2, py, 12, 10);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 4, py + 2, 8, 5);
      break;

    // Two blooms on short stems. Sparse on purpose: a patch is a run of these.
    case 'flower':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 6, py + 8, 1, 3);
      ctx.fillRect(px + 10, py + 11, 1, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 9, 2, 2);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(px + 5, py + 5, 2, 1);
      ctx.fillRect(px + 10, py + 9, 1, 1);
      break;

    // A low box on legs: a bench, a chest cooler, a crate.
    case 'prop':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 14, 13, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 1, py + 6, 14, 5);
      ctx.fillRect(px + 2, py + 11, 2, 4);
      ctx.fillRect(px + 12, py + 11, 2, 4);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 1, py + 9, 14, 2);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 1, py + 6, 14, 2);
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(px + 1, py + 6, 14, 1);
      break;

    // A round top on a pedestal with something small set on it: a cafe table,
    // a stool, a barrel.
    case 'disc':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 4, py + 9, 10, 3);
      ctx.fillRect(px + 3, py + 10, 12, 1);
      // pedestal and foot, a darkened cut of the top's own colour
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 5, py + 10, 6, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 5, py + 10, 6, 1);
      // the top, foreshortened: wider than it is deep
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 1, 10, 7);
      ctx.fillRect(px + 2, py + 2, 12, 5);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(px + 4, py + 2, 8, 2);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(px + 2, py + 6, 12, 1);
      ctx.fillRect(px + 3, py + 7, 10, 1);
      // whatever is set on it, with a saucer's worth of contact shadow
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(px + 5, py + 5, 6, 1);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 6, py + 2, 3, 3);
      ctx.fillRect(px + 9, py + 3, 1, 1);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(px + 6, py + 2, 3, 1);
      break;

    // A container of soil with something growing out of it: a planter, a tub,
    // a window box. The planting breaks the rim, which is what makes it read
    // as a box rather than a bench.
    case 'rim': {
      const leaf = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 10, 12, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 2, py + 3, 12, 7);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 2, py + 8, 12, 2);
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.fillRect(px + 2, py + 3, 12, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(px + 3, py + 4, 10, 2);
      // Sprigs, not a cushion: a ragged top edge is what says "growing".
      ctx.fillStyle = leaf;
      ctx.fillRect(px + 4, py, 2, 3);
      ctx.fillRect(px + 9, py, 2, 4);
      ctx.fillRect(px + 6, py + 1, 2, 2);
      ctx.fillRect(px + 3, py + 2, 10, 4);
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.fillRect(px + 4, py, 2, 2);
      ctx.fillRect(px + 4, py + 3, 3, 1);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 9, py + 2, 1, 4);
      ctx.fillRect(px + 4, py + 5, 8, 1);
      break;
    }

    // A canopy on a pole: a sun umbrella, a parasol, a market awning. A round
    // canopy in four panels that alternate the two colours, lit from the top
    // left, with the pole and its shadow showing below.
    case 'umbrella': {
      const alt = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 5, py + 9, 9, 3);
      ctx.fillRect(px + 4, py + 10, 11, 1);
      // Row spans make the canopy round without an arc call.
      const span = [
        [5, 6],
        [3, 10],
        [2, 12],
        [1, 14],
        [1, 14],
        [1, 14],
        [2, 12],
        [3, 10],
        [5, 6]
      ];
      span.forEach(([x, w], y) => {
        ctx.fillStyle = c[0];
        ctx.fillRect(px + x, py + y, w, 1);
        // opposite quadrants in the second colour: far-left and near-right
        ctx.fillStyle = alt;
        if (y < 4) ctx.fillRect(px + x, py + y, Math.min(w, 8 - x), 1);
        if (y > 4) ctx.fillRect(px + Math.max(x, 8), py + y, x + w - Math.max(x, 8), 1);
      });
      // the rib across the canopy, the lit crown, and the shaded near rim
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(px + 1, py + 4, 14, 1);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(px + 4, py + 1, 3, 1);
      ctx.fillRect(px + 3, py + 2, 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 3, py + 7, 10, 1);
      ctx.fillRect(px + 5, py + 8, 6, 1);
      // the pole, below the canopy's near edge
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(px + 7, py + 9, 2, 3);
      break;
    }

    // An upright slab on a plinth, with a lighter face set into it: a memorial
    // stone, a boundary marker, a village monument. Tall and narrow, so it
    // reads as standing up out of the ground rather than lying on it.
    case 'stele': {
      const face = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 13, 11, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 11, 10, 3);
      ctx.fillRect(px + 5, py + 2, 6, 10);
      ctx.fillRect(px + 6, py + 1, 4, 1);
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(px + 5, py + 2, 1, 10);
      ctx.fillRect(px + 6, py + 1, 3, 1);
      ctx.fillRect(px + 3, py + 11, 10, 1);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 10, py + 2, 1, 10);
      ctx.fillRect(px + 3, py + 13, 10, 1);
      ctx.fillStyle = face;
      ctx.fillRect(px + 6, py + 4, 4, 5);
      ctx.fillStyle = 'rgba(0,0,0,.20)';
      ctx.fillRect(px + 6, py + 8, 4, 1);
      break;
    }

    case 'block':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px, py, TILE, 5);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(px, py + TILE - 3, TILE, 3);
      break;

    case 'shelf':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 3, py + 4, 10, 6);
      break;

    case 'mat':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      break;

    // Four boards across the cell, alternating two values and closed with a
    // seam, so a run of them reads as decking rather than as one flat fill.
    // The pattern repeats every cell, which keeps the boards continuous.
    case 'planks': {
      const alt = c[1] ?? c[0];
      const seam = c[2] ?? c[0];
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = alt;
      ctx.fillRect(px, py + 4, TILE, 3);
      ctx.fillRect(px, py + 12, TILE, 3);
      ctx.fillStyle = seam;
      for (let y = 3; y < TILE; y += 4) ctx.fillRect(px, py + y, TILE, 1);
      break;
    }

    // Flagstones on a grout bed: a paved patio, a stone path, a terrace. Four
    // slabs of four different sizes in two courses, with the joints of one
    // course offset from the other's and the course line stepping a pixel where
    // it crosses a slab. Each course has a slab that runs off the cell and
    // wraps round to the far side, so the same slab carries on into the next
    // tile and no grout line ever lands on a cell boundary — a run of these
    // reads as one paved surface rather than as a grid of tiles.
    case 'pavers': {
      const grout = def.base ?? c[0];
      const tone = [c[0], c[1] ?? c[0], c[2] ?? c[1] ?? c[0]];
      ctx.fillStyle = grout;
      ctx.fillRect(px, py, TILE, TILE);

      // A rectangle in cell coordinates, clipped to the cell so a slab that
      // overhangs never paints into the tile beside it on the sheet.
      const rect = (x: number, y: number, w: number, h: number, fill: string) => {
        const x0 = Math.max(0, x);
        const y0 = Math.max(0, y);
        const x1 = Math.min(TILE, x + w);
        const y1 = Math.min(TILE, y + h);
        if (x1 <= x0 || y1 <= y0) return;
        ctx.fillStyle = fill;
        ctx.fillRect(px + x0, py + y0, x1 - x0, y1 - y0);
      };

      // x, y, width, height, which stone value. Anything past the right or
      // bottom edge is drawn again a cell earlier, which is the wrap.
      const slabs = [
        [3, 6, 6, 6, 0],
        [10, 7, 8, 5, 2],
        [5, 13, 9, 8, 1],
        [15, 14, 5, 7, 0]
      ];
      for (const [x, y, w, h, value] of slabs) {
        for (const ox of [0, -TILE]) {
          for (const oy of [0, -TILE]) {
            rect(x + ox, y + oy, w, h, tone[value]);
            // Each slab sits a hair proud of the bed: lit along its top, in
            // its own shadow along the bottom.
            rect(x + ox, y + oy, w, 1, 'rgba(255,255,255,.10)');
            rect(x + ox, y + oy + h - 1, w, 1, 'rgba(0,0,0,.18)');
          }
        }
      }
      break;
    }

    // A small round seat on a single leg: a bar stool, a step stool, a
    // milking stool. The disc's little sibling — same pedestal, same
    // foreshortened top, nothing set on it, and drawn small enough that a
    // ring of them round a counter still reads as a ring of stools.
    case 'stool':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 5, py + 9, 7, 2);
      ctx.fillRect(px + 4, py + 10, 9, 1);
      // the leg and its foot, a darkened cut of the seat's own colour
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 6, py + 10, 4, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 6, py + 10, 4, 1);
      // the seat, foreshortened the way the tables are
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 5, py + 3, 6, 5);
      ctx.fillRect(px + 4, py + 4, 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(px + 5, py + 4, 5, 1);
      ctx.fillStyle = 'rgba(0,0,0,.20)';
      ctx.fillRect(px + 4, py + 6, 8, 1);
      ctx.fillRect(px + 5, py + 7, 6, 1);
      break;

    // A games table: a sunk playfield in a heavy frame with rods across it —
    // foosball, air hockey, shuffleboard. The frame runs the full width of the
    // cell and the rods repeat inside it, so a table two or three cells long
    // reads as one table rather than as a row of them.
    case 'foosball': {
      const field = c[1] ?? c[0];
      const rod = c[2] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px, py + 11, TILE, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py + 1, TILE, 11);
      ctx.fillStyle = field;
      ctx.fillRect(px, py + 4, TILE, 6);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(px, py + 1, TILE, 1);
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.fillRect(px, py + 10, TILE, 2);
      ctx.fillStyle = rod;
      for (const x of [3, 8, 13]) {
        ctx.fillRect(px + x, py + 2, 1, 9);
        ctx.fillRect(px + x - 1, py + 6, 3, 2);
      }
      break;
    }

    // A closed door in a wall: jamb, leaf, two panels and a handle. Fills its
    // cell, because it stands in for a wall tile rather than on the floor —
    // a bathroom door, a cellar door, a door somebody has hung a sign on.
    case 'door':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 3, py + 2, 10, 14);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(px + 3, py + 2, 10, 1);
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.fillRect(px + 3, py + 2, 1, 14);
      ctx.fillRect(px + 4, py + 5, 8, 1);
      ctx.fillRect(px + 4, py + 11, 8, 1);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(px + 5, py + 6, 6, 4);
      ctx.fillRect(px + 5, py + 12, 6, 3);
      ctx.fillStyle = c[2] ?? c[1] ?? c[0];
      ctx.fillRect(px + 10, py + 8, 2, 2);
      break;

    // A ring of stones round a warm middle: a firepit, a campfire, a brazier.
    // Nothing animates — the glow is painted, so it costs a tile and not a
    // timer.
    case 'firepit': {
      const stone = c[0];
      const litStone = c[1] ?? c[0];
      const flame = c[2] ?? c[0];
      const ember = c[3] ?? flame;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(px + 2, py + 12, 12, 2);
      // the ash bed, then the embers and the flame standing out of it
      ctx.fillStyle = '#241d16';
      ctx.fillRect(px + 3, py + 4, 10, 8);
      ctx.fillStyle = ember;
      ctx.fillRect(px + 5, py + 8, 6, 3);
      ctx.fillStyle = flame;
      ctx.fillRect(px + 6, py + 4, 4, 5);
      ctx.fillRect(px + 7, py + 2, 2, 3);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(px + 7, py + 4, 2, 2);
      // the stones round it, lit along the top like everything else in town
      for (const [x, y] of [[1, 3], [1, 8], [4, 11], [9, 11], [12, 8], [12, 3], [9, 0], [4, 0]]) {
        ctx.fillStyle = stone;
        ctx.fillRect(px + x, py + y, 4, 4);
        ctx.fillStyle = litStone;
        ctx.fillRect(px + x, py + y, 4, 1);
      }
      break;
    }

    // A wall that has been papered over: a flat hanging with its seams
    // showing, lit at the top and in its own shadow at the foot, so a run of
    // it reads as a surface somebody covered rather than as a painted wall.
    case 'paper': {
      const seam = c[1] ?? c[0];
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = seam;
      ctx.fillRect(px, py, 1, TILE);
      ctx.fillRect(px + 8, py, 1, TILE);
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(px + 1, py, 7, 2);
      ctx.fillRect(px + 9, py, 7, 2);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(px, py + TILE - 3, TILE, 3);
      break;
    }

    // A wall covered in marks: names, drawings, whatever people put there.
    // The marks are small and go in three colours, so a run of the tile reads
    // as a covered wall and never as a pattern with a shape of its own.
    case 'scrawl': {
      const ink = [c[1] ?? c[0], c[2] ?? c[1] ?? c[0], c[3] ?? c[1] ?? c[0]];
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      const marks = [
        [2, 2, 3, 1],
        [6, 1, 1, 4],
        [9, 3, 4, 1],
        [12, 5, 1, 3],
        [3, 6, 2, 2],
        [7, 7, 4, 1],
        [1, 10, 4, 1],
        [6, 10, 2, 3],
        [10, 11, 3, 1],
        [13, 1, 1, 2],
        [4, 12, 1, 2]
      ];
      marks.forEach(([x, y, w, h], i) => {
        ctx.fillStyle = ink[i % ink.length];
        ctx.fillRect(px + x, py + y, w, h);
      });
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(px, py + TILE - 3, TILE, 3);
      break;
    }

    // A wall somebody keeps a big chalk drawing on: a dark board edge to edge,
    // the ghosts of what was wiped off it still showing, and chalk marks in a
    // few colours over the top. The marks are drawn long and loose rather than
    // arranged, so a run of the tile — up a wall or along one — reads as a
    // picture somebody is partway through and never as a pattern.
    case 'chalkwall': {
      const board = c[0];
      const chalk = [c[1] ?? c[0], c[2] ?? c[1] ?? c[0], c[3] ?? c[1] ?? c[0]];
      ctx.fillStyle = board;
      ctx.fillRect(px, py, TILE, TILE);
      // wiped over and drawn on again, which is most of what a board like this is
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(px + 1, py + 2, 14, 5);
      ctx.fillRect(px + 2, py + 10, 12, 4);
      const marks = [
        [1, 2, 6, 1],
        [7, 1, 1, 5],
        [10, 3, 5, 1],
        [3, 5, 3, 1],
        [12, 6, 1, 5],
        [2, 8, 4, 1],
        [6, 7, 1, 4],
        [9, 9, 5, 1],
        [1, 12, 5, 1],
        [7, 12, 2, 3],
        [11, 13, 4, 1],
        [4, 13, 1, 2]
      ];
      marks.forEach(([x, y, w, h], i) => {
        ctx.fillStyle = chalk[i % chalk.length];
        ctx.fillRect(px + x, py + y, w, h);
      });
      // chalk dust along the foot of it, the way it collects on a real one
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(px, py + TILE - 2, TILE, 2);
      break;
    }

    // A short bar along one axis, drawn over `base`. Tiling it leaves a gap
    // between bars, so a run of them reads as a dashed line.
    case 'stripe-h':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 7, 10, 2);
      break;

    case 'stripe-v':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 7, py + 3, 2, 10);
      break;

    // A stairwell cut into the ground, going down and away from the viewer:
    // a mystery-space entrance reached by going down rather than walking
    // straight in at street level. Four tread bands, nearest the viewer (the
    // top of the cell, where a player steps on) to farthest (the bottom, under
    // whatever the stairs run beneath), each a shade darker than the last —
    // the same translucent-black-over-colour shading every other style here
    // uses, so one recipe still works for any world's palette — with a thin
    // light handrail down one side. `colors[1]` is the dark opening the
    // treads are cut into; a tile with only one colour falls back to it.
    case 'stairs': {
      const tread = c[0];
      const opening = c[1] ?? '#000000';
      const rail = c[2] ?? tread;
      ctx.fillStyle = opening;
      ctx.fillRect(px, py, TILE, TILE);
      const shade = [0, 0.22, 0.44, 0.66];
      shade.forEach((alpha, i) => {
        const y = py + 1 + i * 3;
        ctx.fillStyle = tread;
        ctx.fillRect(px + 1, y, TILE - 2, 2);
        if (alpha > 0) {
          ctx.fillStyle = `rgba(0,0,0,${alpha})`;
          ctx.fillRect(px + 1, y, TILE - 2, 2);
        }
      });
      ctx.fillStyle = rail;
      ctx.fillRect(px + 1, py + 1, 1, 11);
      break;
    }
  }

  // The front face of a raised surface, last so it stays in front of anything
  // standing on the tile — including a prop the map put on a layer above this
  // one, which is why those styles keep clear of it (see PROP_FLOOR).
  if (def.edge) {
    ctx.fillStyle = def.edge;
    ctx.fillRect(px, py + PROP_FLOOR, TILE, TILE - PROP_FLOOR);
    // the lit nose of the surface, then the shadow it drops on the ground
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillRect(px, py + PROP_FLOOR, TILE, 1);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(px, py + TILE - 1, TILE, 1);
  }
}
