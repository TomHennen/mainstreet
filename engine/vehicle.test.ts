import { describe, expect, it } from 'vitest';
import { Driver, LOOK_AHEAD, STOP_TILES } from './vehicle';
import type { DriveStep } from './vehicle';
import { Mover } from './mover';
import type { Walkable } from './path';
import type { Vec2 } from './schema';

/**
 * The driver is Phaser-free (engine/vehicle.ts), so the whole of giving way —
 * lifting off, coasting to a stop short of whoever is in the road, standing
 * there for as long as they stay, and pulling away again — is testable here
 * under plain Node.
 */

/** `=` paved, anything else not. Row 0 is y=0. */
function paved(rows: string[]): Walkable {
  return (x, y) => rows[y]?.[x] === '=';
}

/** A straight three-lane road twenty tiles long. */
const ROAD = paved(['='.repeat(20), '='.repeat(20), '='.repeat(20)]);

const clear: DriveStep = { blocked: () => false };

/** Runs `seconds` of game time at a given frame rate. */
function run(driver: Driver, seconds: number, step: DriveStep = clear, fps = 60): void {
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(seconds * fps); i++) driver.update(dt, step);
}

/** Somebody standing on exactly one tile. */
const standingAt = (tile: Vec2): DriveStep => ({ blocked: (x, y) => x === tile[0] && y === tile[1] });

const drivingEast = (speed = 6) =>
  new Driver({ path: [[0, 1], [19, 1]], loop: false, speed, pause: 0, drivable: ROAD, facing: 'right' });

describe('Driver', () => {
  it('drives along its path', () => {
    const car = drivingEast();
    run(car, 1);
    expect(car.x).toBeGreaterThan(3);
    expect(car.facing).toBe('right');
    expect(car.stopped).toBe(false);
  });

  it('turns at a corner and faces the way it is travelling', () => {
    const car = new Driver({
      path: [[0, 0], [6, 0], [6, 2]],
      loop: false,
      speed: 6,
      pause: 0,
      drivable: ROAD,
      facing: 'right'
    });
    run(car, 0.7);
    expect(car.facing).toBe('right');
    run(car, 1);
    expect(car.facing).toBe('down');
  });

  it('coasts to a stop for somebody standing in the road ahead', () => {
    const car = drivingEast();
    run(car, 0.6); // under way
    const blocker = standingAt([12, 1]);
    run(car, 4, blocker);
    expect(car.stopped).toBe(true);
    expect(car.yielding).toBe(true);
    // Behind them, never on top of them, and not miles back either.
    expect(car.x).toBeLessThan(12);
    expect(car.x).toBeGreaterThan(12 - LOOK_AHEAD - STOP_TILES);
  });

  it('stays stopped for as long as they stand there', () => {
    const car = drivingEast();
    const blocker = standingAt([12, 1]);
    run(car, 5, blocker);
    const waiting = car.x;
    run(car, 5, blocker);
    expect(car.x).toBeCloseTo(waiting, 5);
  });

  it('pulls away again once the way is clear', () => {
    const car = drivingEast();
    const blocker = standingAt([12, 1]);
    run(car, 5, blocker);
    const waiting = car.x;
    run(car, 1);
    expect(car.x).toBeGreaterThan(waiting + 1);
    expect(car.yielding).toBe(false);
  });

  it('stops within its braking distance however fast it is going', () => {
    for (const speed of [3, 6, 12, 19.125]) {
      const car = drivingEast(speed);
      run(car, 0.4);
      const sawThemAt = car.x;
      run(car, 6, standingAt([15, 1]));
      expect(car.stopped).toBe(true);
      // Never past them, and never more than the braking distance after the
      // point it could first have seen them.
      expect(car.x).toBeLessThan(15);
      expect(car.x - sawThemAt).toBeLessThanOrEqual(15 - sawThemAt + 0.001);
    }
  });

  it('ignores somebody standing beside the road rather than in it', () => {
    const car = drivingEast();
    run(car, 1.5, standingAt([12, 2]));
    expect(car.stopped).toBe(false);
    expect(car.x).toBeGreaterThan(6);
  });

  it('waits rather than driving round whoever is in the way', () => {
    // The road is three lanes wide, so there is a way past; a car does not take it.
    const car = drivingEast();
    run(car, 8, standingAt([12, 1]));
    expect(car.y).toBe(1);
    expect(car.x).toBeLessThan(12);
  });

  it('does not count its pause down while it is stopped', () => {
    const car = new Driver({
      path: [[0, 1], [6, 1], [6, 2]],
      loop: false,
      speed: 6,
      pause: 1,
      drivable: ROAD,
      facing: 'right'
    });
    run(car, 10, standingAt([4, 1]));
    expect(car.stopped).toBe(true);
    expect(car.x).toBeLessThan(4);
  });

  it('already points along its first leg before it sets off', () => {
    const car = new Driver({ path: [[0, 1], [19, 1]], loop: false, speed: 6, pause: 5, drivable: ROAD });
    expect(car.facing).toBe('right');
    const back = new Driver({ path: [[19, 1], [0, 1]], loop: false, speed: 6, pause: 5, drivable: ROAD });
    expect(back.facing).toBe('left');
  });

  it('holds still for ever when it is parked', () => {
    const car = new Driver({ pos: [4, 1], speed: 6, drivable: ROAD, facing: 'left' });
    expect(car.parked).toBe(true);
    expect(car.stopped).toBe(true);
    run(car, 10);
    expect(car.tile()).toEqual([4, 1]);
    expect(car.facing).toBe('left');
  });

  // A scene sending a car somewhere (engine/scene.ts, DESIGN.md §3): the
  // parked pickup that pulls out of the lot and drives off down the road.
  describe('sendTo', () => {
    const parked = () => new Driver({ pos: [2, 1], speed: 6, drivable: ROAD, facing: 'down' });

    it('drives a parked car to where a scene sent it', () => {
      const car = parked();
      expect(car.sendTo([15, 1])).toBe(true);
      expect(car.driving).toBe(true);
      expect(car.parked).toBe(false);
      run(car, 4);
      expect(car.tile()).toEqual([15, 1]);
      expect(car.facing).toBe('right');
      // Arrived: it is a parked car again, and it stays where it was left.
      expect(car.driving).toBe(false);
      expect(car.parked).toBe(true);
      run(car, 5);
      expect(car.tile()).toEqual([15, 1]);
    });

    it('reads as moving rather than stopped while it is on its way', () => {
      const car = parked();
      car.sendTo([15, 1]);
      run(car, 1);
      expect(car.stopped).toBe(false);
      expect(car.x).toBeGreaterThan(4);
    });

    it('waits for somebody in the road rather than driving round them', () => {
      const car = parked();
      car.sendTo([15, 1]);
      run(car, 6, standingAt([9, 1]));
      expect(car.yielding).toBe(true);
      expect(car.y).toBe(1);
      expect(car.x).toBeLessThan(9);
      // And carries on the moment they step off.
      run(car, 3);
      expect(car.tile()).toEqual([15, 1]);
    });

    it('says so when there is no paved way there', () => {
      const car = parked();
      expect(car.sendTo([5, 9])).toBe(false);
      run(car, 3);
      expect(car.tile()).toEqual([2, 1]);
    });

    it('takes a speed of its own for the one trip', () => {
      const slow = parked();
      slow.sendTo([15, 1], 1);
      run(slow, 2);
      expect(slow.x).toBeLessThan(6);
      expect(slow.driving).toBe(true);
    });
  });
});

describe('Mover.ahead', () => {
  const OPEN: Walkable = () => true;

  it('reads the planned leg while there is one', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[5, 0]], pause: 0 } });
    // Give it a frame to plan, then look up the road it is actually on.
    mover.update(2, { held: false, blocked: () => false });
    expect(mover.ahead(2).length).toBe(2);
  });

  it('reads straight on from the facing when there is no leg planned', () => {
    const mover = new Mover({ home: [3, 3], facing: 'up', speed: 4, walkable: OPEN });
    expect(mover.ahead(3)).toEqual([
      [3, 2],
      [3, 1],
      [3, 0]
    ]);
  });
});
