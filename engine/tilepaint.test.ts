import { describe, expect, it } from 'vitest';
import { drawTile } from './tilepaint';
import { TILE } from './tiled';
import type { TileDef } from './tiled';

/**
 * A canvas stand-in that just records every rectangle it is asked to fill,
 * keyed by the colour it was filled with — enough to ask "how many, where,
 * and in what colour" without a browser (the same trick engine/glyphs.test.ts,
 * engine/figure.test.ts and engine/motor.test.ts use).
 */
function render(def: TileDef, px = 0, py = 0) {
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  const ctx = {
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: String(this.fillStyle) });
    }
  };
  drawTile(ctx, def, px, py);
  return rects;
}

function tile(style: TileDef['style'], colors: string[]): TileDef {
  return {
    kind: 'stairs',
    style,
    colors,
    solid: true,
    opaque: false,
    drive: false,
    tileset: 'test',
    id: 0,
    sx: 0,
    sy: 0
  };
}

describe('drawTile "stairs"', () => {
  const def = tile('stairs', ['#8a6b48', '#2b2b30', '#e8ddc6']);

  it('paints entirely inside its 16x16 cell, wherever the cell is placed on the sheet', () => {
    const rects = render(def, 32, 48);
    expect(rects.length).toBeGreaterThan(0);
    for (const { x, y, w, h } of rects) {
      expect(x).toBeGreaterThanOrEqual(32);
      expect(y).toBeGreaterThanOrEqual(48);
      expect(x + w).toBeLessThanOrEqual(32 + TILE);
      expect(y + h).toBeLessThanOrEqual(48 + TILE);
    }
  });

  it('uses the tread, opening and rail colours the tile was given', () => {
    const rects = render(def);
    const fills = new Set(rects.map((r) => r.fill));
    expect(fills.has('#8a6b48')).toBe(true); // tread
    expect(fills.has('#2b2b30')).toBe(true); // dark opening
    expect(fills.has('#e8ddc6')).toBe(true); // handrail
  });

  it('falls back to a dark opening and the tread colour for the rail when only one colour is given', () => {
    const rects = render(tile('stairs', ['#8a6b48']));
    const fills = new Set(rects.map((r) => r.fill));
    expect(fills.has('#8a6b48')).toBe(true);
    expect(fills.has('#000000')).toBe(true);
  });

  it('paints something different from the "paper" style given the same colours', () => {
    const stairsRects = render(def);
    const paperRects = render(tile('paper', def.colors));
    expect(stairsRects).not.toEqual(paperRects);
  });
});
