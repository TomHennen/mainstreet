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
  stool: 14,
  foosball: 15,
  stage: 10,
  stageFront: 11,
  planter: 12,
  sign: 13,
  firepit: 16,
  door: 17,
  panel: 18
};

const BASE: RoomSpec = {
  name: 'A Room',
  size: [10, 8],
  door: { side: 'bottom', column: 4, width: 2 },
  exit: { id: 'a-room-exit', to: 'somewhere', spawn: [3, 4], facing: 'down' }
};

const room = (spec: Partial<RoomSpec> = {}) => buildRoom({ ...BASE, ...spec }, PALETTE);
/** The topmost tile at a cell: what stands there, or the floor if nothing does. */
const tileAt = (r: ReturnType<typeof room>, x: number, y: number) =>
  r.props[y * r.width + x] ?? r.tiles[y * r.width + x];
const groundAt = (r: ReturnType<typeof room>, x: number, y: number) => r.tiles[y * r.width + x];

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
    expect(() => room({ props: [{ kind: 'table' }] })).toThrow(/needs a "rect", an "at" or an "around"/);
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

describe('buildRoom: an island bar', () => {
  it('draws the loop, leaves the walkway inside it and seals it', () => {
    const r = room({ props: [{ kind: 'island', rect: [3, 2, 4, 4] }] });
    for (const [x, y] of [[3, 2], [6, 2], [3, 5], [6, 5], [4, 2], [5, 5], [3, 3], [6, 4]]) {
      expect(tileAt(r, x, y), `${x},${y}`).toBe(PALETTE.bar);
    }
    // the walkway is floor: somebody has to be able to stand in it
    for (const [x, y] of [[4, 3], [5, 3], [4, 4], [5, 4]]) {
      expect(PALETTE.floor, `${x},${y}`).toContain(tileAt(r, x, y));
    }
  });

  it('opens a way in on the side the spec names, as wide as it says', () => {
    const r = room({ props: [{ kind: 'island', rect: [3, 2, 4, 4], open: 'bottom' }] });
    expect(PALETTE.floor).toContain(tileAt(r, 4, 5));
    expect(tileAt(r, 3, 5)).toBe(PALETTE.bar);
    expect(tileAt(r, 6, 5)).toBe(PALETTE.bar);
    const wide = room({ props: [{ kind: 'island', rect: [3, 2, 4, 4], open: 'top', gap: 2 }] });
    expect(PALETTE.floor).toContain(tileAt(wide, 4, 2));
    expect(PALETTE.floor).toContain(tileAt(wide, 5, 2));
    expect(tileAt(wide, 3, 2)).toBe(PALETTE.bar);
  });

  it('refuses an island with no inside, a way in that cuts a corner, or no rect', () => {
    expect(() => room({ props: [{ kind: 'island', rect: [3, 2, 2, 4] }] })).toThrow(/at least 3×3/);
    expect(() => room({ props: [{ kind: 'island', rect: [3, 2, 4, 4], open: 'top', gap: 3 }] })).toThrow(
      /without cutting a corner/
    );
    expect(() => room({ props: [{ kind: 'island', at: [[3, 3]] }] })).toThrow(/needs a "rect"/);
  });
});

describe('buildRoom: a peninsula bar', () => {
  /** 10x8, so the bottom wall is row 7 and a peninsula against it ends on row 6. */
  const bar = (props: RoomProp[]) => buildRoom({ ...BASE, props }, PALETTE);

  it('draws three sides and lets the room wall close the fourth', () => {
    const r = bar([{ kind: 'peninsula', rect: [1, 3, 3, 4] }]);
    // the three sides that are counter, corners at the wall included
    for (const [x, y] of [[1, 3], [2, 3], [3, 3], [1, 4], [3, 4], [1, 6], [3, 6]]) {
      expect(tileAt(r, x, y), `${x},${y}`).toBe(PALETTE.bar);
    }
    // the end against the wall is not drawn: the wall is already there
    expect(PALETTE.floor).toContain(tileAt(r, 2, 6));
    // and the strip inside is floor all the way to it
    for (const y of [4, 5, 6]) expect(PALETTE.floor, `2,${y}`).toContain(tileAt(r, 2, y));
  });

  it('seals the strip, so somebody posted in it stays in it', () => {
    // buildRoom's own checks would have thrown if the room could be walked
    // into the strip from the door, or if the floor were cut off by the bar.
    expect(() =>
      buildRoom(
        { ...BASE, props: [{ kind: 'peninsula', rect: [1, 3, 3, 4] }], people: [{ id: 'her', pos: [2, 5] }] },
        PALETTE
      )
    ).not.toThrow();
  });

  it('opens a way in on the side the spec names, and hands the middle back', () => {
    const r = bar([{ kind: 'peninsula', rect: [1, 3, 3, 4], open: 'top' }]);
    expect(PALETTE.floor).toContain(tileAt(r, 2, 3));
    expect(tileAt(r, 1, 3)).toBe(PALETTE.bar);
    expect(tileAt(r, 3, 3)).toBe(PALETTE.bar);
  });

  it('refuses one that does not reach a wall, or opens at the end that does', () => {
    expect(() => bar([{ kind: 'peninsula', rect: [1, 2, 3, 3] }])).toThrow(/does not touch the room's wall/);
    expect(() => bar([{ kind: 'peninsula', rect: [1, 3, 3, 4], open: 'bottom' }])).toThrow(
      /the end against the wall/
    );
    expect(() => bar([{ kind: 'peninsula', rect: [1, 4, 2, 3] }])).toThrow(/at least 3×3/);
    expect(() => bar([{ kind: 'peninsula', at: [[3, 3]] }])).toThrow(/needs a "rect"/);
  });

  it('attaches to whichever wall the spec names', () => {
    const left = buildRoom(
      {
        ...BASE,
        size: [12, 10],
        door: { side: 'bottom', column: 6, width: 2 },
        props: [{ kind: 'peninsula', rect: [1, 3, 4, 3], attach: 'left' }]
      },
      PALETTE
    );
    // the left column is the wall's job; the other three sides are counter
    expect(PALETTE.floor).toContain(tileAt(left, 1, 4));
    expect(tileAt(left, 1, 3)).toBe(PALETTE.bar);
    expect(tileAt(left, 4, 4)).toBe(PALETTE.bar);
  });
});

describe('buildRoom: stools around something', () => {
  it('rings whatever is solid, skipping the corners and the way in', () => {
    const r = buildRoom(
      {
        ...BASE,
        size: [14, 10],
        props: [
          { kind: 'island', rect: [4, 3, 4, 4], open: 'bottom' },
          { kind: 'stool', around: 0 }
        ]
      },
      PALETTE
    );
    // along each run of counter
    for (const [x, y] of [[3, 3], [3, 6], [8, 4], [4, 2], [7, 7]]) {
      expect(tileAt(r, x, y), `${x},${y}`).toBe(PALETTE.stool);
    }
    // never on a corner, and never outside the way in
    expect(PALETTE.floor).toContain(tileAt(r, 3, 2));
    expect(PALETTE.floor).toContain(tileAt(r, 5, 7));
  });

  it('takes a rectangle as readily as a prop, and keeps the floor under them', () => {
    const r = room({ props: [{ kind: 'table', at: [[4, 3]] }, { kind: 'stool', around: [4, 3, 1, 1] }] });
    expect(tileAt(r, 3, 3)).toBe(PALETTE.stool);
    expect(tileAt(r, 5, 3)).toBe(PALETTE.stool);
    expect(tileAt(r, 4, 2)).toBe(PALETTE.stool);
    // both are furniture standing on the floor, so the floor is still under them
    expect(PALETTE.floor).toContain(groundAt(r, 3, 3));
    expect(PALETTE.floor).toContain(groundAt(r, 4, 3));
  });

  it('will not go around a prop that has not been placed yet', () => {
    expect(() => room({ props: [{ kind: 'stool', around: 1 }, { kind: 'table', at: [[4, 3]] }] })).toThrow(
      /not one of the props before it/
    );
  });
});

describe('buildRoom: halls, doors, panels and a second way out', () => {
  const long = (props: RoomProp[]) =>
    buildRoom({ ...BASE, size: [14, 10], door: { side: 'bottom', column: 4, width: 2 }, props }, PALETTE);

  it('cuts a corridor with a wall down each long side', () => {
    const r = long([{ kind: 'hall', rect: [8, 4, 5, 2] }]);
    for (let x = 8; x < 13; x++) {
      expect(PALETTE.floor, `${x},4`).toContain(tileAt(r, x, 4));
      expect(tileAt(r, x, 3), `${x},3`).toBe(PALETTE.wall);
      expect(tileAt(r, x, 6), `${x},6`).toBe(PALETTE.wall);
    }
  });

  it('hangs a door and a panel on a wall, and reads them where they stand', () => {
    const r = long([
      { kind: 'hall', rect: [8, 4, 5, 2] },
      { kind: 'door', at: [[10, 6]], lines: ['Out of order, sorry.'] },
      { kind: 'panel', rect: [8, 3, 3, 1], lines: ['A wall people have drawn on.', 'Every hand in town.'] }
    ]);
    expect(tileAt(r, 10, 6)).toBe(PALETTE.door);
    expect(tileAt(r, 9, 3)).toBe(PALETTE.panel);
    expect(r.meta.signs).toEqual([
      { pos: [10, 6], lines: ['Out of order, sorry.'] },
      { pos: [9, 3], lines: ['A wall people have drawn on.', 'Every hand in town.'] }
    ]);
  });

  it('will not hang a door on the floor, or cut a way out where a wall is not yet', () => {
    expect(() => long([{ kind: 'door', at: [[5, 5]] }])).toThrow(/not a wall/);
    // The hall's wall is only there once the hall is: an exit through it has
    // to come after it in the props.
    expect(() =>
      long([
        { kind: 'exit', at: [[10, 3]], id: 'x', to: 'somewhere', spawn: [1, 1], facing: 'up' },
        { kind: 'hall', rect: [8, 4, 5, 2] }
      ])
    ).toThrow(/not a wall/);
  });

  it('caps a hall at one end, for a hallway that dead-ends at a door', () => {
    const r = long([{ kind: 'hall', rect: [2, 1, 4, 1], cap: 'right' }]);
    expect(groundAt(r, 6, 1)).toBe(PALETTE.wall);
    expect(groundAt(r, 1, 1)).not.toBe(PALETTE.wall);
    for (let x = 2; x < 6; x++) expect(groundAt(r, x, 2)).toBe(PALETTE.wall);
    expect(() => long([{ kind: 'hall', rect: [2, 1, 4, 1], cap: 'sideways' as never }])).toThrow(/"cap" is "sideways"/);
    // And the door through the cap, which is the point of it.
    const door = long([
      { kind: 'hall', rect: [2, 1, 4, 1], cap: 'right' },
      { kind: 'exit', at: [[6, 1]], tiles: [PALETTE.floor[1]], id: 'a-room-kitchen', to: 'kitchen', spawn: [1, 4], facing: 'right' }
    ]);
    expect(groundAt(door, 6, 1)).toBe(PALETTE.floor[1]);
    expect(door.meta.exits[1].at).toEqual([6, 1, 1, 1]);
  });

  it("cuts a way out through a hall's own wall — the kitchen door off a hallway", () => {
    const r = long([
      { kind: 'hall', rect: [8, 4, 5, 2] },
      { kind: 'exit', at: [[10, 3]], tiles: [PALETTE.floor[0]], id: 'a-room-kitchen', to: 'kitchen', spawn: [1, 4], facing: 'up' }
    ]);
    expect(tileAt(r, 10, 3)).toBe(PALETTE.floor[0]);
    expect(tileAt(r, 9, 3)).toBe(PALETTE.wall);
    expect(r.meta.exits[1]).toEqual({ id: 'a-room-kitchen', at: [10, 3, 1, 1], to: 'kitchen', spawn: [1, 4], facing: 'up', style: 'door' });
  });

  it('cuts a second way out through the outside wall and states it like the first', () => {
    const r = long([
      { kind: 'hall', rect: [8, 4, 5, 2] },
      { kind: 'exit', rect: [13, 4, 1, 2], id: 'a-room-yard', to: 'yard', spawn: [1, 5], facing: 'right' }
    ]);
    expect(tileAt(r, 13, 4)).toBe(PALETTE.mat);
    expect(r.meta.exits).toHaveLength(2);
    expect(r.meta.exits[0].id).toBe('a-room-exit');
    expect(r.meta.exits[1]).toEqual({
      id: 'a-room-yard',
      at: [13, 4, 1, 2],
      to: 'yard',
      spawn: [1, 5],
      facing: 'right',
      style: 'door'
    });
  });

  it('cuts a way out through the top wall too, floor showing through if the spec says', () => {
    // A doorway in the top wall, clear of the corner, with the floor running
    // through it — the shape Stamford Coffee's 80 Main doorway has, turned up.
    const r = long([{ kind: 'exit', rect: [1, 0, 2, 1], tiles: [PALETTE.floor[0]], id: 'a-room-back', to: 'back', spawn: [3, 6], facing: 'up' }]);
    expect(tileAt(r, 1, 0)).toBe(PALETTE.floor[0]);
    expect(tileAt(r, 2, 0)).toBe(PALETTE.floor[0]);
    expect(tileAt(r, 0, 0)).toBe(PALETTE.wall);
    expect(r.meta.exits[1]).toEqual({ id: 'a-room-back', at: [1, 0, 2, 1], to: 'back', spawn: [3, 6], facing: 'up', style: 'door' });
  });

  it('asks a way out for everything world.json would', () => {
    expect(() => long([{ kind: 'exit', at: [[13, 4]] }])).toThrow(/needs an "id", a "to", a "spawn" and a "facing"/);
  });
});

describe('buildRoom: a plan that is not a rectangle', () => {
  // An L: a 6-wide room with a 3-wide wing off its top-right, walls all
  // round the union and the door in the bottom wall as ever.
  const ell = (spec: Partial<RoomSpec> = {}) =>
    buildRoom(
      {
        ...BASE,
        size: [10, 10],
        plan: [
          [1, 5, 6, 4],
          [6, 1, 3, 4]
        ],
        door: { side: 'bottom', column: 2, width: 2 },
        ...spec
      },
      PALETTE
    );

  it('walls round the union and fills the rest with wall too', () => {
    const r = ell();
    expect(groundAt(r, 3, 6)).not.toBe(PALETTE.wall);
    expect(groundAt(r, 7, 2)).not.toBe(PALETTE.wall);
    // the wing's own walls
    expect(groundAt(r, 5, 2)).toBe(PALETTE.wall);
    expect(groundAt(r, 9, 2)).toBe(PALETTE.wall);
    expect(groundAt(r, 7, 0)).toBe(PALETTE.wall);
    // the mass outside the plan is wall as well
    expect(groundAt(r, 2, 2)).toBe(PALETTE.wall);
    expect(groundAt(r, 4, 4)).toBe(PALETTE.wall);
    expect(r.enter).toEqual([2, 8]);
  });

  it('refuses furniture outside the plan, and a plan that reaches the box edge', () => {
    expect(() => ell({ props: [{ kind: 'table', at: [[2, 2]] }] })).toThrow(/the wall or outside the room/);
    expect(() => ell({ plan: [[0, 5, 6, 4]] })).toThrow(/reaches the edge/);
    expect(() => ell({ door: { side: 'bottom', column: 7, width: 2 } })).toThrow(/no floor inside it/);
  });

  it('reaches the floor in a wing, and notices when it cannot', () => {
    expect(() => ell()).not.toThrow();
    // a shelf across the wing's mouth cuts the wing off
    expect(() => ell({ props: [{ kind: 'shelf', rect: [6, 4, 3, 1] }] })).toThrow(/walled off from the door/);
  });

  it("cuts a way out through a wing's wall, and refuses one with no floor beside it", () => {
    const r = ell({ props: [{ kind: 'exit', at: [[9, 2]], id: 'a-room-side', to: 'side', spawn: [1, 1], facing: 'right' }] });
    expect(r.meta.exits[1].at).toEqual([9, 2, 1, 1]);
    expect(() =>
      ell({ props: [{ kind: 'exit', at: [[2, 2]], id: 'x', to: 'side', spawn: [1, 1], facing: 'up' }] })
    ).toThrow(/no floor beside it/);
  });

  it('makes a passage of a plan cell inside a dividing wall with a mat on it', () => {
    // Two rooms side by side with one plan cell in the wall between them: a
    // mat there (a steel door tile, say) is a doorway, and the far room is
    // reachable through it.
    const r = buildRoom(
      {
        ...BASE,
        size: [12, 8],
        plan: [
          [1, 1, 4, 6],
          [5, 3, 1, 1],
          [6, 1, 5, 6]
        ],
        door: { side: 'bottom', column: 2, width: 2 },
        props: [{ kind: 'mat', at: [[5, 3]], tiles: [PALETTE.floor[1]] }]
      },
      PALETTE
    );
    expect(groundAt(r, 5, 3)).toBe(PALETTE.floor[1]);
    expect(groundAt(r, 5, 2)).toBe(PALETTE.wall);
    expect(groundAt(r, 5, 4)).toBe(PALETTE.wall);
    expect(() =>
      buildRoom(
        {
          ...BASE,
          size: [12, 8],
          plan: [
            [1, 1, 4, 6],
            [6, 1, 5, 6]
          ],
          door: { side: 'bottom', column: 2, width: 2 }
        },
        PALETTE
      )
    ).toThrow(/walled off from the door/);
  });
});

describe('buildRoom: people and fixtures', () => {
  it('passes them through to the stanza', () => {
    const r = room({
      people: [{ id: 'barman', pos: [3, 3], lines: ['Evening.'] }],
      fixtures: [{ kind: 'woodpile', pos: [6, 4] }]
    });
    expect(r.meta.people).toEqual([{ id: 'barman', pos: [3, 3], lines: ['Evening.'] }]);
    expect(r.meta.fixtures).toEqual([{ kind: 'woodpile', pos: [6, 4] }]);
  });

  it('will not stand somebody in the furniture', () => {
    expect(() =>
      room({ props: [{ kind: 'table', at: [[3, 3]] }], people: [{ id: 'barman', pos: [3, 3] }] })
    ).toThrow(/where nobody can stand/);
    expect(() =>
      room({ props: [{ kind: 'table', at: [[3, 3]] }], fixtures: [{ kind: 'woodpile', pos: [3, 3] }] })
    ).toThrow(/in the wall, the furniture/);
  });
});

describe('tiledMap', () => {
  it('keeps furniture that stands on the floor on a layer of its own', () => {
    const file = JSON.parse(tiledMap(room({ props: [{ kind: 'table', at: [[3, 3]] }] }), 'tiles.json'));
    expect(file.layers.map((layer: { name: string }) => layer.name)).toEqual(['ground', 'props']);
    expect(file.nextlayerid).toBe(3);
    const [ground, props] = file.layers;
    expect(props.data[3 * 10 + 3]).toBe(PALETTE.table + 1);
    expect(ground.data[3 * 10 + 3]).not.toBe(PALETTE.table + 1);
    // a room with nothing standing on its floor is the one-layer file it was
    const plain = JSON.parse(tiledMap(room({ props: [{ kind: 'shelf', rect: [1, 1, 2, 1] }] }), 'tiles.json'));
    expect(plain.layers).toHaveLength(1);
    expect(plain.nextlayerid).toBe(2);
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

  for (const id of [
    'stamford-coffee-interior',
    'eighty-main-interior',
    'the-belvedere-interior',
    'the-belvedere-yard'
  ]) {
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
      // A room's cast (DESIGN.md §2) may be hand-placed straight into
      // world.json instead of declared in the spec, so `people` is the one
      // field the stanza is allowed to carry that the spec need not — and
      // where the spec does declare it, it has to come through unchanged.
      const { people: shipped, ...generated } = world.maps[id];
      const { people: declared, ...expected } = built.meta;
      expect(generated).toEqual(expected);
      if (spec.people) expect(shipped).toEqual(declared);
      // A room behind a building's door is checked against that placement. A
      // room behind another room's door — the Belvedere's yard — has none, and
      // is checked against the exit that leads to it instead.
      const placement = world.maps[spec.exit.to].buildings?.find((b: { interior?: string }) => b.interior === id);
      if (placement) {
        expect(placement.enter).toEqual(built.enter);
        expect(built.meta.exits[0].spawn).toEqual(placement.door);
      } else {
        const there = world.maps[spec.exit.to].exits.find((e: { to: string }) => e.to === id);
        const back = built.meta.exits[0];
        // in through their door onto our own doorstep, and back out onto a
        // tile of the corridor their door is cut through
        expect(there.spawn).toEqual(built.enter);
        expect(back.to).toBe(spec.exit.to);
        const [ax, ay, aw, ah] = there.at;
        expect(Math.abs(back.spawn[0] - ax) + Math.abs(back.spawn[1] - ay)).toBeLessThanOrEqual(aw + ah);
      }
    });
  }
});
