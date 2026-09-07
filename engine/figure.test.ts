import { describe, expect, it } from 'vitest';
import { drawFigure, figureKey } from './figure';
import { FACINGS, HAIR_STYLES, lookOf } from './schema';
import type { Facing, Look } from './schema';

/**
 * The placeholder townsperson is drawn with nothing but `fillStyle` and
 * `fillRect`, so a twenty-line canvas stand-in is enough to test it: rasterise
 * a frame, then ask questions about the pixels. What matters here is the
 * things a look promises — long hair reads long from every side and moves with
 * the walk, a build changes the silhouette, no style ever paints outside its
 * 16x32 frame or over an eye — not the exact shape of anybody's fringe.
 */

const W = 16;
const H = 32;

interface Frame {
  /** Colour at each pixel as "r,g,b", or null where nothing was painted. */
  px: (string | null)[];
  /** Every rectangle asked for, so we can check nothing left the frame. */
  rects: [number, number, number, number][];
  at(x: number, y: number): string | null;
  /** Pixels of exactly this colour, as "x,y" keys. */
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
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    1
  ];
}

const rgb = (color: string) => parse(color).slice(0, 3).join(',');

function render(look: Look, dir: Facing, step = 0): Frame {
  const px: (string | null)[] = new Array(W * H).fill(null);
  const rects: [number, number, number, number][] = [];
  let current: [number, number, number, number] = [0, 0, 0, 1];

  const ctx = {
    set fillStyle(color: string) {
      current = parse(color);
    },
    get fillStyle(): string {
      return current.join(',');
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h]);
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

  drawFigure(ctx, 0, 0, dir, step, look);
  return {
    px,
    rects,
    at: (x, y) => px[y * W + x],
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

/** Loud, unmistakable colours, so a pixel says which part of the figure it is. */
const TEST: Look = { hairColor: '#ff0000', skin: '#00ff00', shirt: '#0000ff' };
const HAIR = '#ff0000';

describe('drawFigure', () => {
  it('draws every style and facing inside the 16x32 frame', () => {
    for (const hair of HAIR_STYLES) {
      for (const dir of FACINGS) {
        for (let step = 0; step < 3; step++) {
          for (const build of ['slim', 'regular', 'broad'] as const) {
            const frame = render({ ...TEST, hair, build }, dir, step);
            for (const [x, y, w, h] of frame.rects) {
              expect(
                x >= 0 && y >= 0 && x + w <= W && y + h <= H,
                `${hair}/${build} facing ${dir} step ${step} paints ${x},${y} ${w}x${h}`
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('leaves both eyes readable on every style', () => {
    for (const hair of HAIR_STYLES) {
      const frame = render({ ...TEST, hair }, 'down');
      expect(frame.at(6, 11), `${hair} left eye`).toBe(rgb('#2a231a'));
      expect(frame.at(9, 11), `${hair} right eye`).toBe(rgb('#2a231a'));
    }
  });

  it('keeps long hair long from all four facings', () => {
    // The head ends at y14. Hair below that line is hair that hangs.
    for (const dir of FACINGS) {
      const hanging = [...render({ ...TEST, hair: 'long' }, dir).where(HAIR)].filter(
        (key) => Number(key.split(',')[1]) > 14
      );
      expect(hanging.length, `long hair facing ${dir}`).toBeGreaterThan(3);
    }
  });

  it('swings hanging hair with the walk frames and leaves short hair still', () => {
    for (const dir of FACINGS) {
      for (const hair of ['long', 'ponytail'] as const) {
        const left = render({ ...TEST, hair }, dir, 1).where(HAIR);
        const right = render({ ...TEST, hair }, dir, 2).where(HAIR);
        expect([...left].join(), `${hair} facing ${dir} moves with the walk`).not.toEqual(
          [...right].join()
        );
      }
      const still = ['flat', 'short'] as const;
      for (const hair of still) {
        const one = render({ ...TEST, hair }, dir, 1).where(HAIR);
        const two = render({ ...TEST, hair }, dir, 2).where(HAIR);
        expect([...one].join(), `${hair} facing ${dir} stays put`).toEqual([...two].join());
      }
    }
  });

  it('makes curly wider than the head it sits on', () => {
    const curly = render({ ...TEST, hair: 'curly' }, 'down').where(HAIR);
    const flat = render({ ...TEST, hair: 'flat' }, 'down').where(HAIR);
    const widest = (hair: Set<string>) => Math.max(...[...hair].map((key) => Number(key.split(',')[0])));
    expect(widest(curly)).toBeGreaterThan(widest(flat));
  });

  it('gives a bald head no hair on top and something at the temples', () => {
    const bald = render({ ...TEST, hair: 'bald' }, 'down').where(HAIR);
    expect([...bald].every((key) => Number(key.split(',')[1]) >= 7)).toBe(true);
    expect(bald.size).toBeGreaterThan(0);
  });

  it('changes the silhouette with build', () => {
    const width = (build: Look['build']) => {
      const frame = render({ ...TEST, build }, 'down');
      const columns = frame.px
        .map((value, index) => (value === null ? -1 : index % W))
        .filter((x) => x >= 0);
      return Math.max(...columns) - Math.min(...columns);
    };
    expect(width('slim')).toBeLessThan(width('regular'));
    expect(width('regular')).toBeLessThan(width('broad'));
  });

  it('paints the shirt in the look colour', () => {
    const frame = render(TEST, 'down');
    expect(frame.at(8, 20)).toBe(rgb('#0000ff'));
  });

  it('falls back to the original townsperson when the look is empty', () => {
    const plain = render({}, 'down');
    // The colours the placeholder has always used: skin, hair, shirt.
    expect(plain.at(8, 12)).toBe(rgb('#e8c39a'));
    expect(plain.at(8, 6)).toBe(rgb('#3a2c1e'));
    expect(plain.at(8, 20)).toBe(rgb('#7a7a6a'));
  });
});

describe('figureKey', () => {
  it('is the same for looks that draw the same figure', () => {
    expect(figureKey({ hair: 'flat', build: 'regular' })).toEqual(figureKey({}));
  });

  it('is different for every field that changes the drawing', () => {
    const base = figureKey({});
    const different: Look[] = [
      { hair: 'long' },
      { hairColor: '#111111' },
      { skin: '#222222' },
      { shirt: '#333333' },
      { build: 'broad' }
    ];
    for (const look of different) expect(figureKey(look)).not.toEqual(base);
  });
});

/**
 * `lookOf` lives in the schema rather than here, but it is what decides which
 * shirt colour this recipe is handed, so it is tested beside the drawing.
 */
describe('lookOf', () => {
  it('reads the older accent spelling as the shirt colour', () => {
    expect(lookOf({ accent: '#b5542a' })).toEqual({ shirt: '#b5542a' });
  });

  it('keeps the rest of the look while folding accent in', () => {
    expect(lookOf({ accent: '#b5542a', look: { hair: 'curly' } })).toEqual({
      hair: 'curly',
      shirt: '#b5542a'
    });
  });

  it('lets an explicit shirt win over accent', () => {
    expect(lookOf({ accent: '#b5542a', look: { shirt: '#3f6d4e' } })).toEqual({ shirt: '#3f6d4e' });
  });

  it('is empty for someone with neither', () => {
    expect(lookOf({})).toEqual({});
  });
});
