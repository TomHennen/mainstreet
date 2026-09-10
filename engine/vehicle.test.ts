import { describe, expect, it } from 'vitest';
import { Driver, HOLLER_AFTER, LOOK_AHEAD, REAPPEAR_PAUSE, runsOffMap, STOP_TILES, VANISH_TILES } from './vehicle';
import type { DriveStep } from './vehicle';
import { Mover } from './mover';
import type { Walkable } from './path';
import type { Rect, Vec2 } from './schema';

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

// Big enough that ROAD's own tiles (x0-19, y0-2) are never near this edge —
// none of the ordinary driving tests are about the map boundary, so they get
// a bounds nothing on ROAD ever touches, and stay exactly the tests they were.
const FAR_BOUNDS = { width: 200, height: 200 };

const clear: DriveStep = { blocked: () => false };

/** Runs `seconds` of game time at a given frame rate. */
function run(driver: Driver, seconds: number, step: DriveStep = clear, fps = 60): void {
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(seconds * fps); i++) driver.update(dt, step);
}

/** Somebody standing on exactly one tile. */
const standingAt = (tile: Vec2): DriveStep => ({ blocked: (x, y) => x === tile[0] && y === tile[1] });

/** The player, specifically, standing on exactly one tile — `blocked` and `player` both see them there. */
const playerAt = (tile: Vec2): DriveStep => ({
  blocked: (x, y) => x === tile[0] && y === tile[1],
  player: (x, y) => x === tile[0] && y === tile[1]
});

/** Another car (or anything else that isn't the player) blocking one tile — `blocked` sees it, `player` never does. */
const carAheadAt = (tile: Vec2): DriveStep => ({
  blocked: (x, y) => x === tile[0] && y === tile[1],
  player: () => false
});

const drivingEast = (speed = 6) =>
  new Driver({ path: [[0, 1], [19, 1]], loop: false, speed, pause: 0, drivable: ROAD, facing: 'right', bounds: FAR_BOUNDS });

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
      facing: 'right',
      bounds: FAR_BOUNDS
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
      facing: 'right',
      bounds: FAR_BOUNDS
    });
    run(car, 10, standingAt([4, 1]));
    expect(car.stopped).toBe(true);
    expect(car.x).toBeLessThan(4);
  });

  it('already points along its first leg before it sets off', () => {
    const car = new Driver({ path: [[0, 1], [19, 1]], loop: false, speed: 6, pause: 5, drivable: ROAD, bounds: FAR_BOUNDS });
    expect(car.facing).toBe('right');
    const back = new Driver({ path: [[19, 1], [0, 1]], loop: false, speed: 6, pause: 5, drivable: ROAD, bounds: FAR_BOUNDS });
    expect(back.facing).toBe('left');
  });

  it('holds still for ever when it is parked', () => {
    const car = new Driver({ pos: [4, 1], speed: 6, drivable: ROAD, facing: 'left', bounds: FAR_BOUNDS });
    expect(car.parked).toBe(true);
    expect(car.stopped).toBe(true);
    run(car, 10);
    expect(car.tile()).toEqual([4, 1]);
    expect(car.facing).toBe('left');
  });

  // A car that exists only for a scene (DESIGN.md §2/§3, Vehicle.hidden): a
  // deputy's truck waiting out of sight until it is sent somewhere.
  describe('hidden', () => {
    it('is nowhere on the map — not drawn, not in anyone\'s way — until it is sent somewhere', () => {
      const car = new Driver({ pos: [4, 1], speed: 6, drivable: ROAD, facing: 'left', bounds: FAR_BOUNDS, hidden: true });
      expect(car.onMap).toBe(false);
      expect(car.tiles()).toEqual([]);
      run(car, 5);
      expect(car.onMap).toBe(false);

      expect(car.sendTo([15, 1])).toBe(true);
      expect(car.onMap).toBe(true);
      run(car, 4);
      // Arrived, and an ordinary car for good from here on.
      expect(car.onMap).toBe(true);
      expect(car.tiles()).toEqual([[15, 1]]);
    });

    it('stays revealed even when the errand it is first sent on fails', () => {
      const car = new Driver({ pos: [4, 1], speed: 6, drivable: ROAD, facing: 'left', bounds: FAR_BOUNDS, hidden: true });
      expect(car.sendTo([5, 9])).toBe(false);
      expect(car.onMap).toBe(true);
    });

    it('is an ordinary always-visible car with no `hidden` option', () => {
      const car = new Driver({ pos: [4, 1], speed: 6, drivable: ROAD, facing: 'left', bounds: FAR_BOUNDS });
      expect(car.onMap).toBe(true);
    });
  });

  // A scene sending a car somewhere (engine/scene.ts, DESIGN.md §3): the
  // parked pickup that pulls out of the lot and drives off down the road.
  describe('sendTo', () => {
    const parked = () => new Driver({ pos: [2, 1], speed: 6, drivable: ROAD, facing: 'down', bounds: FAR_BOUNDS });

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

  // "This isn't NYC — get out of the road!" A car that the player specifically
  // has held stopped for a moment has something to say about it.
  describe('takeHoller', () => {
    /** Runs a car until it actually comes to a stop, so a test can measure holler timing from that exact moment rather than from whenever blocking began. */
    function runUntilStopped(car: Driver, step: DriveStep, fps = 60): void {
      const dt = 1 / fps;
      for (let i = 0; i < fps * 20 && !car.stopped; i++) car.update(dt, step);
    }

    it('says nothing at all until the player has held it stopped for HOLLER_AFTER seconds', () => {
      const car = drivingEast();
      const blocker = playerAt([3, 1]);
      runUntilStopped(car, blocker);
      expect(car.stopped).toBe(true);
      expect(car.takeHoller()).toBeNull();
      run(car, HOLLER_AFTER - 0.1, blocker);
      expect(car.takeHoller()).toBeNull();
      run(car, 0.2, blocker);
      expect(car.takeHoller()).not.toBeNull();
    });

    it('only hands out one holler for the same stop', () => {
      const car = drivingEast();
      const blocker = playerAt([3, 1]);
      runUntilStopped(car, blocker);
      run(car, HOLLER_AFTER + 0.5, blocker);
      expect(car.takeHoller()).not.toBeNull();
      run(car, 1, blocker); // still the same stop
      expect(car.takeHoller()).toBeNull();
    });

    it('hollers again, with a different index, the next time it is stopped', () => {
      const car = drivingEast();
      const first = playerAt([3, 1]);
      runUntilStopped(car, first);
      run(car, HOLLER_AFTER + 0.5, first);
      const firstIndex = car.takeHoller();
      expect(firstIndex).not.toBeNull();

      run(car, 2); // the way clears, and it drives on
      const second = playerAt([16, 1]);
      runUntilStopped(car, second);
      run(car, HOLLER_AFTER + 0.5, second);
      const secondIndex = car.takeHoller();
      expect(secondIndex).not.toBeNull();
      expect(secondIndex).not.toBe(firstIndex);
    });

    it('never hollers at another car ahead of it, only the player', () => {
      const car = drivingEast();
      const blocker = carAheadAt([3, 1]);
      runUntilStopped(car, blocker);
      expect(car.stopped).toBe(true);
      run(car, HOLLER_AFTER + 1, blocker);
      expect(car.takeHoller()).toBeNull();
    });

    it('never hollers at a player queued up behind another car, only the nearest thing in the way', () => {
      // Two tiles blocked: a car at [10, 1], a player two further on at
      // [12, 1]. The car in front is the *nearer* one, so that's what it is
      // stopped for — the player past it has nobody's attention.
      const queued: DriveStep = {
        blocked: (x, y) => (x === 10 && y === 1) || (x === 12 && y === 1),
        player: (x, y) => x === 12 && y === 1
      };
      const car = drivingEast();
      runUntilStopped(car, queued);
      expect(car.stopped).toBe(true);
      run(car, HOLLER_AFTER + 1, queued);
      expect(car.takeHoller()).toBeNull();
    });

    it('never hollers while it is only slowing, before it has actually stopped', () => {
      // A slow car's own braking ramp takes longer than HOLLER_AFTER to reach
      // a full stop, so held for just over HOLLER_AFTER seconds it is still
      // easing off, never having actually come to rest — nothing to holler
      // about yet even though the clock alone has run out.
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: false,
        speed: 1,
        pause: 0,
        drivable: ROAD,
        facing: 'right',
        bounds: FAR_BOUNDS
      });
      run(car, 0.02); // past the first frame, so its leg is actually planned
      run(car, HOLLER_AFTER + 0.5, playerAt([2, 1]));
      expect(car.stopped).toBe(false);
      expect(car.takeHoller()).toBeNull();
    });
  });

  // Issue: cars doing U-turns outside the village. A route whose last
  // waypoint is where the road runs out — the map's own edge or an `exits`
  // rectangle — drives on past it instead of turning back the way it came
  // (DESIGN.md §2).
  describe('a route that runs off the map', () => {
    const EDGE_BOUNDS = { width: 20, height: 3 };

    it('keeps going off the map at the edge, never turning back', () => {
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: true,
        speed: 6,
        pause: 0.2,
        drivable: ROAD,
        facing: 'right',
        bounds: EDGE_BOUNDS
      });
      let sawPastTheEdge = false;
      let sawItBackAtTheStart = false;
      for (let i = 0; i < Math.round(8 * 60); i++) {
        car.update(1 / 60, clear);
        // A literal U-turn would have to face left again to retrace its own
        // road; a car that keeps going never does.
        expect(car.facing).not.toBe('left');
        if (car.x > 19 + VANISH_TILES - 0.1) sawPastTheEdge = true;
        if (sawPastTheEdge && car.x < 5) sawItBackAtTheStart = true;
      }
      expect(sawPastTheEdge).toBe(true);
      expect(sawItBackAtTheStart).toBe(true);
    });

    it('reports no tiles at all while it is off the map between laps', () => {
      const speed = 6;
      const pause = 0.1;
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: true,
        speed,
        pause,
        drivable: ROAD,
        facing: 'right',
        bounds: EDGE_BOUNDS
      });
      // Arrives, then vanishes over VANISH_TILES more, then sits off the map
      // for REAPPEAR_PAUSE before it's due back — land halfway through that
      // wait, comfortably off the map and reporting nothing for another car
      // to wait on.
      const arrival = pause + 19 / speed;
      const vanished = arrival + VANISH_TILES / speed;
      run(car, vanished + REAPPEAR_PAUSE / 2);
      expect(car.tiles().length).toBe(0);
    });

    it('re-enters driving in from off the map rather than popping into view at the first waypoint', () => {
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: true,
        speed: 6,
        pause: 0.2,
        drivable: ROAD,
        facing: 'right',
        bounds: EDGE_BOUNDS
      });
      const dt = 1 / 60;
      let sawOffMap = false;
      let reappearedAt = -1;
      for (let i = 0; i < Math.round(8 * 60) && reappearedAt < 0; i++) {
        car.update(dt, clear);
        if (car.x < -0.05) sawOffMap = true;
        if (sawOffMap && Math.abs(car.x) < 0.02 && Math.abs(car.y - 1) < 0.02) reappearedAt = car.x;
      }
      // It was genuinely off the map first — not simply placed at [0, 1] —
      // and came back in facing the way its first leg goes.
      expect(sawOffMap).toBe(true);
      expect(reappearedAt).toBeGreaterThanOrEqual(0);
      expect(car.tile()).toEqual([0, 1]);
      expect(car.facing).toBe('right');
      // Already under way again once it's back — `next` past the first
      // waypoint, not sitting through an extra pause on it — so a beat
      // later it has covered real ground.
      const atReappear = car.x;
      run(car, 0.3);
      expect(car.x).toBeGreaterThan(atReappear + 0.5);
    });

    it('holds off the map rather than reappearing on top of the player standing at the first waypoint', () => {
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: true,
        speed: 6,
        pause: 0.2,
        drivable: ROAD,
        facing: 'right',
        bounds: EDGE_BOUNDS
      });
      const blockStart: DriveStep = { blocked: (x, y) => x === 0 && y === 1 };
      // Comfortably past when it would otherwise have reappeared.
      run(car, 8, blockStart);
      expect(car.tiles().length).toBe(0);
      // The player steps off the tile, and it comes straight in — caught at
      // the moment it arrives, before it has had the chance to drive on.
      let arrived = false;
      for (let i = 0; i < 60 * 2 && !arrived; i++) {
        car.update(1 / 60, clear);
        if (car.tiles().length > 0) arrived = true;
      }
      expect(arrived).toBe(true);
      expect(car.tile()).toEqual([0, 1]);
    });

    it('still just parks at the edge when the world pack says loop: false', () => {
      // A route that ends at the boundary on purpose — a one-off scene
      // move, say — is a car legitimately stopping, not a through route, and
      // keeps today's behaviour: it sits right there.
      const car = new Driver({
        path: [[0, 1], [19, 1]],
        loop: false,
        speed: 6,
        pause: 0.2,
        drivable: ROAD,
        facing: 'right',
        bounds: EDGE_BOUNDS
      });
      run(car, 6);
      expect(car.tile()).toEqual([19, 1]);
      run(car, 5);
      expect(car.tile()).toEqual([19, 1]);
    });

    it('keeps looping over its own route when the loop stays inside the map', () => {
      // Route 10's own cars: a rectangle nowhere near any edge, which keeps
      // cycling through the mover's ordinary pathfind-back loop exactly as
      // before — nothing here should ever vanish.
      const path: Vec2[] = [[2, 0], [10, 0], [10, 2], [2, 2]];
      const car = new Driver({
        path,
        loop: true,
        speed: 6,
        pause: 0.1,
        drivable: ROAD,
        facing: 'right',
        bounds: FAR_BOUNDS
      });
      let backAtStart = 0;
      let wasAtStart = true;
      for (let i = 0; i < Math.round(20 * 60); i++) {
        car.update(1 / 60, clear);
        expect(car.x).toBeGreaterThan(1);
        expect(car.x).toBeLessThan(11);
        const atStart = Math.hypot(car.x - 2, car.y - 0) < 0.15;
        if (atStart && !wasAtStart) backAtStart++;
        wasAtStart = atStart;
      }
      expect(backAtStart).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('runsOffMap', () => {
  const BOUNDS = { width: 20, height: 3 };

  it('is true for a route ending on the map\'s own outermost tile', () => {
    expect(runsOffMap([[0, 1], [19, 1]], BOUNDS)).toBe(true);
    expect(runsOffMap([[5, 1], [5, 0]], BOUNDS)).toBe(true);
  });

  it('is true for a route ending inside one of the map\'s own exits, when that exit itself touches the edge', () => {
    const exits: Rect[] = [[8, 0, 1, 3]];
    expect(runsOffMap([[5, 1], [8, 1]], BOUNDS, exits)).toBe(true);
  });

  it('is false for an exit rectangle mid-map — a building\'s own door, say — even if the last waypoint sits inside it', () => {
    const doorway: Rect[] = [[8, 1, 1, 1]];
    expect(runsOffMap([[5, 1], [8, 1]], BOUNDS, doorway)).toBe(false);
  });

  it('is false for a route that ends somewhere ordinary, mid-map', () => {
    expect(runsOffMap([[5, 1], [10, 1]], BOUNDS)).toBe(false);
  });

  it('is false for anything shorter than two waypoints', () => {
    expect(runsOffMap([], BOUNDS)).toBe(false);
    expect(runsOffMap([[0, 1]], BOUNDS)).toBe(false);
    expect(runsOffMap(undefined, BOUNDS)).toBe(false);
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

  // Collision detection on cars wasn't great (issue #...): a car paused at
  // a waypoint, or a short leg away from one, still only looked straight on
  // from its current facing — missing anybody standing right where it was
  // about to turn. `ahead` now reads through to the route's next waypoint
  // instead.
  it('bends towards its next waypoint once paused at one, rather than reading its old facing', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[0, 0], [5, 0], [5, 5]], pause: 1 } });
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 5; i++) {
      mover.update(dt, { held: false, blocked: () => false });
      if (mover.tile()[0] === 5 && mover.tile()[1] === 0 && !mover.busy) break;
    }
    expect(mover.tile()).toEqual([5, 0]);
    expect(mover.busy).toBe(false);
    // Still facing the way it arrived — it's the lookahead that has to bend,
    // not the sprite, until it actually sets off round the corner.
    expect(mover.facing).toBe('right');
    expect(mover.ahead(3)).toEqual([
      [5, 1],
      [5, 2],
      [5, 3]
    ]);
  });

  it('bends towards its next waypoint mid-leg too, once the planned tiles run short', () => {
    const mover = new Mover({ home: [0, 0], speed: 4, walkable: OPEN, route: { path: [[0, 0], [2, 0], [2, 5]], pause: 1 } });
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 5; i++) {
      mover.update(dt, { held: false, blocked: () => false });
      if (mover.tile()[0] === 1 && mover.tile()[1] === 0 && mover.busy) break;
    }
    expect(mover.tile()).toEqual([1, 0]);
    expect(mover.busy).toBe(true);
    expect(mover.ahead(3)).toEqual([
      [2, 0],
      [2, 1],
      [2, 2]
    ]);
  });

  it('carries on through a second turn too, rather than falling back to its old facing once it reaches the first', () => {
    // A real bug: once the bend reached the next waypoint exactly, the
    // padding used to top up with the *old* facing (the way the mover was
    // pointed before the turn) instead of the way the route actually goes
    // from there — here, pointed right on arrival at [5,0], but the route
    // immediately turns down and then left, not right.
    const mover = new Mover({
      home: [0, 0],
      speed: 4,
      walkable: OPEN,
      route: { path: [[0, 0], [5, 0], [5, 1], [0, 1]], pause: 1 }
    });
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 5; i++) {
      mover.update(dt, { held: false, blocked: () => false });
      if (mover.tile()[0] === 5 && mover.tile()[1] === 0 && !mover.busy) break;
    }
    expect(mover.tile()).toEqual([5, 0]);
    expect(mover.busy).toBe(false);
    expect(mover.facing).toBe('right');
    expect(mover.ahead(3)).toEqual([
      [5, 1],
      [4, 1],
      [3, 1]
    ]);
  });
});
