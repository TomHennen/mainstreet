/**
 * Taking a picture somebody painted somewhere else — Aseprite, Piskel, a
 * photo editor, a phone — and turning it into this drawing.
 *
 * Two jobs live here, and both of them are pure arithmetic:
 *
 *   1. `fitImport` decides whether a picture's size can become this canvas,
 *      and if it can't, says so in a way worth reading.
 *   2. `snapToPalette` turns its RGBA pixels into palette indices, moving any
 *      colour that isn't quite on the palette to the one nearest it and
 *      making its mind up about part-way see-through pixels.
 *
 * Neither of them refuses a drawing it could reasonably accept. A picture at
 * a whole number of times life size is sampled back down rather than sent
 * away; a height that is a different (but legal) number of rows above the
 * footprint moves the canvas rather than the artist.
 *
 * Like codec.ts this module is free of DOM and of Node APIs, so the studio in
 * a browser and vitest on a laptop run exactly the same code. Keep it that
 * way: no `document`, no `Image`, no `Buffer`. Everything a browser is needed
 * for — decoding the file, drawing it to a canvas — happens in studio.ts and
 * arrives here as plain numbers.
 */
import { TRANSPARENT } from './codec';

/** Alpha at or above this counts as a solid pixel; below it, as a clear one. */
export const OPAQUE_FROM = 128;

/** The largest whole-number enlargement we will sample back down to size. */
export const MAX_SCALE = 8;

export type Rgb = [number, number, number];

// --- small shared helpers ----------------------------------------------------

export function rgbOf(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export function inWords(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

export function plural(n: number, one: string, many: string): string {
  return `${inWords(n)} ${n === 1 ? one : many}`;
}

/** Pixel counts run into the thousands, so they stay as digits. */
function tally(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function were(n: number): string {
  return n === 1 ? 'was' : 'were';
}

/** "48, 64, 80 or 96" */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// --- the palette -------------------------------------------------------------

/** The world's palette as RGB triples, ready to measure against. A null entry
 *  is a slot with no colour in it, which nobody may paint with. */
export function paletteRgb(palette: readonly (string | null)[]): (Rgb | null)[] {
  return palette.map((colour) => (colour ? rgbOf(colour) : null));
}

/** The palette index whose colour sits closest to this RGB triple, or -1 if
 *  the palette holds no colours at all. */
export function nearestIn(palette: readonly (Rgb | null)[], r: number, g: number, b: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const colour = palette[i];
    if (!colour) continue;
    const distance = (colour[0] - r) ** 2 + (colour[1] - g) ** 2 + (colour[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// --- does this picture fit? --------------------------------------------------

/** The shape of canvas a building will take: its footprint, and how much sky
 *  it is allowed above it. */
export interface Shape {
  /** Footprint width in pixels. The one measurement that cannot bend. */
  width: number;
  /** Footprint height in pixels, with no spare rows above it. */
  height: number;
  /** Tile size, 16 everywhere so far. */
  tile: number;
  /** Most spare rows of `tile` pixels allowed above the footprint. */
  maxExtraRows: number;
}

export interface Fit {
  /** How many times life size the picture came in at. 1 means exactly right. */
  scale: number;
  /** The canvas it lands on, once scale is taken back out. */
  width: number;
  height: number;
  /** Rows of `tile` above the footprint that height comes to. */
  extraRows: number;
}

export type FitOutcome = { ok: true; fit: Fit } | { ok: false; message: string };

/** Every canvas height this building will take, shortest first. */
export function allowedHeights(shape: Shape): number[] {
  const heights: number[] = [];
  for (let rows = 0; rows <= shape.maxExtraRows; rows++) heights.push(shape.height + rows * shape.tile);
  return heights;
}

/**
 * Works out how a picture of this size becomes this canvas — or says kindly
 * why it can't. The width has to be the footprint width, or a whole number of
 * times it (up to MAX_SCALE), because that is what the map has room for. The
 * height is freer: any whole number of spare rows the building allows.
 */
export function fitImport(imageWidth: number, imageHeight: number, shape: Shape): FitOutcome {
  const heights = allowedHeights(shape);
  const heightsList = listOf(heights.map(String));

  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth < 1 || imageHeight < 1) {
    return {
      ok: false,
      message:
        'That file came through with no picture in it at all. Saving it again as a PNG ' +
        'from wherever you painted it usually settles that.'
    };
  }

  const scale = imageWidth % shape.width === 0 ? imageWidth / shape.width : 0;
  if (scale < 1 || scale > MAX_SCALE || imageHeight % scale !== 0) {
    return {
      ok: false,
      message:
        `That picture is ${imageWidth}×${imageHeight}, and this one wants to be ${shape.width} pixels across — ` +
        `${plural(shape.width / shape.tile, 'tile', 'tiles')} of ${shape.tile}. ` +
        `Resize it to ${shape.width} wide and it will drop straight in, and the height can be ${heightsList}.`
    };
  }

  const width = imageWidth / scale;
  const height = imageHeight / scale;
  const extraRows = (height - shape.height) / shape.tile;
  if (!Number.isInteger(extraRows) || extraRows < 0 || extraRows > shape.maxExtraRows) {
    return {
      ok: false,
      message:
        `That picture is ${imageWidth}×${imageHeight}. The width is spot on${scale > 1 ? `, at ${scale} times life size` : ''} — ` +
        `it is the height that needs a hand: ${heightsList}, so there is a whole number of rows above the footprint. ` +
        'Trim or pad it a little and it is very welcome.'
    };
  }

  return { ok: true, fit: { scale, width, height, extraRows } };
}

// --- does a pasted code fit? -------------------------------------------------

export type CodeFit = { ok: true; extraRows: number } | { ok: false; message: string };

/**
 * Whether a drawing that arrived as a code can become this building's canvas.
 *
 * Unlike a picture, a code carries literal palette indices — there is nothing
 * sensible to sample down — so its size either fits or it doesn't. The height
 * is still free to be any legal number of rows above the footprint; the canvas
 * moves to meet it.
 */
export function fitCode(width: number, height: number, shape: Shape): CodeFit {
  if (width !== shape.width) {
    return {
      ok: false,
      message:
        `That code holds a ${width}×${height} drawing, and this building's canvas is ${shape.width} across. ` +
        'It looks like it was painted for a different building — whichever one it is, the code is still good.'
    };
  }

  const extraRows = (height - shape.height) / shape.tile;
  if (!Number.isInteger(extraRows) || extraRows < 0 || extraRows > shape.maxExtraRows) {
    return {
      ok: false,
      message:
        `That code holds a ${width}×${height} drawing, and this building takes a height of ` +
        `${listOf(allowedHeights(shape).map(String))}. Nothing is lost — the code is still good, it is ` +
        'just taller or shorter than this canvas goes.'
    };
  }

  return { ok: true, extraRows };
}

/**
 * A code from another world — or from before a palette was tidied — can carry
 * an index this world has no colour for. Those pixels would draw as nothing at
 * all, which is a confusing thing to hand someone silently, so they are made
 * properly clear and counted so they can be mentioned.
 */
export function settleCode(
  pixels: Uint8Array,
  palette: readonly (Rgb | null)[]
): { pixels: Uint8Array; stray: number } {
  const settled = Uint8Array.from(pixels);
  let stray = 0;
  for (let i = 0; i < settled.length; i++) {
    const value = settled[i];
    if (value === TRANSPARENT) continue;
    if (value < palette.length && palette[value]) continue;
    settled[i] = TRANSPARENT;
    stray++;
  }
  return { pixels: settled, stray };
}

// --- turning pixels into palette indices -------------------------------------

const NUDGED = 1;
const FIRMED = 2;
const CLEARED = 4;

export interface Snapped extends Fit {
  /** width * height bytes: a palette index, or TRANSPARENT. */
  pixels: Uint8Array;
  /** Solid pixels that were not quite a palette colour and moved to one. */
  nudged: number;
  /** Part-way see-through pixels that came through solid. */
  firmed: number;
  /** Part-way see-through pixels too faint to keep, now clear. */
  cleared: number;
}

/**
 * Reads RGBA pixels into palette indices.
 *
 * Anything fainter than OPAQUE_FROM becomes clear and anything at or above it
 * becomes solid, because a drawing that ships has no half-measures: the codec
 * carries a palette index or nothing at all. Colours that aren't on the
 * palette move to the nearest one that is, in plain RGB distance.
 *
 * When the picture came in enlarged, each block of scale × scale source
 * pixels votes and the commonest value wins, with ties going to whichever was
 * seen first. A picture enlarged by a whole number with no smoothing — which
 * is how a pixel editor's "export at 4x" leaves it — comes back exactly as it
 * went out.
 */
export function snapToPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  fit: Fit,
  palette: readonly (Rgb | null)[]
): Snapped {
  const { scale, width, height } = fit;

  // An exact colour match is much the commonest case, so look it up rather
  // than measuring against all 64 every time.
  const exact = new Map<number, number>();
  for (let i = 0; i < palette.length; i++) {
    const colour = palette[i];
    if (!colour) continue;
    const key = (colour[0] << 16) | (colour[1] << 8) | colour[2];
    if (!exact.has(key)) exact.set(key, i);
  }

  const sourceCount = imageWidth * height * scale;
  const value = new Uint8Array(sourceCount);
  const flag = new Uint8Array(sourceCount);

  for (let i = 0; i < sourceCount; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha < OPAQUE_FROM) {
      value[i] = TRANSPARENT;
      if (alpha > 0) flag[i] = CLEARED;
      continue;
    }
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const found = exact.get((r << 16) | (g << 8) | b);
    if (found === undefined) {
      const nearest = nearestIn(palette, r, g, b);
      value[i] = nearest < 0 ? TRANSPARENT : nearest;
      if (nearest >= 0) flag[i] |= NUDGED;
    } else {
      value[i] = found;
    }
    if (alpha < 255) flag[i] |= FIRMED;
  }

  const pixels = new Uint8Array(width * height);
  let nudged = 0;
  let firmed = 0;
  let cleared = 0;

  if (scale === 1) {
    pixels.set(value.subarray(0, pixels.length));
    for (let i = 0; i < pixels.length; i++) {
      if (flag[i] & NUDGED) nudged++;
      if (flag[i] & FIRMED) firmed++;
      if (flag[i] & CLEARED) cleared++;
    }
  } else {
    // 256 counters covers every value there is: a palette index or TRANSPARENT.
    const votes = new Int32Array(256);
    const seen = new Uint8Array(256);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        votes.fill(0);
        seen.fill(0);
        let best = TRANSPARENT;
        let bestVotes = -1;
        for (let sy = y * scale; sy < (y + 1) * scale; sy++) {
          for (let sx = x * scale; sx < (x + 1) * scale; sx++) {
            const at = sy * imageWidth + sx;
            const v = value[at];
            seen[v] |= flag[at];
            const count = ++votes[v];
            if (count > bestVotes) {
              bestVotes = count;
              best = v;
            }
          }
        }
        pixels[y * width + x] = best;
        if (seen[best] & NUDGED) nudged++;
        if (seen[best] & FIRMED) firmed++;
        if (seen[best] & CLEARED) cleared++;
      }
    }
  }

  return { ...fit, pixels, nudged, firmed, cleared };
}

/**
 * What to tell the person afterwards. It always says the drawing is in, then
 * every adjustment it made on their behalf, so nothing happens to a drawing
 * quietly.
 */
export function describeImport(report: Snapped, rowsBefore: number): string {
  const parts: string[] = [];

  if (report.scale > 1) {
    parts.push(
      `It came in at ${report.scale} times life size, so we sampled it back down to ${report.width}×${report.height}.`
    );
  }
  if (report.extraRows !== rowsBefore) {
    parts.push(
      report.extraRows === 0
        ? 'It stops at the roofline, so the canvas came down to meet it.'
        : `It has ${plural(report.extraRows, 'row', 'rows')} above the footprint, so the canvas made room.`
    );
  }
  if (report.nudged > 0) {
    parts.push(
      `We nudged ${tally(report.nudged, 'pixel')} to the nearest palette colour, which usually looks just the same.`
    );
  }
  if (report.firmed > 0) {
    parts.push(`${tally(report.firmed, 'pixel')} ${were(report.firmed)} part-way see-through and came through solid.`);
  }
  if (report.cleared > 0) {
    parts.push(
      `${tally(report.cleared, 'pixel')} at the edges ${were(report.cleared)} too faint to keep, so ` +
        `${report.cleared === 1 ? 'it is' : 'they are'} clear now.`
    );
  }

  if (parts.length === 0) return 'Imported, and every colour was already on the palette. Lovely.';
  return `Imported. ${parts.join(' ')} Undo puts it back if you would rather.`;
}
