import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png';

function solid(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([r, g, b, a], i * 4);
  return rgba;
}

describe('decodePng', () => {
  it('round-trips a solid opaque image encoded by encodePng', () => {
    const rgba = solid(3, 2, [180, 84, 42, 255]);
    const decoded = decodePng(encodePng(3, 2, rgba));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it('round-trips a fully transparent pixel', () => {
    const rgba = new Uint8Array(4 * 4);
    rgba.set([10, 20, 30, 255], 0);
    rgba.set([0, 0, 0, 0], 4);
    rgba.set([255, 255, 255, 128], 8); // partial alpha — decoding still reports it as-is
    rgba.set([1, 2, 3, 255], 12);
    const decoded = decodePng(encodePng(2, 2, rgba));
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it('rejects a bad signature', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/signature/);
  });

  it('rejects an interlaced image', () => {
    const buf = encodePng(1, 1, solid(1, 1, [1, 2, 3, 255]));
    // IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type,
    // then 13 bytes of IHDR data ending in the interlace-method byte.
    buf[8 + 4 + 4 + 12] = 1;
    expect(() => decodePng(buf)).toThrow(/interlac/);
  });

  it('rejects an unsupported bit depth', () => {
    const buf = encodePng(1, 1, solid(1, 1, [1, 2, 3, 255]));
    buf[8 + 4 + 4 + 8] = 16;
    expect(() => decodePng(buf)).toThrow(/bit depth/);
  });
});
