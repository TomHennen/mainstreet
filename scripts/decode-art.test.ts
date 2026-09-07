import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '../studio/codec.ts';
import { decodePng } from './png.ts';
import { decodeArt, extractCode, IntakeError } from './decode-art.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_WORLDS_DIR = join(HERE, '..', 'worlds');

// mac-a-doodles (Stamford): footprint [4, 3] tiles -> 64px wide, 48px minimum tall.
const BUILDING = 'mac-a-doodles';
const WIDTH = 64;
const HEIGHT = 48;

function solidPixels(width: number, height: number, index: number): Uint8Array {
  return new Uint8Array(width * height).fill(index);
}

function readWorld(worldsDir: string): any {
  return JSON.parse(readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8'));
}

/** Every placement of a building, across every map in the pack. */
function placementsOf(worldsDir: string, id: string): any[] {
  return Object.values(readWorld(worldsDir).maps).flatMap((map: any) =>
    map.buildings.filter((b: any) => b.id === id)
  );
}

/**
 * Makes one tile solid in a scratch map, so the "that door has nowhere to
 * stand" refusal can be exercised. Route 10's buildings all have walkable
 * ground along their whole front, which is exactly as it should be.
 */
function makeSolid(worldsDir: string, mapId: string, x: number, y: number): void {
  const mapFile = join(worldsDir, 'route10', 'maps', `${mapId}.json`);
  const tiled = JSON.parse(readFileSync(mapFile, 'utf8'));
  let gid: number | null = null;
  for (const ref of tiled.tilesets) {
    const tileset = JSON.parse(readFileSync(resolve(dirname(mapFile), ref.source), 'utf8'));
    const solid = (tileset.tiles ?? []).find((tile: any) =>
      tile.properties?.some((p: any) => p.name === 'solid' && p.value === true)
    );
    if (solid) {
      gid = ref.firstgid + solid.id;
      break;
    }
  }
  if (gid === null) throw new Error('no solid tile in this world to test with');
  const layer = tiled.layers.find((l: any) => l.type === 'tilelayer');
  layer.data[y * tiled.width + x] = gid;
  writeFileSync(mapFile, JSON.stringify(tiled));
}

describe('decodeArt', () => {
  let scratchRoot: string;
  let worldsDir: string;

  beforeEach(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'mainstreet-decode-art-'));
    worldsDir = join(scratchRoot, 'worlds');
    cpSync(REAL_WORLDS_DIR, worldsDir, { recursive: true });
    // Start from an unpainted world so the tests do not depend on which
    // buildings have been painted for real.
    for (const world of readdirSync(worldsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      rmSync(join(worldsDir, world, 'credits.json'), { force: true });
      const buildings = join(worldsDir, world, 'assets', 'buildings');
      if (existsSync(buildings)) {
        for (const f of readdirSync(buildings)) if (f.endsWith('.png')) rmSync(join(buildings, f));
      }
    }
  });

  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it('decodes a valid drawing into a PNG and a credit, and passes validate-assets', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    pixels[0] = 0; // one opaque pixel, palette index 0
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });

    const result = decodeArt({ code, credit: 'Jordan R.', worldsDir });

    expect(existsSync(result.pngPath)).toBe(true);
    const png = decodePng(readFileSync(result.pngPath));
    expect(png.width).toBe(WIDTH);
    expect(png.height).toBe(HEIGHT);

    const palette = decodePng(readFileSync(join(worldsDir, 'route10', 'palette.png')));
    expect(Array.from(png.rgba.subarray(0, 4))).toEqual(Array.from(palette.rgba.subarray(0, 3)).concat(255));
    expect(png.rgba[7]).toBe(0); // pixel 1 stayed transparent (alpha 0)

    const credits = JSON.parse(readFileSync(result.creditsPath, 'utf8'));
    expect(credits.buildings[BUILDING]).toBe('Jordan R.');
    expect(result.validateOutput).toMatch(/✓ route10/);

    // git status must never see PNGs/credits.json land under the real worlds/
    // dir from a test — this asserts the write went to the scratch copy.
    expect(result.pngPath.startsWith(worldsDir)).toBe(true);
    expect(result.pngPath.startsWith(REAL_WORLDS_DIR)).toBe(false);
  });

  it('keeps credits.json keys sorted and merges with an existing entry', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });
    decodeArt({ code, credit: 'Zed', worldsDir });

    const stewartsPixels = solidPixels(96, 64, 255);
    const stewartsCode = encode({ world: 'route10', building: 'stewarts', width: 96, height: 64, pixels: stewartsPixels });
    const result = decodeArt({ code: stewartsCode, credit: 'Ann', worldsDir });

    const credits = JSON.parse(readFileSync(result.creditsPath, 'utf8'));
    expect(Object.keys(credits.buildings)).toEqual(['mac-a-doodles', 'stewarts']);
  });

  it('pulls the code out of an emailed body', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });
    const emailBody = `Hi!\n\nHere's my painting, hope you like it:\n\n${code}\n\nThanks,\nSam`;
    expect(extractCode(emailBody)).toBe(code);

    const result = decodeArt({ code: extractCode(emailBody), credit: 'Sam', worldsDir });
    expect(existsSync(result.pngPath)).toBe(true);
  });

  it('rejects a drawing with the wrong size', () => {
    const pixels = solidPixels(32, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: 32, height: HEIGHT, pixels });
    expect(() => decodeArt({ code, credit: 'X', worldsDir })).toThrow(IntakeError);
    expect(() => decodeArt({ code, credit: 'X', worldsDir })).toThrow(/64px wide/);
  });

  it('rejects an unknown building', () => {
    const pixels = solidPixels(16, 16, 255);
    const code = encode({ world: 'route10', building: 'no-such-building', width: 16, height: 16, pixels });
    expect(() => decodeArt({ code, credit: 'X', worldsDir })).toThrow(/doesn't have a building/);
  });

  it('leaves world.json alone, to the byte, when the code says nothing about the door', () => {
    const before = readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8');
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });

    const result = decodeArt({ code, credit: 'Jordan R.', worldsDir });

    expect(result.worldPath).toBeNull();
    expect(result.columns).toBeNull();
    expect(readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8')).toBe(before);
  });

  it('writes the door and the plaque a code carries into every placement of that building', () => {
    const [was] = placementsOf(worldsDir, BUILDING);
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels, door: 0, plaque: 3 });

    const result = decodeArt({ code, credit: 'Jordan R.', worldsDir });

    expect(result.worldPath).toBe(join(worldsDir, 'route10', 'world.json'));
    expect(result.columns).toEqual({ door: 0, plaque: 3 });
    const front = was.pos[1] + was.size[1];
    for (const placement of placementsOf(worldsDir, BUILDING)) {
      expect(placement.door).toEqual([placement.pos[0] + 0, front]);
      expect(placement.plaque).toEqual([placement.pos[0] + 3, front]);
    }
    expect(result.validateOutput).toMatch(/✓ route10/);
  });

  it('keeps world.json pretty-printed exactly the way it found it', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels, door: 0, plaque: 1 });
    decodeArt({ code, credit: 'Jordan R.', worldsDir });

    const text = readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8');
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  });

  it('takes the columns from --door and --plaque for a drawing that named them in the email', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });

    const result = decodeArt({ code, credit: 'Sam', worldsDir, door: 2, plaque: 1 });

    expect(result.columns).toEqual({ door: 2, plaque: 1 });
    for (const placement of placementsOf(worldsDir, BUILDING)) {
      expect(placement.door[0]).toBe(placement.pos[0] + 2);
      expect(placement.plaque[0]).toBe(placement.pos[0] + 1);
    }
  });

  it('asks rather than guesses when the code and the flags disagree', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels, door: 1, plaque: 2 });
    expect(() => decodeArt({ code, credit: 'Sam', worldsDir, door: 3 })).toThrow(/which one they meant/);
  });

  it('refuses a column the building has not got', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });
    // mac-a-doodles is four tiles across: columns 0 to 3.
    expect(() => decodeArt({ code, credit: 'Sam', worldsDir, door: 7 })).toThrow(/columns 0 to 3/);
  });

  it('refuses a door with nowhere to stand, and writes nothing at all', () => {
    const [placement] = placementsOf(worldsDir, BUILDING);
    makeSolid(worldsDir, 'stamford', placement.pos[0], placement.pos[1] + placement.size[1]);
    const before = readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8');

    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels, door: 0, plaque: 1 });

    expect(() => decodeArt({ code, credit: 'Sam', worldsDir })).toThrow(IntakeError);
    expect(() => decodeArt({ code, credit: 'Sam', worldsDir })).toThrow(/door on a solid tile/);
    expect(readFileSync(join(worldsDir, 'route10', 'world.json'), 'utf8')).toBe(before);
    expect(existsSync(join(worldsDir, 'route10', 'assets', 'buildings', `${BUILDING}.png`))).toBe(false);
    expect(existsSync(join(worldsDir, 'route10', 'credits.json'))).toBe(false);
  });

  it('refuses to overwrite an existing PNG without --force, but allows it with --force', () => {
    const pixels = solidPixels(WIDTH, HEIGHT, 255);
    const code = encode({ world: 'route10', building: BUILDING, width: WIDTH, height: HEIGHT, pixels });
    decodeArt({ code, credit: 'First', worldsDir });

    expect(() => decodeArt({ code, credit: 'Second', worldsDir })).toThrow(/already exists/);

    const result = decodeArt({ code, credit: 'Second', worldsDir, force: true });
    const credits = JSON.parse(readFileSync(result.creditsPath, 'utf8'));
    expect(credits.buildings[BUILDING]).toBe('Second');
  });
});
