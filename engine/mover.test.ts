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

  it('waits where it is once somebody has set off to talk to it', () => {
    const mover = new Mover({ home: [0, 0], speed: 8, walkable: OPEN, route: { path: [[9, 0]], pause: 0.1 } });
    run(mover, 0.5);
    const hailedAt = mover.x;
    expect(hailedAt).toBeGreaterThan(0);

    // Somebody taps them and starts walking over: they stand and wait, however
    // long the trip takes, so arriving is never arriving where they *were*.
    mover.hail();
    expect(mover.hailed).toBe(true);
    run(mover, 4);
    expect(mover.x).toBe(hailedAt);
    expect(mover.moving).toBe(false);

    // And once the conversation is over, they carry on from where they stopped.
    mover.release();
    expect(mover.hailed).toBe(false);
    run(mover, 0.5);
    expect(mover.x).toBeGreaterThan(hailedAt);
  });

  it('holds a hailed person even before the player is within reach', () => {
    // `held` is the player standing right there; the hail is the walk over.
    const mover = new Mover({ home: [0, 0], speed: 8, walkable: OPEN, route: { path: [[9, 0]], pause: 0 } });
    mover.hail();
    run(mover, 3, { held: false, blocked: () => false });
    expect(mover.tile()).toEqual([0, 0]);
    expect(mover.x).toBe(0);
  });

  it('a hail does not cost them their pause, or their place in the route', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[4, 0], [4, 2]], pause: 0.5 } });
    run(mover, 1.6);
    expect(mover.tile()).toEqual([4, 0]);
    mover.hail();
    run(mover, 5);
    expect(mover.tile()).toEqual([4, 0]);
    mover.release();
    run(mover, 1.4);
    expect(mover.tile()).toEqual([4, 2]);
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

/**
 * An errand is where a scene sends somebody (DESIGN.md §3). It overrides
 * whatever the world pack had them doing, it is not held by the player
 * standing close by — a scene's walk happens on cue — and it hands the person
 * back to their own route when it is done.
 */
describe('sendTo', () => {
  const BLOCKED = ground([
    '..........',
    '..........',
    '..#####...',
    '..........',
    '..........'
  ]);

  it('walks somebody with no route at all to a tile', () => {
    const mover = new Mover({ home: [1, 1], speed: 4, walkable: OPEN });
    expect(mover.walks).toBe(false);
    expect(mover.sendTo([5, 1])).toBe(true);
    expect(mover.onErrand).toBe(true);
    run(mover, 2);
    expect(at(mover)).toEqual([5, 1]);
    expect(mover.onErrand).toBe(false);
  });

  it('keeps walking with the player standing right there', () => {
    const mover = new Mover({ home: [1, 1], speed: 4, walkable: OPEN });
    mover.sendTo([5, 1]);
    run(mover, 2, { held: true, blocked: () => false });
    expect(at(mover)).toEqual([5, 1]);
  });

  it('goes round the long way rather than through a wall', () => {
    const mover = new Mover({ home: [4, 1], speed: 6, walkable: BLOCKED });
    expect(mover.sendTo([4, 4])).toBe(true);
    run(mover, 4);
    expect(at(mover)).toEqual([4, 4]);
  });

  it('says so when there is no way through', () => {
    const island = ground(['..#..', '..#..', '..#..']);
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: island });
    expect(mover.sendTo([4, 0])).toBe(false);
    expect(mover.onErrand).toBe(false);
  });

  it('is already there when it is sent where it stands', () => {
    const mover = new Mover({ home: [2, 2], speed: 4, walkable: OPEN });
    expect(mover.sendTo([2, 2])).toBe(true);
    expect(mover.busy).toBe(false);
    expect(mover.onErrand).toBe(false);
  });

  it('takes the pace the scene asked for', () => {
    const slow = new Mover({ home: [0, 0], speed: 8, walkable: OPEN });
    slow.sendTo([8, 0], 2);
    run(slow, 1);
    // Two tiles a second, not eight: two seconds' walking is still to come.
    expect(slow.x).toBeGreaterThan(1.5);
    expect(slow.x).toBeLessThan(2.5);
  });

  /**
   * A scene's instruction outranks a hail: the player tapping somebody who is
   * crossing the room on cue must not stop the scene half way through it. The
   * hail is not lost, though — it is waiting for them at the far end.
   */
  it('carries on with an errand even when somebody has hailed it', () => {
    const mover = new Mover({ home: [1, 1], speed: 4, walkable: OPEN });
    mover.sendTo([5, 1]);
    mover.hail();
    run(mover, 2);
    expect(at(mover)).toEqual([5, 1]);
    expect(mover.onErrand).toBe(false);
    // And now they stand there, because somebody is still on their way over.
    expect(mover.hailed).toBe(true);
    run(mover, 3);
    expect(at(mover)).toEqual([5, 1]);
  });

  it('takes an errand over a hail that came first', () => {
    const mover = new Mover({
      home: [1, 1],
      speed: 4,
      walkable: OPEN,
      route: { path: [[1, 4], [1, 1]], pause: 0.2 }
    });
    mover.hail();
    run(mover, 1);
    expect(at(mover)).toEqual([1, 1]);
    // The scene takes charge, and the hail goes with the walk it belonged to.
    expect(mover.sendTo([5, 1])).toBe(true);
    expect(mover.hailed).toBe(false);
    run(mover, 1.2);
    expect(at(mover)).toEqual([5, 1]);
  });

  it('picks its own route back up once the errand is over', () => {
    const mover = new Mover({
      home: [0, 0],
      speed: 6,
      walkable: OPEN,
      route: { path: [[0, 4], [0, 0]], pause: 2 }
    });
    mover.sendTo([6, 2]);
    run(mover, 1.5);
    expect(at(mover)).toEqual([6, 2]);
    expect(mover.onErrand).toBe(false);
    run(mover, 4);
    // Back on the route: somewhere on the way to a waypoint, not stood still.
    expect(at(mover)).not.toEqual([6, 2]);
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
