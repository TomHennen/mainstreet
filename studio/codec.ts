/**
 * MSA1 — the little text code a Studio drawing travels in.
 *
 * A contributor paints a building facade in the Studio and sends it to us in
 * the body of an ordinary email. So the drawing has to survive being typed,
 * pasted, wrapped by a mail client and read back by a human: it is plain
 * ASCII, it is short, and it says on its face what it is.
 *
 * ---------------------------------------------------------------------------
 * FORMAT
 * ---------------------------------------------------------------------------
 *
 *   MSA1|<world>|<building>|<w>x<h>|<payload>[|<columns>]
 *
 *   MSA1        magic + version. Bump the digit if the payload changes shape.
 *   <world>     world pack id, e.g. "route10". No "|".
 *   <building>  building id from world.json, e.g. "stewarts". No "|".
 *   <w>x<h>     canvas size in pixels, decimal, e.g. "96x112". The width is
 *               always the footprint width in tiles x 16 (DESIGN.md §4); the
 *               height is the footprint height plus any extra rows of 16 the
 *               artist added above it.
 *   <payload>   base64url (A-Z a-z 0-9 - _, no padding) of the byte stream
 *               below.
 *   <columns>   optional, and left off far more often than not: where the
 *               artist put the door and the little plaque, as
 *               "door=2,plaque=3". Both are tile columns across the front of
 *               the building, counting from 0 at its left edge, and the two
 *               are never the same column. Either key may appear on its own,
 *               in either order. A code without this part means "leave them
 *               where the world already has them", which is what every code
 *               written before this part existed means too — so old codes and
 *               new ones read the same way.
 *
 * The byte stream is the pixels, row-major, left to right then top to bottom,
 * run-length encoded as a flat sequence of (value, run) pairs:
 *
 *   value   one byte. 0-254 is an index into the world's palette.png (pixel
 *           x + y * width of that image, reading left to right, top to
 *           bottom). 255 means transparent.
 *   run     how many pixels in a row carry that value, as a varint: 7 bits
 *           per byte, little-endian, high bit set on every byte but the last.
 *           A run is at least 1 and never crosses the end of the image.
 *
 * The runs must add up to exactly w * h. Nothing else is stored in the
 * payload: no colour table (the palette is the world's), no alpha (a pixel is
 * either a palette colour or transparent), no metadata.
 *
 * ---------------------------------------------------------------------------
 * NOTES FOR ANYTHING THAT READS THIS
 * ---------------------------------------------------------------------------
 *
 * This module is deliberately free of DOM and of Node APIs, so the Studio in
 * the browser and the intake script on a laptop can share it unchanged. Keep
 * it that way: no `document`, no `Buffer`, no `atob`.
 *
 * `decode` is forgiving on the way in — it strips every whitespace character
 * first, so a code that a mail client wrapped over four lines still reads, and
 * it accepts standard base64 characters ("+", "/", "=") as well as base64url,
 * because plenty of tools produce those. `encode` only ever emits base64url.
 */

/** Value of a pixel with no colour. */
export const TRANSPARENT = 255;

/** Highest palette index a pixel may carry. */
export const MAX_INDEX = 254;

/** Magic + version at the head of every code. */
export const MAGIC = 'MSA1';

/** Pixels to a tile, the one number the whole project is built on (DESIGN.md §4). */
const TILE = 16;

export interface Drawing {
  /** World pack id, e.g. "route10". */
  world: string;
  /** Building id from that world's world.json, e.g. "stewarts". */
  building: string;
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** width * height bytes, row-major: 0-254 palette index, 255 transparent. */
  pixels: Uint8Array;
  /**
   * Tile column the door goes in, counting from 0 at the building's left
   * edge. Left off when the drawing keeps the door where the world has it.
   */
  door?: number;
  /** Tile column the plaque goes in, the same way. Never the door's column. */
  plaque?: number;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64_VALUE = (() => {
  const table = new Map<string, number>();
  for (let i = 0; i < B64URL.length; i++) table.set(B64URL[i], i);
  // Standard base64 spells the last two characters differently. Accept both,
  // so a code that went through a tool which re-encoded it still reads.
  table.set('+', 62);
  table.set('/', 63);
  return table;
})();

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const b0 = bytes[i];
    const b1 = left > 1 ? bytes[i + 1] : 0;
    const b2 = left > 2 ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0b11) << 4) | (b1 >> 4)];
    if (left > 1) out += B64URL[((b1 & 0b1111) << 2) | (b2 >> 6)];
    if (left > 2) out += B64URL[b2 & 0b111111];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const chars = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((chars.length * 3) / 4));
  let out = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < chars.length; i++) {
    const value = B64_VALUE.get(chars[i]);
    if (value === undefined) {
      throw new CodeError(
        `There is a character in the code that doesn't belong there ("${chars[i]}"). ` +
          'Copying the whole code again usually sorts it out.'
      );
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (acc >> bits) & 0xff;
    }
  }

  return bytes.subarray(0, out);
}

/** A code that could not be read, with a message worth showing a person. */
export class CodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeError';
  }
}

function writeVarint(into: number[], value: number): void {
  let rest = value;
  while (rest > 0x7f) {
    into.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  into.push(rest);
}

/**
 * Checks a door or plaque column and hands it back. Columns are counted across
 * the front of the building, so the only ones that mean anything are the ones
 * the drawing itself covers.
 */
function column(name: string, value: number, width: number): number {
  const columns = Math.max(1, Math.floor(width / TILE));
  if (!Number.isInteger(value) || value < 0 || value >= columns) {
    throw new CodeError(
      `The ${name} is asking for column ${value}, and this building has columns 0 to ${columns - 1}.`
    );
  }
  return value;
}

/** The optional last part of a code: "door=2,plaque=3", or "" when there is nothing to say. */
function writeColumns(drawing: Drawing): string {
  const { door, plaque, width } = drawing;
  if (door === undefined && plaque === undefined) return '';
  if (door !== undefined && door === plaque) {
    throw new CodeError(`The door and the plaque are both asking for column ${door}, and they need one each.`);
  }
  const bits: string[] = [];
  if (door !== undefined) bits.push(`door=${column('door', door, width)}`);
  if (plaque !== undefined) bits.push(`plaque=${column('plaque', plaque, width)}`);
  return bits.join(',');
}

/** Reads that same part back. Either key may appear on its own, in either order. */
function readColumns(text: string, width: number): { door?: number; plaque?: number } {
  const out: { door?: number; plaque?: number } = {};
  for (const bit of text.split(',')) {
    const match = /^(door|plaque)=(\d+)$/.exec(bit);
    if (!match) {
      throw new CodeError(
        `The end of this code says where the door and the plaque go, like "door=2,plaque=3", ` +
          `and this one reads "${bit}". Copying the whole code again usually sorts it out.`
      );
    }
    const name = match[1] as 'door' | 'plaque';
    if (out[name] !== undefined) throw new CodeError(`This code names the ${name}'s column twice.`);
    out[name] = column(name, Number(match[2]), width);
  }
  if (out.door !== undefined && out.door === out.plaque) {
    throw new CodeError(`This code puts the door and the plaque both in column ${out.door}, and they need one each.`);
  }
  return out;
}

/** Turns a drawing into its MSA1 code. */
export function encode(drawing: Drawing): string {
  const { world, building, width, height, pixels } = drawing;

  if (!/^[^|\s]+$/.test(world)) throw new CodeError(`"${world}" is not a world id this code can carry.`);
  if (!/^[^|\s]+$/.test(building)) throw new CodeError(`"${building}" is not a building id this code can carry.`);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new CodeError(`A drawing needs a whole number of pixels each way, and this one is ${width}x${height}.`);
  }
  if (pixels.length !== width * height) {
    throw new CodeError(
      `This drawing says it is ${width}x${height} pixels but carries ${pixels.length} of them, ` +
        `where ${width * height} were expected.`
    );
  }

  const bytes: number[] = [];
  let at = 0;
  while (at < pixels.length) {
    const value = pixels[at];
    if (value > TRANSPARENT) throw new CodeError(`A pixel holds ${value}, which is past the end of any palette.`);
    let run = 1;
    while (at + run < pixels.length && pixels[at + run] === value) run++;
    bytes.push(value);
    writeVarint(bytes, run);
    at += run;
  }

  const payload = toBase64Url(Uint8Array.from(bytes));
  const columns = writeColumns(drawing);
  const head = `${MAGIC}|${world}|${building}|${width}x${height}|${payload}`;
  return columns ? `${head}|${columns}` : head;
}

/** Reads an MSA1 code back into a drawing. Throws a CodeError worth showing. */
export function decode(code: string): Drawing {
  const tidy = code.replace(/\s+/g, '');
  const parts = tidy.split('|');

  if (parts[0] !== MAGIC) {
    throw new CodeError(
      `This doesn't look like a mainstreet art code — they start with "${MAGIC}|". ` +
        'It may just be that a line got left behind in the copying.'
    );
  }
  if (parts.length < 5 || parts.length > 6) {
    throw new CodeError(
      `A mainstreet art code has five parts separated by "|" — six when it also says where the door goes — ` +
        `and this one has ${parts.length}. Copying it again from the Studio usually puts it right.`
    );
  }

  const [, world, building, size, payload, columns] = parts;
  const dimensions = /^(\d+)x(\d+)$/.exec(size);
  if (!dimensions) throw new CodeError(`"${size}" isn't a size this code can read; it should look like "96x112".`);

  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (width <= 0 || height <= 0) throw new CodeError(`A drawing can't be ${width}x${height} pixels.`);
  if (!world) throw new CodeError('This code does not say which world it is for.');
  if (!building) throw new CodeError('This code does not say which building it is for.');

  const bytes = fromBase64Url(payload);
  const pixels = new Uint8Array(width * height);
  let out = 0;
  let at = 0;

  while (at < bytes.length) {
    const value = bytes[at++];
    let run = 0;
    let shift = 0;
    let byte: number;
    do {
      if (at >= bytes.length) throw new CodeError('The code stops in the middle of a run of pixels.');
      byte = bytes[at++];
      run |= (byte & 0x7f) << shift;
      shift += 7;
      if (shift > 28) throw new CodeError('The code claims a run of pixels longer than any drawing.');
    } while (byte & 0x80);

    if (run < 1) throw new CodeError('The code holds a run of no pixels at all.');
    if (out + run > pixels.length) {
      throw new CodeError(
        `The code holds more pixels than a ${width}x${height} drawing has room for. ` +
          'It may have been joined with another code by mistake.'
      );
    }
    pixels.fill(value, out, out + run);
    out += run;
  }

  if (out !== pixels.length) {
    throw new CodeError(
      `The code is short: a ${width}x${height} drawing needs ${pixels.length} pixels and this one has ${out}. ` +
        'A line probably went missing in the copying.'
    );
  }

  // Read last, so a code whose pixels are wrong says so first: the pixels are
  // the drawing, and the columns are a note pinned to it.
  const placed = columns === undefined ? {} : readColumns(columns, width);

  return { world, building, width, height, pixels, ...placed };
}
