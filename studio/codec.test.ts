import { describe, expect, it } from 'vitest';
import { CodeError, MAGIC, TRANSPARENT, decode, encode } from './codec';

/**
 * The code is the whole submission pipeline for Studio v1 (issue #20): a
 * drawing leaves a contributor's phone as this string and nothing else, so a
 * round trip that loses a pixel loses their afternoon. Plain Node, no DOM.
 */

function drawing(width: number, height: number, fill: (i: number) => number) {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = fill(i);
  return { world: 'route10', building: 'stewarts', width, height, pixels };
}

describe('encode/decode', () => {
  it('round-trips a blank canvas', () => {
    const before = drawing(96, 112, () => TRANSPARENT);
    const after = decode(encode(before));
    expect(after.world).toBe('route10');
    expect(after.building).toBe('stewarts');
    expect(after.width).toBe(96);
    expect(after.height).toBe(112);
    expect(Array.from(after.pixels)).toEqual(Array.from(before.pixels));
  });

  it('round-trips a drawing whose every pixel differs from its neighbour', () => {
    const before = drawing(16, 16, (i) => i % 255);
    expect(Array.from(decode(encode(before)).pixels)).toEqual(Array.from(before.pixels));
  });

  it('round-trips runs long enough to need a multi-byte varint', () => {
    // 128 and 16384 are the varint byte boundaries; a facade-sized flat wall
    // crosses both.
    const before = drawing(200, 200, (i) => (i < 40000 ? 7 : 7));
    const code = encode(before);
    expect(Array.from(decode(code).pixels)).toEqual(Array.from(before.pixels));
    expect(code.length).toBeLessThan(60);
  });

  it('round-trips every legal pixel value, transparency included', () => {
    const before = drawing(256, 1, (i) => i);
    expect(Array.from(decode(encode(before)).pixels)).toEqual(Array.from(before.pixels));
  });

  it('round-trips a plausible facade of wall, roof, door and sky', () => {
    const width = 96;
    const height = 112;
    const before = drawing(width, height, (i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      if (y < 16) return TRANSPARENT;
      if (y < 24) return 12; // roof band
      if (y > 96 && x > 40 && x < 56) return 3; // door
      return 41; // wall
    });
    const after = decode(encode(before));
    expect(Array.from(after.pixels)).toEqual(Array.from(before.pixels));
  });

  it('writes a header a person can read', () => {
    const code = encode(drawing(96, 112, () => TRANSPARENT));
    expect(code.startsWith(`${MAGIC}|route10|stewarts|96x112|`)).toBe(true);
  });

  it('emits only base64url characters in the payload', () => {
    const code = encode(drawing(48, 64, (i) => i % 63));
    const payload = code.split('|')[4];
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reads a code a mail client has wrapped over several lines', () => {
    const before = drawing(64, 48, (i) => (i % 7 === 0 ? TRANSPARENT : i % 40));
    const code = encode(before);
    const wrapped = code.replace(/(.{20})/g, '$1\n  ');
    expect(Array.from(decode(wrapped).pixels)).toEqual(Array.from(before.pixels));
  });

  it('reads a payload that came back in standard base64', () => {
    const before = drawing(32, 32, (i) => i % 200);
    const [magic, world, building, size, payload] = encode(before).split('|');
    const standard = payload.replace(/-/g, '+').replace(/_/g, '/');
    const code = [magic, world, building, size, standard].join('|');
    expect(Array.from(decode(code).pixels)).toEqual(Array.from(before.pixels));
  });
});

describe('decode complains kindly', () => {
  it('rejects something that is not a code at all', () => {
    expect(() => decode('hello, here is my drawing!')).toThrow(CodeError);
  });

  it('rejects a code missing a section', () => {
    expect(() => decode('MSA1|route10|stewarts|AAAA')).toThrow(/five parts/);
  });

  it('rejects a size it cannot read', () => {
    expect(() => decode('MSA1|route10|stewarts|big|AAAA')).toThrow(/isn't a size/);
  });

  it('rejects a stray character in the payload', () => {
    const code = encode(drawing(8, 8, () => 1));
    expect(() => decode(`${code}*`)).toThrow(/doesn't belong there/);
  });

  it('rejects a code with too few pixels for its size', () => {
    const short = encode(drawing(8, 8, () => 1)).replace('8x8', '16x16');
    expect(() => decode(short)).toThrow(/short/);
  });

  it('rejects a code with more pixels than its size allows', () => {
    const long = encode(drawing(16, 16, () => 1)).replace('16x16', '8x8');
    expect(() => decode(long)).toThrow(/more pixels than/);
  });
});

describe('encode refuses what it cannot carry', () => {
  it('refuses a pixel count that disagrees with the size', () => {
    const bad = { world: 'route10', building: 'stewarts', width: 16, height: 16, pixels: new Uint8Array(8) };
    expect(() => encode(bad)).toThrow(/carries 8/);
  });

  it('refuses an id with a separator in it', () => {
    const bad = { ...drawing(8, 8, () => 1), building: 'stew|arts' };
    expect(() => encode(bad)).toThrow(/not a building id/);
  });
});

describe('where the door and the plaque go', () => {
  it('leaves the columns off a code that does not name them', () => {
    const code = encode(drawing(96, 112, () => TRANSPARENT));
    expect(code.split('|')).toHaveLength(5);
    const after = decode(code);
    expect(after.door).toBeUndefined();
    expect(after.plaque).toBeUndefined();
  });

  it('reads a code from before the columns existed, unchanged', () => {
    // The exact shape of every code already sitting in someone's sent mail.
    const older = 'MSA1|route10|stewarts|16x16|B4AC';
    const after = decode(older);
    expect(after.width).toBe(16);
    expect(after.height).toBe(16);
    expect(after.pixels).toHaveLength(256);
    expect(after.pixels.every((v) => v === 7)).toBe(true);
    expect(after.door).toBeUndefined();
    expect(after.plaque).toBeUndefined();
  });

  it('carries both columns in a sixth part, in a shape a person can read', () => {
    const before = { ...drawing(96, 112, () => TRANSPARENT), door: 2, plaque: 3 };
    const code = encode(before);
    expect(code.endsWith('|door=2,plaque=3')).toBe(true);
    const after = decode(code);
    expect(after.door).toBe(2);
    expect(after.plaque).toBe(3);
    expect(Array.from(after.pixels)).toEqual(Array.from(before.pixels));
  });

  it('carries column 0 rather than mistaking it for nothing to say', () => {
    const code = encode({ ...drawing(96, 112, () => TRANSPARENT), door: 0, plaque: 1 });
    expect(decode(code).door).toBe(0);
  });

  it('takes either column on its own', () => {
    expect(decode(encode({ ...drawing(64, 48, () => 1), door: 1 })).door).toBe(1);
    expect(decode(encode({ ...drawing(64, 48, () => 1), plaque: 2 })).plaque).toBe(2);
    expect(decode(encode({ ...drawing(64, 48, () => 1), door: 1 })).plaque).toBeUndefined();
  });

  it('reads the two keys in either order', () => {
    const code = encode(drawing(64, 48, () => 1));
    expect(decode(`${code}|plaque=3,door=0`).door).toBe(0);
    expect(decode(`${code}|plaque=3,door=0`).plaque).toBe(3);
  });

  it('reads a wrapped code that carries columns', () => {
    const before = { ...drawing(64, 48, (i) => i % 9), door: 1, plaque: 0 };
    const code = encode(before);
    expect(decode(code.replace(/(.{20})/g, '$1\n  ')).door).toBe(1);
  });

  it('refuses a column the building has not got', () => {
    // 64px wide is four tiles: columns 0 to 3.
    expect(() => encode({ ...drawing(64, 48, () => 1), door: 4 })).toThrow(/columns 0 to 3/);
    expect(() => decode(`${encode(drawing(64, 48, () => 1))}|door=9`)).toThrow(/columns 0 to 3/);
  });

  it('refuses to put the door and the plaque in one column', () => {
    expect(() => encode({ ...drawing(64, 48, () => 1), door: 2, plaque: 2 })).toThrow(/one each/);
    expect(() => decode(`${encode(drawing(64, 48, () => 1))}|door=2,plaque=2`)).toThrow(/one each/);
  });

  it('says so kindly when the last part is not something it knows', () => {
    const code = encode(drawing(64, 48, () => 1));
    expect(() => decode(`${code}|window=2`)).toThrow(/door=2,plaque=3/);
    expect(() => decode(`${code}|door=two`)).toThrow(/door=2,plaque=3/);
    expect(() => decode(`${code}|door=1|plaque=2`)).toThrow(/five parts/);
  });
});
