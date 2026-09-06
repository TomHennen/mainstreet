/**
 * A small, self-contained PNG codec used only by `scripts/validate-assets.ts`
 * (decoding) and its tests (encoding fixtures). No dependency is added for
 * this (CLAUDE.md: keep dependencies minimal) — `node:zlib` already does the
 * DEFLATE/INFLATE work a PNG's IDAT stream needs.
 *
 * Decoding supports exactly what world-pack art needs: 8-bit-per-channel
 * grayscale, RGB, indexed-color (with optional tRNS alpha) and RGBA, no
 * interlacing, the five standard filter types. Anything else (16-bit depth,
 * sub-8-bit indexed, Adam7 interlacing) is rejected with a clear message
 * rather than half-decoded. Chunk CRCs are not verified — nothing here needs
 * to detect bit-rot, only to read art a real tool exported.
 */
import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, 4 bytes per pixel, row-major. */
  rgba: Uint8Array;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG file (bad signature)');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // length + type + data + crc

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      if (data.readUInt8(10) !== 0 || data.readUInt8(11) !== 0) {
        throw new Error('unsupported PNG compression or filter method');
      }
      if (data.readUInt8(12) !== 0) throw new Error('interlaced PNGs are not supported — re-export without interlacing');
      if (bitDepth !== 8) throw new Error(`only 8-bit PNGs are supported (found bit depth ${bitDepth})`);
      if (!(colorType in CHANNELS)) throw new Error(`unsupported PNG color type ${colorType}`);
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height || colorType < 0) throw new Error('missing or incomplete IHDR chunk');
  if (colorType === 3 && !palette) throw new Error('indexed-color PNG is missing its PLTE chunk');

  const bpp = CHANNELS[colorType]; // 8-bit depth, so bytes-per-pixel == channel count
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error('PNG pixel data is truncated');

  // Undo the per-scanline filters (PNG spec §9.2) into one plain pixel buffer.
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset++];
    const row = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= bpp ? prior[i - bpp] : 0;
      let predictor: number;
      switch (filterType) {
        case 0: predictor = 0; break;
        case 1: predictor = a; break;
        case 2: predictor = b; break;
        case 3: predictor = (a + b) >> 1; break;
        case 4: predictor = paeth(a, b, c); break;
        default: throw new Error(`unsupported PNG filter type ${filterType}`);
      }
      out[i] = (row[i] + predictor) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = y * stride + x * bpp;
      const di = (y * width + x) * 4;
      if (colorType === 2) {
        rgba[di] = pixels[si]; rgba[di + 1] = pixels[si + 1]; rgba[di + 2] = pixels[si + 2]; rgba[di + 3] = 255;
      } else if (colorType === 6) {
        rgba[di] = pixels[si]; rgba[di + 1] = pixels[si + 1]; rgba[di + 2] = pixels[si + 2]; rgba[di + 3] = pixels[si + 3];
      } else if (colorType === 3) {
        const idx = pixels[si];
        const p = idx * 3;
        if (!palette || p + 2 >= palette.length) throw new Error(`palette index ${idx} is outside the PLTE chunk`);
        rgba[di] = palette[p]; rgba[di + 1] = palette[p + 1]; rgba[di + 2] = palette[p + 2];
        rgba[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = pixels[si]; rgba[di + 3] = 255;
      } else if (colorType === 4) {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = pixels[si]; rgba[di + 3] = pixels[si + 1];
      }
    }
  }

  return { width, height, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// --- encoding (test fixtures + the scratch PNGs the verification step paints) -

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encodes plain RGBA pixels (no filtering) as an 8-bit truecolor+alpha PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None) on every scanline
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor + alpha
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
