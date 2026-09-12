import { describe, expect, it } from 'vitest';
import { DOOR_ARROW_H, DOOR_ARROW_W, paintDoorArrow } from './glyphs';

/**
 * A canvas stand-in that just records every rectangle it is asked to fill and
 * rasterises them into a flat set of pixels — enough to ask "how many, and
 * where" without a browser (the same trick engine/figure.test.ts and
 * engine/motor.test.ts use for `drawFigure`/`drawVehicle`).
 */
function render(): { rects: [number, number, number, number][]; pixels: Set<string> } {
  const rects: [number, number, number, number][] = [];
  const pixels = new Set<string>();
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h]);
      for (let iy = y; iy < y + h; iy++) {
        for (let ix = x; ix < x + w; ix++) pixels.add(`${ix},${iy}`);
      }
    }
  };
  paintDoorArrow(ctx);
  return { rects, pixels };
}

describe('paintDoorArrow', () => {
  it('paints something, entirely inside a 16x16 cell', () => {
    const { rects, pixels } = render();
    expect(rects.length).toBeGreaterThan(0);
    expect(pixels.size).toBeGreaterThan(0);
    for (const [x, y, w, h] of rects) {
      expect(x, `rect ${x},${y} ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(y, `rect ${x},${y} ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(x + w, `rect ${x},${y} ${w}x${h}`).toBeLessThanOrEqual(16);
      expect(y + h, `rect ${x},${y} ${w}x${h}`).toBeLessThanOrEqual(16);
    }
  });

  it('fits exactly inside its own declared DOOR_ARROW_W x DOOR_ARROW_H box', () => {
    const { rects } = render();
    for (const [x, y, w, h] of rects) {
      expect(x + w).toBeLessThanOrEqual(DOOR_ARROW_W);
      expect(y + h).toBeLessThanOrEqual(DOOR_ARROW_H);
    }
  });

  it('offsets by ox, oy without changing the shape', () => {
    const base = render();
    const rects: [number, number, number, number][] = [];
    paintDoorArrow(
      {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          rects.push([x, y, w, h]);
        }
      },
      3,
      5
    );
    expect(rects).toEqual(base.rects.map(([x, y, w, h]) => [x + 3, y + 5, w, h]));
  });
});
