/**
 * The arithmetic behind "Import a PNG", with no browser anywhere near it.
 *
 * Everything the studio does to a picture somebody painted elsewhere — decide
 * whether its size can become this canvas, snap its colours to the palette,
 * make its mind up about soft edges, and say what it did — happens in
 * artwork.ts, so all of it can be checked here in plain Node.
 */
import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from './codec';
import {
  MAX_SCALE,
  OPAQUE_FROM,
  allowedHeights,
  describeImport,
  fitCode,
  fitImport,
  nearestIn,
  paletteRgb,
  ordinal,
  plural,
  rgbOf,
  settleCode,
  snapToPalette,
  type Fit,
  type Shape
} from './artwork';

/** A five-tile-wide, three-tile-deep building: 80 across, 48 to 96 tall. */
const SHAPE: Shape = { width: 80, height: 48, tile: 16, maxExtraRows: 3 };

/** Three colours and one empty slot, the way a world's palette.png reads. */
const PALETTE = paletteRgb(['#000000', '#ff0000', null, '#0000ff']);

function rgba(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

const fitOf = (width: number, height: number, scale = 1): Fit => ({
  scale,
  width,
  height,
  extraRows: 0
});

describe('rgbOf', () => {
  it('reads a hex colour into its three channels', () => {
    expect(rgbOf('#ae2334')).toEqual([174, 35, 52]);
    expect(rgbOf('#000000')).toEqual([0, 0, 0]);
    expect(rgbOf('#ffffff')).toEqual([255, 255, 255]);
  });
});

describe('nearestIn', () => {
  it('finds an exact colour', () => {
    expect(nearestIn(PALETTE, 255, 0, 0)).toBe(1);
  });

  it('finds the closest colour when there is no exact one', () => {
    expect(nearestIn(PALETTE, 250, 8, 4)).toBe(1);
    expect(nearestIn(PALETTE, 20, 20, 20)).toBe(0);
    expect(nearestIn(PALETTE, 10, 10, 240)).toBe(3);
  });

  it('never picks an empty palette slot', () => {
    // Index 2 holds no colour, so it can never come back however near it is.
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        expect(nearestIn(PALETTE, r, g, 128)).not.toBe(2);
      }
    }
  });

  it('says so when there is nothing to paint with', () => {
    expect(nearestIn([null, null], 10, 20, 30)).toBe(-1);
  });
});

describe('allowedHeights', () => {
  it('lists every canvas height a building will take', () => {
    expect(allowedHeights(SHAPE)).toEqual([48, 64, 80, 96]);
    expect(allowedHeights({ ...SHAPE, maxExtraRows: 0 })).toEqual([48]);
  });
});

describe('fitImport', () => {
  it('takes the exact size', () => {
    const outcome = fitImport(80, 64, SHAPE);
    expect(outcome).toEqual({ ok: true, fit: { scale: 1, width: 80, height: 64, extraRows: 1 } });
  });

  it('takes every height that is a whole number of rows, not just the current one', () => {
    for (const [height, extraRows] of [
      [48, 0],
      [64, 1],
      [80, 2],
      [96, 3]
    ] as const) {
      const outcome = fitImport(80, height, SHAPE);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.fit).toEqual({ scale: 1, width: 80, height, extraRows });
    }
  });

  it('samples a whole-number enlargement back down instead of sending it away', () => {
    const outcome = fitImport(320, 256, SHAPE);
    expect(outcome).toEqual({ ok: true, fit: { scale: 4, width: 80, height: 64, extraRows: 1 } });
  });

  it('stops enlarging somewhere sensible', () => {
    expect(fitImport(80 * MAX_SCALE, 64 * MAX_SCALE, SHAPE).ok).toBe(true);
    expect(fitImport(80 * (MAX_SCALE + 1), 64 * (MAX_SCALE + 1), SHAPE).ok).toBe(false);
  });

  it('turns down a wrong width and names the one it wants', () => {
    const outcome = fitImport(96, 64, SHAPE);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('96×64');
      expect(outcome.message).toContain('80 pixels across');
      expect(outcome.message).toContain('five tiles of 16');
      expect(outcome.message).toContain('48, 64, 80 or 96');
    }
  });

  it('turns down a height that is not a whole number of rows, and says which are', () => {
    const outcome = fitImport(80, 70, SHAPE);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('80×70');
      expect(outcome.message).toContain('48, 64, 80 or 96');
    }
  });

  it('turns down a height past the tallest canvas', () => {
    expect(fitImport(80, 112, SHAPE).ok).toBe(false);
    expect(fitImport(80, 32, SHAPE).ok).toBe(false);
  });

  it('turns down an enlargement whose height does not divide by the same amount', () => {
    // Twice the width but an odd height: not one picture at 2x.
    expect(fitImport(160, 129, SHAPE).ok).toBe(false);
  });

  it('turns down a picture with no pixels in it', () => {
    expect(fitImport(0, 0, SHAPE).ok).toBe(false);
    expect(fitImport(80.5, 64, SHAPE).ok).toBe(false);
  });

  it('never turns anyone down unkindly', () => {
    for (const [w, h] of [
      [96, 64],
      [80, 70],
      [80, 112],
      [1024, 1024],
      [0, 0]
    ]) {
      const outcome = fitImport(w, h, SHAPE);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).not.toMatch(/error|invalid|fail|wrong|sorry|can't|cannot/i);
        expect(outcome.message.length).toBeGreaterThan(40);
      }
    }
  });
});

describe('snapToPalette', () => {
  it('keeps colours that are already on the palette', () => {
    const report = snapToPalette(
      rgba([
        [0, 0, 0, 255],
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 0, 0]
      ]),
      4,
      fitOf(4, 1),
      PALETTE
    );
    expect(Array.from(report.pixels)).toEqual([0, 1, 3, TRANSPARENT]);
    expect(report.nudged).toBe(0);
    expect(report.firmed).toBe(0);
    expect(report.cleared).toBe(0);
  });

  it('moves an off-palette colour to the nearest one and counts it', () => {
    const report = snapToPalette(
      rgba([
        [250, 6, 4, 255],
        [3, 3, 250, 255],
        [255, 0, 0, 255]
      ]),
      3,
      fitOf(3, 1),
      PALETTE
    );
    expect(Array.from(report.pixels)).toEqual([1, 3, 1]);
    expect(report.nudged).toBe(2);
  });

  it('makes its mind up about part-way see-through pixels', () => {
    const report = snapToPalette(
      rgba([
        [255, 0, 0, 255], // solid
        [255, 0, 0, OPAQUE_FROM], // just solid enough
        [255, 0, 0, OPAQUE_FROM - 1], // just too faint
        [255, 0, 0, 0] // already clear, and not worth mentioning
      ]),
      4,
      fitOf(4, 1),
      PALETTE
    );
    expect(Array.from(report.pixels)).toEqual([1, 1, TRANSPARENT, TRANSPARENT]);
    expect(report.firmed).toBe(1);
    expect(report.cleared).toBe(1);
  });

  it('brings a whole-number enlargement back exactly as it went out', () => {
    const small: Array<[number, number, number, number]> = [
      [0, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 0, 0]
    ];
    const width = 2;
    const height = 2;
    const scale = 3;
    const big: Array<[number, number, number, number]> = [];
    for (let y = 0; y < height * scale; y++) {
      for (let x = 0; x < width * scale; x++) {
        big.push(small[Math.floor(y / scale) * width + Math.floor(x / scale)]);
      }
    }
    const report = snapToPalette(rgba(big), width * scale, { scale, width, height, extraRows: 0 }, PALETTE);
    expect(Array.from(report.pixels)).toEqual([0, 1, 3, TRANSPARENT]);
    expect(report.nudged).toBe(0);
  });

  it('lets the commonest colour in a block win', () => {
    // A 2x block of four: three reds and one blue.
    const report = snapToPalette(
      rgba([
        [255, 0, 0, 255],
        [255, 0, 0, 255],
        [255, 0, 0, 255],
        [0, 0, 255, 255]
      ]),
      2,
      { scale: 2, width: 1, height: 1, extraRows: 0 },
      PALETTE
    );
    expect(Array.from(report.pixels)).toEqual([1]);
  });

  it('makes everything clear when the palette holds no colours', () => {
    const report = snapToPalette(rgba([[12, 34, 56, 255]]), 1, fitOf(1, 1), [null]);
    expect(Array.from(report.pixels)).toEqual([TRANSPARENT]);
  });
});

describe('describeImport', () => {
  const base = { scale: 1, width: 80, height: 64, extraRows: 1, pixels: new Uint8Array(0) };

  it('says so plainly when nothing needed changing', () => {
    expect(describeImport({ ...base, nudged: 0, firmed: 0, cleared: 0 }, 1)).toBe(
      'Imported, and every colour was already on the palette. Lovely.'
    );
  });

  it('says how many pixels it nudged', () => {
    const message = describeImport({ ...base, nudged: 312, firmed: 0, cleared: 0 }, 1);
    expect(message).toContain('We nudged 312 pixels to the nearest palette colour');
    expect(message).toContain('Undo puts it back');
  });

  it('counts one pixel as one pixel', () => {
    expect(describeImport({ ...base, nudged: 1, firmed: 0, cleared: 0 }, 1)).toContain('nudged 1 pixel to');
    expect(describeImport({ ...base, nudged: 0, firmed: 1, cleared: 0 }, 1)).toContain('1 pixel was part-way');
    expect(describeImport({ ...base, nudged: 0, firmed: 0, cleared: 1 }, 1)).toContain('1 pixel at the edges was');
  });

  it('mentions a canvas that changed height, and stays quiet about one that did not', () => {
    expect(describeImport({ ...base, extraRows: 3, nudged: 0, firmed: 0, cleared: 0 }, 1)).toContain(
      'three rows above the footprint'
    );
    expect(describeImport({ ...base, extraRows: 0, nudged: 0, firmed: 0, cleared: 0 }, 1)).toContain(
      'stops at the roofline'
    );
    expect(describeImport({ ...base, extraRows: 1, nudged: 0, firmed: 0, cleared: 0 }, 1)).not.toContain('canvas');
  });

  it('mentions sampling an enlargement back down', () => {
    expect(describeImport({ ...base, scale: 4, nudged: 0, firmed: 0, cleared: 0 }, 1)).toContain(
      '4 times life size, so we sampled it back down to 80×64'
    );
  });

  it('keeps its warmth however much it had to adjust', () => {
    const message = describeImport({ ...base, scale: 4, extraRows: 3, nudged: 900, firmed: 12, cleared: 7 }, 1);
    expect(message.startsWith('Imported.')).toBe(true);
    expect(message).not.toMatch(/error|invalid|fail|bad|wrong|sorry/i);
  });
});

describe('ordinal', () => {
  it('counts columns the way a person would say them', () => {
    expect([1, 2, 3, 4, 5, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '5th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd'
    ]);
  });
});

describe('plural', () => {
  it('spells small numbers out and leaves big ones as digits', () => {
    expect(plural(0, 'row', 'rows')).toBe('no rows');
    expect(plural(1, 'row', 'rows')).toBe('one row');
    expect(plural(3, 'row', 'rows')).toBe('three rows');
    expect(plural(40, 'row', 'rows')).toBe('40 rows');
  });
});

describe('fitCode', () => {
  it('takes a code at the exact footprint width, at any legal height', () => {
    expect(fitCode(80, 48, SHAPE)).toEqual({ ok: true, extraRows: 0 });
    expect(fitCode(80, 64, SHAPE)).toEqual({ ok: true, extraRows: 1 });
    expect(fitCode(80, 96, SHAPE)).toEqual({ ok: true, extraRows: 3 });
  });

  it('never scales a code, because its pixels are literal', () => {
    // A picture at 2x is welcome; a code at twice the width is a different
    // building's drawing, and sampling it down would invent pixels.
    expect(fitImport(160, 128, SHAPE).ok).toBe(true);
    expect(fitCode(160, 128, SHAPE).ok).toBe(false);
  });

  it('turns down a height this building has no room for', () => {
    expect(fitCode(80, 112, SHAPE).ok).toBe(false);
    expect(fitCode(80, 70, SHAPE).ok).toBe(false);
    expect(fitCode(80, 32, SHAPE).ok).toBe(false);
  });

  it('reassures the person that the code itself is still good', () => {
    for (const [w, h] of [
      [96, 64],
      [80, 112]
    ]) {
      const outcome = fitCode(w, h, SHAPE);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.message).toContain('code is still good');
        expect(outcome.message).not.toMatch(/error|invalid|fail|wrong|sorry/i);
      }
    }
  });
});

describe('settleCode', () => {
  it('leaves a drawing whose colours this world has alone', () => {
    const before = Uint8Array.from([0, 1, 3, TRANSPARENT]);
    const after = settleCode(before, PALETTE);
    expect(Array.from(after.pixels)).toEqual([0, 1, 3, TRANSPARENT]);
    expect(after.stray).toBe(0);
  });

  it('clears an index past the end of the palette and counts it', () => {
    const after = settleCode(Uint8Array.from([0, 9, 1, 200]), PALETTE);
    expect(Array.from(after.pixels)).toEqual([0, TRANSPARENT, 1, TRANSPARENT]);
    expect(after.stray).toBe(2);
  });

  it('clears an index that points at an empty palette slot', () => {
    // Index 2 is a slot with no colour in it, so it would draw as nothing.
    const after = settleCode(Uint8Array.from([2, 2, 1]), PALETTE);
    expect(Array.from(after.pixels)).toEqual([TRANSPARENT, TRANSPARENT, 1]);
    expect(after.stray).toBe(2);
  });

  it('never changes the drawing it was handed', () => {
    const before = Uint8Array.from([0, 9, 1]);
    settleCode(before, PALETTE);
    expect(Array.from(before)).toEqual([0, 9, 1]);
  });
});
