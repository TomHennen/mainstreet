import { describe, expect, it } from 'vitest';
import { BAR_BLUE, BAR_OUTLINE, BAR_RED, drawVehicle, VEHICLE_CELL } from './motor';
import { FACINGS } from './schema';
import type { Facing } from './schema';

/**
 * `drawVehicle` is drawn with nothing but `fillStyle` and `fillRect`
 * (engine/motor.ts), so — same trick as engine/figure.test.ts and
 * engine/glyphs.test.ts — a plain-object canvas stand-in is enough to
 * rasterise one frame and ask questions of the pixels: does an `accent`
 * stripe show up on every facing, does a `lights` bar paint both colours in
 * an outline, and does swapping `'a'` for `'b'` actually swap which side is
 * which. What it does not chase is the exact shape of the stripe or the bar —
 * DESIGN.md §2's business, not this one's.
 */

const W = VEHICLE_CELL;
const H = VEHICLE_CELL;
const BODY = '#9babb2';

interface Frame {
  where(color: string): Set<string>;
}

function parse(color: string): [number, number, number, number] {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map((value) => parseFloat(value.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
}

const rgb = (color: string) => parse(color).slice(0, 3).join(',');

function render(dir: Facing, accent?: string, lights?: 'a' | 'b'): Frame {
  const px: (string | null)[] = new Array(W * H).fill(null);
  let current: [number, number, number, number] = [0, 0, 0, 1];

  const ctx = {
    set fillStyle(color: string) {
      current = parse(color);
    },
    get fillStyle(): string {
      return current.join(',');
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const [r, g, b, a] = current;
      for (let iy = y; iy < y + h; iy++) {
        for (let ix = x; ix < x + w; ix++) {
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
          const under = px[iy * W + ix]?.split(',').map(Number) ?? [0, 0, 0];
          const mix = [r, g, b].map((value, i) => Math.round(value * a + under[i] * (1 - a)));
          px[iy * W + ix] = mix.join(',');
        }
      }
    }
  };

  drawVehicle(ctx, 0, 0, dir, 'pickup', BODY, accent, lights);
  return {
    where(color) {
      const want = rgb(color);
      const found = new Set<string>();
      px.forEach((value, index) => {
        if (value === want) found.add(`${index % W},${Math.floor(index / W)}`);
      });
      return found;
    }
  };
}

describe('drawVehicle accent stripe', () => {
  it('is not drawn when no accent is given', () => {
    const frame = render('down');
    expect(frame.where('#ff00ff').size).toBe(0);
  });

  it.each(FACINGS)('paints the accent colour somewhere on a car facing %s', (dir) => {
    const frame = render(dir, '#ff00ff');
    expect(frame.where('#ff00ff').size).toBeGreaterThan(0);
  });
});

describe('drawVehicle light bar', () => {
  it('is not drawn when lights is undefined', () => {
    const frame = render('down');
    expect(frame.where(BAR_RED).size).toBe(0);
    expect(frame.where(BAR_BLUE).size).toBe(0);
    expect(frame.where(BAR_OUTLINE).size).toBe(0);
  });

  it.each(FACINGS)('paints an outlined red-and-blue bar on a car facing %s', (dir) => {
    const frame = render(dir, undefined, 'a');
    expect(frame.where(BAR_RED).size).toBeGreaterThan(0);
    expect(frame.where(BAR_BLUE).size).toBeGreaterThan(0);
    expect(frame.where(BAR_OUTLINE).size).toBeGreaterThan(0);
  });

  it('swaps which side is red and which is blue between variants a and b', () => {
    const a = render('down', undefined, 'a');
    const b = render('down', undefined, 'b');
    expect(a.where(BAR_RED)).toEqual(b.where(BAR_BLUE));
    expect(a.where(BAR_BLUE)).toEqual(b.where(BAR_RED));
  });
});
