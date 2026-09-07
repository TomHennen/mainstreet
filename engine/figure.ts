import type { Facing, HairStyle, Look } from './schema';

/**
 * The placeholder townsperson, drawn from a `look` (DESIGN.md §2/§4).
 *
 * Kept out of engine/art.ts so it can be drawn — and tested — without a
 * browser: all it asks of a canvas is `fillStyle` and `fillRect`. Nothing here
 * knows about any world; the look is data a world pack hands in, and a painted
 * `assets/chars/<id>.png` replaces the whole of this for that character
 * (CLAUDE.md hard rule 3).
 *
 * The figure is 16x32 with its feet on the bottom edge, lit from the top left
 * like the rest of town. The head is a fixed 8x8 block at x4..11, y7..14, so
 * every hair style is cut to the same skull and faces stay readable at 1x;
 * `build` moves the shoulders, legs and shadow in and out around it, which is
 * the whole of the silhouette difference.
 */

/** Everything the recipe asks of a canvas. A real 2D context satisfies it. */
export interface Paint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** The look every field of `Look` falls back to — today's townsperson. */
export const DEFAULT_LOOK = {
  hair: 'flat' as HairStyle,
  hairColor: '#3a2c1e',
  skin: '#e8c39a',
  shirt: '#7a7a6a'
};

const LEGS = '#33404f';
const EYE = '#2a231a';

/** Half the shoulder width, in pixels: the one knob `build` turns. */
function halfWidth(build: Look['build']): number {
  return build === 'slim' ? 3 : build === 'broad' ? 5 : 4;
}

/**
 * A cache key for one look — two characters with the same look share a
 * texture, and any difference makes a new one.
 */
export function figureKey(look: Look): string {
  return [
    look.hair ?? DEFAULT_LOOK.hair,
    look.hairColor ?? DEFAULT_LOOK.hairColor,
    look.skin ?? DEFAULT_LOOK.skin,
    look.shirt ?? DEFAULT_LOOK.shirt,
    look.build ?? 'regular'
  ].join('|');
}

/**
 * One frame: the person at `ox, oy` facing `dir` on walk frame `step` (0, 1,
 * 2). Frame 0 stands still; 1 and 2 swing the legs — and anything long enough
 * to swing with them — one pixel each way.
 */
export function drawFigure(
  ctx: Paint,
  ox: number,
  oy: number,
  dir: Facing,
  step: number,
  look: Look = {}
): void {
  const skin = look.skin ?? DEFAULT_LOOK.skin;
  const hairColor = look.hairColor ?? DEFAULT_LOOK.hairColor;
  const shirt = look.shirt ?? DEFAULT_LOOK.shirt;
  const half = halfWidth(look.build);
  const legW = half - 1;
  const swing = step === 1 ? 1 : step === 2 ? -1 : 0;

  const fill = (color: string) => {
    ctx.fillStyle = color;
  };
  const rect = (x: number, y: number, w: number, h: number) => ctx.fillRect(ox + x, oy + y, w, h);

  fill('rgba(0,0,0,.28)');
  rect(7 - half, 29, half * 2 + 2, 3);

  fill(LEGS);
  rect(8 - half, 24, legW, 7 + swing);
  rect(9, 24, legW, 7 - swing);

  fill(shirt);
  rect(8 - half, 15, half * 2, 10);
  fill('rgba(0,0,0,.18)');
  rect(7 - half, 16, 1, 7);
  rect(8 + half, 16, 1, 7);

  fill(skin);
  rect(4, 7, 8, 8);

  drawHair(fill, rect, dir, look.hair ?? DEFAULT_LOOK.hair, hairColor, swing);

  // Last, so no fringe ever hides a face.
  if (dir !== 'up') {
    const eye = dir === 'left' ? 4 : dir === 'right' ? 8 : 6;
    fill(EYE);
    rect(eye, 11, 1, 1);
    rect(eye + 3, 11, 1, 1);
  }
}

/**
 * Hair, cut to the same skull for every style and every facing.
 *
 * Two conventions hold the four rows together: the *back* of the head is the
 * side away from the face — right of centre when facing left, left of centre
 * when facing right, the whole head when facing up — and anything that hangs
 * (a fall of long hair, a ponytail) has its last two rows shifted by the walk
 * frame's `swing`, so it moves with the step instead of hanging stiff.
 */
function drawHair(
  fill: (color: string) => void,
  rect: (x: number, y: number, w: number, h: number) => void,
  dir: Facing,
  style: HairStyle,
  color: string,
  swing: number
): void {
  fill(color);

  /** A hanging length: everything but the last two rows, then those, swung. */
  const fall = (x: number, y: number, w: number, h: number) => {
    rect(x, y, w, h - 2);
    rect(x + swing, y + h - 2, w, 2);
  };
  /** The cap of hair over the top of the head, shared by most styles. */
  const crown = () => rect(4, 5, 8, 4);
  /** The back of the head, for the two side facings. */
  const back = (y: number, h: number) => rect(dir === 'left' ? 9 : 4, y, 3, h);

  switch (style) {
    // Today's townsperson, and the default: a square cap of hair.
    case 'flat':
      if (dir === 'up') rect(4, 5, 8, 8);
      else {
        crown();
        if (dir !== 'down') back(5, 6);
      }
      break;

    // A neat crop: rounded at the top, a row shallower over the forehead, and
    // carried down past the ear on each side.
    case 'short':
      rect(5, 5, 6, 1);
      if (dir === 'up') rect(4, 6, 8, 7);
      else {
        rect(4, 6, 8, 2);
        if (dir === 'down') {
          rect(4, 8, 1, 2);
          rect(11, 8, 1, 2);
        } else rect(dir === 'left' ? 9 : 4, 6, 3, 4);
      }
      break;

    // Nothing on top; a little left at the temples and round the nape, so it
    // reads as a choice rather than as a missing sprite.
    case 'bald':
      if (dir === 'up') {
        rect(4, 7, 1, 5);
        rect(11, 7, 1, 5);
        rect(4, 12, 8, 2);
      } else if (dir === 'down') {
        rect(4, 7, 1, 3);
        rect(11, 7, 1, 3);
      } else {
        rect(dir === 'left' ? 9 : 4, 8, 3, 2);
      }
      break;

    // A soft cap with a brim that points where its wearer is looking. The
    // look's `hairColor` paints the cap; what shows below it is the same
    // colour, which is why a grey cap reads as a grey-haired person in one.
    case 'cap':
      if (dir === 'up') {
        rect(4, 4, 8, 5);
        rect(4, 9, 8, 4);
      } else {
        rect(4, 4, 8, 4);
        if (dir === 'down') rect(3, 8, 10, 1);
        else {
          rect(dir === 'left' ? 2 : 9, 8, 5, 1);
          back(8, 2);
        }
      }
      fill('rgba(255,255,255,.18)');
      rect(4, 4, 8, 1);
      break;

    // Long enough to read as long from every side: down the shoulders in
    // front, a full sheet down the back.
    case 'long':
      if (dir === 'up') {
        crown();
        fall(3, 7, 10, 12);
      } else if (dir === 'down') {
        crown();
        fall(3, 7, 2, 11);
        fall(12, 7, 2, 11);
      } else {
        crown();
        back(5, 4);
        fall(dir === 'left' ? 10 : 3, 7, 3, 11);
      }
      break;

    // Gathered at the back and swinging with the step.
    case 'ponytail':
      if (dir === 'up') {
        rect(4, 5, 8, 6);
        fall(6, 10, 4, 9);
      } else if (dir === 'down') {
        crown();
        fall(12, 6, 2, 8);
      } else {
        crown();
        back(5, 4);
        fall(dir === 'left' ? 11 : 2, 7, 3, 9);
      }
      break;

    // Pinned up in a knot that shows from every side.
    case 'bun':
      if (dir === 'up') rect(4, 5, 8, 7);
      else {
        crown();
        if (dir !== 'down') back(5, 5);
      }
      rect(dir === 'left' ? 10 : dir === 'right' ? 2 : 6, 2, 4, 3);
      break;

    // Wider than the head, with a notched top: the one style whose outline
    // isn't a rectangle.
    case 'curly':
      rect(5, 3, 2, 1);
      rect(9, 3, 2, 1);
      rect(4, 4, 8, 1);
      rect(3, 5, 10, 3);
      if (dir === 'up') rect(3, 5, 10, 8);
      else if (dir === 'down') {
        rect(3, 8, 1, 2);
        rect(12, 8, 1, 2);
      } else rect(dir === 'left' ? 9 : 3, 8, 4, 4);
      break;
  }
}
