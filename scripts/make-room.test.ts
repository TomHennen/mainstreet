/**
 * `buildRoom` — the spec → grid half of `scripts/make-room.ts`. No Tiled
 * files, no world pack: a made-up palette of tile ids goes in, a grid comes
 * out, and every rule the script promises an author is checked here.
 *
 * The two rooms route10 actually ships are read off disk at the bottom, so a
 * change to the spec format that would quietly redraw Stamford Coffee or the
 * Belvedere fails here rather than in a playtest screenshot.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRoom, paletteOf, RoomError, tiledMap } from './make-room.ts';
import type { RoomPalette, RoomProp, RoomSpec } from './make-room.ts';
import { parseTileset } from '../engine/tiled.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..', 'worlds', 'route10');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** Ids chosen to be obvious in a printed grid; none of them mean anything. */
const PALETTE: RoomPalette = {
  wall: 1,
  floor: [2, 3],
  mat: 4,
  counter: 5,
  bar: 6,
  shelf: [7, 8],
  table: 9,
  stage: 10,
  stageFront: 11,
  planter: 12,
  sign: 13
};

const BASE: RoomSpec = {
  name: 'A Room',
  size: [10, 8],
  door: { side: 'bottom', column: 4, width: 2 },
  exit: { id: 'a-room-exit', to: 'somewhere', spawn: [3, 4], facing: 'down' }
};

const room = (spec: Partial<RoomSpec> = {}) => buildRoom({ ...BASE, ...spec }, PALETTE);
const tileAt = (r: ReturnType<typeof room>, x: number, y: number) => r.tiles[y * r.width + x];

describe('buildRoom: the shell', () => {
  it('rings the room in wall and fills the rest with floor', () => {
    const r = room();
    expect(r.width).toBe(10);
    expect(r.height).toBe(8);
    for (let x = 0; x < 10; x++) expect(tileAt(r, x, 0)).toBe(PALETTE.wall);
    for (let y = 0; y < 8; y++) {
      expect(tileAt(r, 0, y)).toBe(PALETTE.wall);
      expect(tileAt(r, 9, y)).toBe(PALETTE.wall);
    }
    for (let y = 1; y < 7; y++) {
      for (let x = 1; x < 9; x++) expect(PALETTE.floor).toContain(tileAt(r, x, y));
    }
  });

  it('mats the doorway, spawns just inside it and triggers the exit over it', () => {
    const r = room();
    expect(tileAt(r, 4, 7)).toBe(PALETTE.mat);
    expect(tileAt(r, 5, 7)).toBe(PALETTE.mat);
    expect(tileAt(r, 3, 7)).toBe(PALETTE.wall);
    expect(r.enter).toEqual([4, 6]);
    expect(r.meta.exits[0]).toEqual({
      id: 'a-room-exit',
      at: [4, 7, 2, 1],
      to: 'somewhere',
      spawn: [3, 4],
      facing: 'down',
      style: 'door'
    });
    expect(r.meta.kind).toBe('interior');
    expect(r.meta.name).toBe('A Room');
  });

  it('puts the door in whichever wall the spec names', () => {
    expect(room({ door: { side: 'top', column: 4, width: 2 } }).enter).toEqual([4, 1]);
    expect(room({ door: { side: 'left', column: 3, width: 1 } }).enter).toEqual([1, 3]);
    expect(room({ door: { side: 'right', column: 3, width: 1 } }).enter).toEqual([8, 3]);
    expect(room({ door: { side: 'left', column: 3, width: 2 } }).meta.exits[0].at).toEqual([0, 3, 1, 2]);
  });

  it('draws the same room every time', () => {
    expect(room().tiles).toEqual(room().tiles);
  });

  it('refuses a room too small to stand up in, or a door through a corner', () => {
    expect(() => room({ size: [4, 8] })).toThrow(RoomError);
    expect(() => room({ door: { side: 'bottom', column: 0, width: 2 } })).toThrow(/cut the corner/);
    expect(() => room({ door: { side: 'bottom', column: 8, width: 2 } })).toThrow(/cut the corner/);
  });
});

describe('buildRoom: props', () => {
  it('places a rect and a list of tiles, cycling the tiles it was given', () => {
    const r = room({
      props: [
        { kind: 'shelf', rect: [1, 1, 3, 1] },
        { kind: 'table', at: [[6, 3], [7, 5]] }
      ]
    });
    expect([tileAt(r, 1, 1), tileAt(r, 2, 1), tileAt(r, 3, 1)]).toEqual([7, 8, 7]);
    expect(tileAt(r, 6, 3)).toBe(PALETTE.table);
    expect(tileAt(r, 7, 5)).toBe(PALETTE.table);
  });

  it('lets a prop name its own tiles', () => {
    const r = room({ props: [{ kind: 'shelf', rect: [1, 1, 2, 1], tiles: [42] }] });
    expect([tileAt(r, 1, 1), tileAt(r, 2, 1)]).toEqual([42, 42]);
  });

  it('seals the strip behind a counter so whoever works there stays there', () => {
    const r = room({ props: [{ kind: 'counter', rect: [2, 2, 5, 1], behind: 'top' }] });
    for (let x = 2; x <= 6; x++) expect(tileAt(r, x, 2)).toBe(PALETTE.counter);
    // the returns at either end of the strip
    expect(tileAt(r, 1, 1)).toBe(PALETTE.counter);
    expect(tileAt(r, 7, 1)).toBe(PALETTE.counter);
    // the strip itself stays floor: somebody has to be able to stand in it
    for (let x = 2; x <= 6; x++) expect(PALETTE.floor).toContain(tileAt(r, x, 1));
  });

  it('seals a bar running down a side wall too', () => {
    const r = room({ props: [{ kind: 'bar', rect: [2, 2, 1, 4], behind: 'left' }] });
    for (let y = 2; y <= 5; y++) expect(tileAt(r, 2, y)).toBe(PALETTE.bar);
    expect(tileAt(r, 1, 1)).toBe(PALETTE.bar);
    expect(tileAt(r, 1, 6)).toBe(PALETTE.bar);
  });

  it('will not put a counter where the staff would stand in the wall', () => {
    expect(() => room({ props: [{ kind: 'counter', rect: [2, 1, 5, 1], behind: 'top' }] })).toThrow(
      /staff strip behind it/
    );
  });

  it('gives a stage a front face on its near row only', () => {
    const r = room({ props: [{ kind: 'stage', rect: [5, 1, 3, 3] }] });
    for (let x = 5; x <= 7; x++) {
      expect(tileAt(r, x, 1)).toBe(PALETTE.stage);
      expect(tileAt(r, x, 2)).toBe(PALETTE.stage);
      expect(tileAt(r, x, 3)).toBe(PALETTE.stageFront);
    }
    const sideways = room({ props: [{ kind: 'stage', rect: [5, 1, 3, 3], front: 'left' }] });
    expect(tileAt(sideways, 5, 2)).toBe(PALETTE.stageFront);
    expect(tileAt(sideways, 6, 2)).toBe(PALETTE.stage);
  });

  it('lets a later prop paint over an earlier one', () => {
    const r = room({
      props: [
        { kind: 'counter', rect: [2, 2, 5, 1], behind: 'top' },
        { kind: 'shelf', rect: [5, 2, 2, 1], tiles: [42] }
      ]
    });
    expect(tileAt(r, 4, 2)).toBe(PALETTE.counter);
    expect(tileAt(r, 5, 2)).toBe(42);
    // and the seal the counter drew is still there
    expect(tileAt(r, 7, 1)).toBe(PALETTE.counter);
  });

  it('keeps furniture out of the wall and out of the doorway', () => {
    expect(() => room({ props: [{ kind: 'table', at: [[0, 3]] }] })).toThrow(/the wall or outside the room/);
    expect(() => room({ props: [{ kind: 'table', at: [[4, 7]] }] })).toThrow(/the wall or outside the room/);
    expect(() => room({ props: [{ kind: 'table', at: [[4, 6]] }] })).toThrow(/spawn tile/);
  });

  it('rejects a prop with nowhere to go, and an unknown kind', () => {
    expect(() => room({ props: [{ kind: 'table' }] })).toThrow(/needs a "rect" or an "at"/);
    expect(() => room({ props: [{ kind: 'wardrobe', at: [[3, 3]] } as unknown as RoomProp] })).toThrow(/unknown kind/);
  });

  it('will not wall a corner of the room off from the door', () => {
    expect(() =>
      room({
        props: [
          { kind: 'shelf', rect: [1, 3, 3, 1] },
          { kind: 'shelf', rect: [3, 1, 1, 2] }
        ]
      })
    ).toThrow(/walled off from the door/);
  });

  it("says which tile the world's tileset is missing rather than inventing one", () => {
    const bare = { ...PALETTE, table: -1 };
    expect(() => buildRoom({ ...BASE, props: [{ kind: 'table', at: [[3, 3]] }] }, bare)).toThrow(
      /no "table" tile/
    );
  });
});

describe('paletteOf', () => {
  it('finds route10 furniture by tile kind, and the raised near row by its front face', () => {
    const tileset = parseTileset(readJson(join(PACK, 'assets', 'tiles', 'route10.json')), 'route10');
    const palette = paletteOf(tileset);
    for (const [kind, id] of Object.entries(palette)) {
      const ids = Array.isArray(id) ? id : [id];
      for (const one of ids) expect(tileset.tiles.has(one), `${kind} -> ${one}`).toBe(true);
    }
    expect(tileset.tiles.get(palette.stage)?.edge).toBeUndefined();
    expect(tileset.tiles.get(palette.stageFront)?.edge).toBeTruthy();
    expect(tileset.tiles.get(palette.wall)?.solid).toBe(true);
    expect(tileset.tiles.get(palette.mat)?.solid).toBe(false);
  });
});

describe('the rooms route10 ships', () => {
  const tileset = () => parseTileset(readJson(join(PACK, 'assets', 'tiles', 'route10.json')), 'route10');

  for (const id of ['stamford-coffee-interior', 'the-belvedere-interior']) {
    it(`${id} on disk is what its spec builds`, () => {
      const spec: RoomSpec = readJson(join(PACK, 'rooms', `${id}.json`));
      const built = buildRoom(spec, paletteOf(tileset()));
      expect(tiledMap(built, '../assets/tiles/route10.json')).toBe(
        readFileSync(join(PACK, 'maps', `${id}.json`), 'utf8')
      );
    });

    it(`${id} matches its world.json stanza`, () => {
      const world = readJson(join(PACK, 'world.json'));
      const spec: RoomSpec = readJson(join(PACK, 'rooms', `${id}.json`));
      const built = buildRoom(spec, paletteOf(tileset()));
      expect(world.maps[id]).toEqual(built.meta);
      const placement = world.maps[spec.exit.to].buildings.find((b: { interior?: string }) => b.interior === id);
      expect(placement.enter).toEqual(built.enter);
      expect(built.meta.exits[0].spawn).toEqual(placement.door);
    });
  }
});
