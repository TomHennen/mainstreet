import { describe, expect, it } from 'vitest';
import { DEFAULT_PAUSE, hashId, Mover, rng } from './mover';
import type { MoverStep } from './mover';
import type { Walkable } from './path';
import type { Vec2 } from './schema';

/**
 * The mover is deliberately Phaser-free (engine/mover.ts), so the whole of the
 * walking — the pause at each waypoint, the leg-by-leg step, giving way to
 * somebody in the road — is testable here, under plain Node, at whatever frame
 * rate the test feels like using.
 */

/** `.` walkable, `#` not. Row 0 is y=0. */
function ground(rows: string[]): Walkable {
  return (x, y) => {
    const row = rows[y];
    if (!row) return false;
    return row[x] === '.';
  };
}

const OPEN = ground([
  '..........',
  '..........',
  '..........',
  '..........',
  '..........'
]);

const free: MoverStep = { held: false, blocked: () => false };

/** Runs `seconds` of game time at a given frame rate. */
function run(mover: Mover, seconds: number, step: MoverStep = free, fps = 60): void {
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(seconds * fps); i++) mover.update(dt, step);
}

const at = (mover: Mover): Vec2 => mover.tile();

describe('Mover', () => {
  it('stands still with nowhere to go', () => {
    const mover = new Mover({ home: [2, 2], speed: 4, walkable: OPEN });
    run(mover, 5);
    expect(at(mover)).toEqual([2, 2]);
    expect(mover.moving).toBe(false);
    expect(mover.walks).toBe(false);
  });

  it('waits out its pause before setting off', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[4, 0]] } });
    run(mover, DEFAULT_PAUSE - 0.2);
    expect(at(mover)).toEqual([0, 0]);
    run(mover, 1.2);
    expect(mover.x).toBeGreaterThan(0);
  });

  it('walks a route and comes back round when it loops', () => {
    const mover = new Mover({
      home: [0, 0],
      speed: 2,
      walkable: OPEN,
      route: { path: [[4, 0], [4, 2]], pause: 0.5 }
    });
    // 4 tiles at 2 tiles/s, after half a second standing still.
    run(mover, 2.6);
    expect(at(mover)).toEqual([4, 0]);
    run(mover, 1.6);
    expect(at(mover)).toEqual([4, 2]);
    // Looping is the default: after the last waypoint comes the first again.
    run(mover, 2);
    expect(at(mover)).toEqual([4, 0]);
  });

  it('stops at the last waypoint when the route does not loop', () => {
    const mover = new Mover({
      home: [0, 0],
      speed: 2,
      walkable: OPEN,
      route: { path: [[4, 0], [4, 2]], loop: false, pause: 0.1 }
    });
    run(mover, 6);
    expect(at(mover)).toEqual([4, 2]);
    run(mover, 4);
    expect(at(mover)).toEqual([4, 2]);
  });

  it('faces the way it is walking', () => {
    const mover = new Mover({
      home: [0, 0],
      speed: 2,
      walkable: OPEN,
      route: { path: [[4, 0], [4, 2]], pause: 0.5 }
    });
    run(mover, 1);
    expect(mover.facing).toBe('right');
    // Four tiles east (2s), half a second standing, then south.
    run(mover, 2.5);
    expect(mover.facing).toBe('down');
  });

  it('covers the same ground however fast the frames come', () => {
    const make = () =>
      new Mover({ home: [0, 0], speed: 5, walkable: OPEN, route: { path: [[9, 0]], pause: 0 } });
    const fast = make();
    const slow = make();
    run(fast, 1.2, free, 240);
    run(slow, 1.2, free, 20);
    expect(fast.x).toBeCloseTo(slow.x, 5);
  });

  it('stands exactly still while it is held, and keeps its place in the walk', () => {
    const mover = new Mover({ home: [0, 0], speed: 8, walkable: OPEN, route: { path: [[6, 0]], pause: 0.1 } });
    run(mover, 0.5);
    const paused = mover.x;
    expect(paused).toBeGreaterThan(0);
    run(mover, 2, { held: true, blocked: () => false });
    expect(mover.x).toBe(paused);
    expect(mover.moving).toBe(false);
    run(mover, 1);
    expect(mover.x).toBeGreaterThan(paused);
  });

  it('waits rather than walking into somebody, where there is no way round', () => {
    // One row wide, so the person standing on [2, 0] cannot be gone around.
    const corridor = ground(['.....']);
    const mover = new Mover({ home: [0, 0], speed: 8, walkable: corridor, route: { path: [[4, 0]], pause: 0 } });
    const someone: MoverStep = { held: false, blocked: (x, y) => x === 2 && y === 0 };
    for (let i = 0; i < 300; i++) {
      mover.update(1 / 60, someone);
      expect(mover.tiles().some(([x, y]) => x === 2 && y === 0)).toBe(false);
    }
    expect(at(mover)).toEqual([1, 0]);
    // And once they move on, the walk picks itself back up.
    run(mover, 2);
    expect(at(mover)).toEqual([4, 0]);
  });

  it('goes round somebody who is not moving, rather than waiting for ever', () => {
    // A corridor with a way round: the only through-tile on row 1 is blocked,
    // so the walk should reroute over row 0 or row 2 and still arrive.
    const mover = new Mover({
      home: [0, 1],
      speed: 8,
      walkable: OPEN,
      route: { path: [[4, 1]], pause: 0 }
    });
    const someone: MoverStep = { held: false, blocked: (x, y) => x === 2 && y === 1 };
    run(mover, 6, someone);
    expect(at(mover)).toEqual([4, 1]);
  });

  it('routes round a wall between two waypoints', () => {
    const walls = ground([
      '.....',
      '.###.',
      '.....'
    ]);
    const mover = new Mover({ home: [1, 0], speed: 8, walkable: walls, route: { path: [[1, 2]], pause: 0 } });
    run(mover, 4);
    expect(at(mover)).toEqual([1, 2]);
  });

  it('wanders inside its radius and nowhere else', () => {
    const mover = new Mover({
      home: [5, 2],
      speed: 8,
      walkable: OPEN,
      wander: { radius: 2, pause: 0.1 },
      seed: hashId('someone')
    });
    let moved = false;
    for (let i = 0; i < 400; i++) {
      run(mover, 0.05);
      const [x, y] = at(mover);
      expect(Math.hypot(x - 5, y - 2)).toBeLessThanOrEqual(2);
      if (x !== 5 || y !== 2) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('wanders the same way twice from the same seed', () => {
    const make = () =>
      new Mover({ home: [5, 2], speed: 8, walkable: OPEN, wander: { radius: 2, pause: 0.1 }, seed: 7 });
    const a = make();
    const b = make();
    run(a, 12);
    run(b, 12);
    expect(at(a)).toEqual(at(b));
  });

  it('covers both tiles while it is stepping between them', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[4, 0]], pause: 0 } });
    run(mover, 0.12);
    const tiles = mover.tiles();
    expect(tiles.length).toBe(2);
    expect(tiles[0]).toEqual([0, 0]);
    expect(tiles[1]).toEqual([1, 0]);
  });

  it('turns to look at whoever is talking to it', () => {
    const mover = new Mover({ home: [4, 4], speed: 4, walkable: OPEN });
    mover.faceToward(4.5, 8);
    expect(mover.facing).toBe('down');
    mover.faceToward(0, 4.5);
    expect(mover.facing).toBe('left');
  });
});

describe('rng and hashId', () => {
  it('gives the same stream for the same seed', () => {
    const a = rng(1234);
    const b = rng(1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('spreads ids across a small list', () => {
    const ids = ['stamford-main-walker', 'jefferson-green-walker', 'hobart-main-walker'];
    for (const id of ids) {
      expect(Number.isInteger(hashId(id))).toBe(true);
      expect(hashId(id)).toBe(hashId(id));
    }
  });
});
