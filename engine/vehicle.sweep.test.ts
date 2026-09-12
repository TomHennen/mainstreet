import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Driver, LOOK_AHEAD, STOP_TILES } from './vehicle';
import type { DriveStep } from './vehicle';
import { VEHICLE_L, VEHICLE_W } from './motor';
import { TILE } from './tiled';
import { footprintTiles } from './footprint';
import type { Walkable } from './path';
import type { Facing, Vec2 } from './schema';

/**
 * Issue #37 ("sometimes I get run over"): a headless simulation of the give-
 * way check, run against real player movement speeds and real world-pack
 * road data rather than a stationary blocker (the shape every `vehicle.test`
 * fixture up to now has used).
 *
 * It measures the same rectangle a screenshot would: the player's own hitbox
 * (`engine/footprint.ts`, the exact function `engine/scenes/map.ts`
 * `playerTiles` calls) against the car's own drawn footprint (`VEHICLE_W` x
 * `VEHICLE_L`, engine/motor.ts, centred on `Driver.x`/`.y` the way
 * `drawCars` positions the sprite) — not tile indices, which is coarser than
 * what actually gets drawn and would miss the sprite's own two-tile-long nose
 * hanging past whatever tile the engine tracks the car by.
 *
 * The one thing this file does not try to prevent, because DESIGN.md §2 says
 * plainly that it is not a bug: somebody who steps into the road too close in
 * front of a moving car for its braking ramp to have any physical hope of
 * stopping short is simply passed under. `STOP_TILES` is exactly the distance
 * the ramp needs once it starts closing the throttle, so the test's one
 * standard is: whenever the car's own front bumper had at least that much
 * clear road to the tile the player was about to stand on, at the very
 * instant they stood on it, the two must never overlap afterwards. That is a
 * physical claim, not an implementation detail, so it holds regardless of
 * how the give-way check happens to be built inside `engine/vehicle.ts`.
 */

// A walkable road along the straight legs between consecutive waypoints —
// exactly the ground the mover's own pathfinder needs to run the given path,
// nothing either side of it.
function alongPath(path: Vec2[]): Walkable {
  const tiles = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let [x, y] = [ax, ay];
    tiles.add(`${x},${y}`);
    while (x !== bx || y !== by) {
      x += dx;
      y += dy;
      tiles.add(`${x},${y}`);
    }
  }
  return (x, y) => tiles.has(`${x},${y}`);
}

/** The player's own walking speed (engine/scenes/map.ts `SPEED`, 102px/s) in tiles/s. */
const PLAYER_SPEED = 102 / TILE;
/** The player's own hitbox: one tile, inset a quarter tile on every side (engine/scenes/map.ts `HITBOX`/`MARGIN`). */
const HITBOX_TILES = 1;
const HITBOX_INSET = 0.25;

type Rect = { minX: number; maxX: number; minY: number; maxY: number };

/** How far two rectangles are into each other — 0 or less is "not overlapping". */
function overlapDepth(a: Rect, b: Rect): number {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return Math.min(dx, dy);
}

/** The player's own hitbox rectangle, top-left at `(px, py)` in tiles — the same box `footprintTiles` reads corners of. */
function playerRect(px: number, py: number): Rect {
  return {
    minX: px + HITBOX_INSET,
    maxX: px + HITBOX_TILES - HITBOX_INSET,
    minY: py + HITBOX_INSET,
    maxY: py + HITBOX_TILES - HITBOX_INSET
  };
}

/** The tiles the player's hitbox reads as standing on, for the `blocked`/`player` callbacks — exactly `playerTiles()`'s own maths. */
function playerTiles(px: number, py: number): Vec2[] {
  return footprintTiles(px, py, HITBOX_TILES, HITBOX_INSET);
}

/**
 * The car's own drawn rectangle: two tiles nose to tail, one tile across,
 * centred on `(driver.x + 0.5, driver.y + 0.5)` — the same centre
 * `drawCars` positions the sprite at (`driver.x * TILE + TILE / 2`, in
 * pixels) — and oriented along whichever way it is facing, exactly as
 * `engine/motor.ts` `drawVehicle` lays the body out in car space.
 */
function carRect(x: number, y: number, facing: Facing): Rect {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const along = facing === 'left' || facing === 'right';
  const halfLen = VEHICLE_L / TILE / 2;
  const halfWid = VEHICLE_W / TILE / 2;
  const halfX = along ? halfLen : halfWid;
  const halfY = along ? halfWid : halfLen;
  return { minX: cx - halfX, maxX: cx + halfX, minY: cy - halfY, maxY: cy + halfY };
}

/** The car's own front bumper's position along its heading — how far it has to travel before its nose reaches `target`. */
function noseGap(x: number, y: number, facing: Facing, target: Vec2): number {
  const rect = carRect(x, y, facing);
  switch (facing) {
    case 'right':
      return target[0] - rect.maxX;
    case 'left':
      return rect.minX - (target[0] + 1);
    case 'down':
      return target[1] - rect.maxY;
    case 'up':
      return rect.minY - (target[1] + 1);
  }
}

/** A straight, one-lane road, as long as asked for — the drivable ground for the scenario tests. */
function straightRoad(length: number, row = 1): { path: Vec2[]; drivable: Walkable } {
  const path: Vec2[] = [
    [2, row],
    [length, row]
  ];
  return { path, drivable: alongPath(path) };
}

describe('give-way vs. a moving player (issue #37, "sometimes I get run over")', () => {
  /**
   * The player crosses the lane perpendicular to it, at a fixed walking
   * speed, at every phase offset of the car's own position across one full
   * transit of the road — the scenario a village crossing (Stamford's Route
   * 23, Jefferson's Main Street) actually is. For every offset where the
   * car's own front bumper had at least `STOP_TILES` of clear road to the
   * tile the player was about to occupy, at the instant they first occupied
   * it, the two must never subsequently overlap — that is exactly the
   * physical claim DESIGN.md §2 makes for the braking ramp.
   */
  it('never overlaps a player crossing the lane, whenever the car had its own braking distance to react', () => {
    const ROAD_LEN = 60;
    const CROSSING_X = 30;
    const CAR_SPEED = 8;
    const { path, drivable } = straightRoad(ROAD_LEN);
    const dt = 1 / 120;
    const totalTransit = (ROAD_LEN - 2) / CAR_SPEED;
    const offsets: number[] = [];
    for (let t = 0; t <= totalTransit; t += 0.03) offsets.push(t);

    let sawOverlapWithLead = 0;
    let sawTolerableOverlap = 0;
    let worstDepth = 0;
    let worstLead = -Infinity;

    for (const offset of offsets) {
      const car = new Driver({
        path,
        loop: false,
        speed: CAR_SPEED,
        pause: 0,
        drivable,
        facing: 'right',
        bounds: { width: ROAD_LEN + 10, height: 10 }
      });

      // The player walks a vertical line through the crossing point, starting
      // three tiles above the road and finishing three below it, at `offset`
      // seconds after the clock starts — everywhere from "long before the car
      // gets there" to "long after it has passed".
      const startY = -3;
      const endY = 4;
      let playerActive = false;
      let px = CROSSING_X;
      let py = startY;
      let leadAtFirstBlock: number | null = null;
      let overlapped = false;
      let maxDepth = 0;

      const step = (): DriveStep => ({
        blocked: (x, y) => playerActive && playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y),
        player: (x, y) => playerActive && playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y)
      });

      let clock = 0;
      const maxTime = Math.max(totalTransit, offset) + (endY - startY) / PLAYER_SPEED + 2;
      while (clock < maxTime) {
        if (!playerActive && clock >= offset) {
          playerActive = true;
          // The instant the player's hitbox first reaches into the lane row,
          // record how much clear road the car's own nose had to the tile
          // they are about to stand on — the physical yardstick above.
          const tiles = playerTiles(px, py);
          const laneTile = tiles.find(([, ty]) => ty === 1);
          if (laneTile) leadAtFirstBlock = noseGap(car.x, car.y, car.facing, laneTile);
        }
        car.update(dt, step());
        if (playerActive) {
          py += PLAYER_SPEED * dt;
          if (py > endY) playerActive = false;
          const tiles = playerTiles(px, py);
          const laneTile = tiles.find(([, ty]) => ty === 1);
          if (laneTile && leadAtFirstBlock === null) leadAtFirstBlock = noseGap(car.x, car.y, car.facing, laneTile);
          const depth = overlapDepth(playerRect(px, py), carRect(car.x, car.y, car.facing));
          if (depth > 0) {
            overlapped = true;
            maxDepth = Math.max(maxDepth, depth);
          }
        }
        clock += dt;
      }

      if (overlapped) {
        const lead = leadAtFirstBlock ?? Infinity;
        worstDepth = Math.max(worstDepth, maxDepth);
        worstLead = Math.max(worstLead, lead);
        if (lead >= STOP_TILES) {
          sawOverlapWithLead++;
        } else {
          sawTolerableOverlap++;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[sweep] ${offsets.length} offsets; ${sawTolerableOverlap} tolerated pass-unders ` +
        `(the player stepped in too close for any ramp to help), ` +
        `${sawOverlapWithLead} overlaps despite the car having its own braking distance ` +
        `(worst depth ${worstDepth.toFixed(2)} tiles, worst such lead ${worstLead.toFixed(2)} tiles)`
    );
    expect(sawOverlapWithLead).toBe(0);
  });

  /**
   * Walking the same direction the car is, in its own lane, well ahead of it
   * — and, once the car has visibly stopped for them, standing their ground
   * rather than walking on into it, exactly the way `scripts/playtest.mjs`'s
   * own "standing in the lane" step does. Cars are never solid (DESIGN.md
   * §1) so a player who kept walking *through* an already-stopped car would
   * of course end up overlapping it — that is not this bug; this checks that
   * the car itself never closes the last of the gap once both have stopped.
   */
  it('never overlaps a player walking along the lane it is driving in', () => {
    const ROAD_LEN = 60;
    const { path, drivable } = straightRoad(ROAD_LEN);
    const car = new Driver({
      path,
      loop: false,
      speed: 8,
      pause: 0,
      drivable,
      facing: 'right',
      bounds: { width: ROAD_LEN + 10, height: 10 }
    });
    let px = 40;
    const py = 1;
    const dt = 1 / 120;
    let worstDepth = 0;
    for (let t = 0; t < 12; t += dt) {
      const step: DriveStep = {
        blocked: (x, y) => playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y),
        player: (x, y) => playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y)
      };
      car.update(dt, step);
      // Ambling towards the oncoming car, well under its speed, until it has
      // visibly stopped for them — a real person does not keep walking once
      // the car ahead of them has come to a stop.
      if (!(car.stopped && car.yielding)) px -= PLAYER_SPEED * dt * 0.3;
      const depth = overlapDepth(playerRect(px, py), carRect(car.x, car.y, car.facing));
      worstDepth = Math.max(worstDepth, depth);
    }
    expect(worstDepth).toBeLessThanOrEqual(0);
  });

  /**
   * A slow frame — a stumble on a phone, a tab regaining focus — can hand
   * `update` a `dt` worth several tiles of driving in one go. The player
   * steps into the lane on the very frame after a long stall; the car must
   * still have a chance to see them, because the give-way check is meant to
   * run every fraction of a tile of travel, not once per frame however big
   * the frame is.
   */
  it('never overlaps a player who steps into the road right after a very slow frame', () => {
    const ROAD_LEN = 60;
    const { path, drivable } = straightRoad(ROAD_LEN);
    const CAR_SPEED = 19.125; // Route 10's fastest ambient car (walking speed x DRIVE_FACTOR)
    let worstOverLead = 0;
    // Somewhere the car has plenty of road left to react in, several tiles
    // short of the crossing point.
    const CROSSING_X = 40;
    for (const stallMs of [50, 120, 250, 500]) {
      const car = new Driver({
        path,
        loop: false,
        speed: CAR_SPEED,
        pause: 0,
        drivable,
        facing: 'right',
        bounds: { width: ROAD_LEN + 10, height: 10 }
      });
      const clear: DriveStep = { blocked: () => false, player: () => false };
      // Run it up to comfortably short of the crossing point at ordinary
      // frame timing first.
      const leadInTiles = STOP_TILES + LOOK_AHEAD; // comfortably outside the look-ahead too
      while (CROSSING_X - car.x > leadInTiles) car.update(1 / 60, clear);

      // The stall: one big frame, then the player is already standing there
      // on the very next one.
      let px = CROSSING_X;
      const py = 1;
      const blockedStep: DriveStep = {
        blocked: (x, y) => playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y),
        player: (x, y) => playerTiles(px, py).some(([tx, ty]) => tx === x && ty === y)
      };
      const before = noseGap(car.x, car.y, car.facing, [CROSSING_X, 1]);
      car.update(stallMs / 1000, blockedStep);
      // And however the stall left it, watch it the rest of the way at an
      // ordinary frame rate — it must come to a stop short, never through.
      let worstDepth = 0;
      for (let i = 0; i < 600; i++) {
        car.update(1 / 60, blockedStep);
        const depth = overlapDepth(playerRect(px, py), carRect(car.x, car.y, car.facing));
        worstDepth = Math.max(worstDepth, depth);
      }
      if (before >= STOP_TILES) {
        expect(worstDepth, `a ${stallMs}ms stall with ${before.toFixed(2)} tiles of lead drove through the player`).toBeLessThanOrEqual(0);
      } else {
        worstOverLead = Math.max(worstOverLead, worstDepth);
      }
      // The player steps off, and the car must pick back up rather than
      // sitting there forever.
      px = -100;
      let resumed = false;
      for (let i = 0; i < 600 && !resumed; i++) {
        car.update(1 / 60, blockedStep);
        if (!car.stopped) resumed = true;
      }
      expect(resumed).toBe(true);
    }
  });

  /** A real corner — Stamford's own main-street car turning at the top of NY 23 (worlds/route10/world.json `stamford-main-car`). */
  it('gives way round a real corner, never overlapping somebody standing just past the turn', () => {
    const world = JSON.parse(readFileSync(resolve(import.meta.dirname, '../worlds/route10/world.json'), 'utf8'));
    const stamford = world.maps.stamford;
    const stamfordMap = JSON.parse(readFileSync(resolve(import.meta.dirname, '../worlds/route10/maps/stamford.json'), 'utf8'));
    const data = stamford.vehicles.find((v: { id: string }) => v.id === 'stamford-main-car');
    expect(data).toBeTruthy();
    const path: Vec2[] = data.path;
    const drivable = alongPath(path);
    const car = new Driver({
      path,
      loop: data.loop ?? true,
      speed: data.speed,
      pause: data.pause ?? 0.8,
      drivable,
      bounds: { width: stamfordMap.width, height: stamfordMap.height }
    });

    // Just past the turn at [88,18] -> [88,16]: one tile up the northbound
    // leg, exactly where a real player rounding the corner on foot could be
    // standing while the car is still eastbound approaching the turn.
    const watchTile: Vec2 = [88, 17];
    const px = watchTile[0];
    const py = watchTile[1];
    const step: DriveStep = {
      blocked: (x, y) => x === Math.floor(px) && y === Math.floor(py),
      player: (x, y) => x === Math.floor(px) && y === Math.floor(py)
    };
    const dt = 1 / 120;
    let worstDepth = 0;
    for (let t = 0; t < 40; t += dt) {
      car.update(dt, step);
      const depth = overlapDepth(playerRect(px, py), carRect(car.x, car.y, car.facing));
      worstDepth = Math.max(worstDepth, depth);
    }
    expect(worstDepth).toBeLessThanOrEqual(0);
    expect(car.stopped).toBe(true);
  });

  /**
   * A real through-route car (Stamford's own) coming back on to the map after
   * a lap: the player standing at the very tile it is due to reappear on, and
   * again a tile further along the entry leg while it is mid-arrival. Blocked
   * from the very first frame, a car spawns already standing on its own first
   * waypoint (the same resting footprint a parked car has), so it is given a
   * full, unblocked lap first — proving it can actually leave and come back
   * at all — before the entry tiles are blocked for its *second* lap, which
   * is the re-entry this test is actually about.
   */
  it('never overlaps a player standing on the tiles a through-route car re-enters on', () => {
    const world = JSON.parse(readFileSync(resolve(import.meta.dirname, '../worlds/route10/world.json'), 'utf8'));
    const stamford = world.maps.stamford;
    const stamfordMap = JSON.parse(readFileSync(resolve(import.meta.dirname, '../worlds/route10/maps/stamford.json'), 'utf8'));
    const data = stamford.vehicles.find((v: { id: string }) => v.id === 'stamford-main-car');
    const path: Vec2[] = data.path;
    const drivable = alongPath(path);
    const dt = 1 / 60;

    for (const watchTile of [path[0], [path[0][0] + 1, path[0][1]] as Vec2]) {
      const car = new Driver({
        path,
        loop: true,
        speed: data.speed,
        pause: data.pause ?? 0.8,
        drivable,
        bounds: { width: stamfordMap.width, height: stamfordMap.height }
      });
      const clear: DriveStep = { blocked: () => false, player: () => false };

      // One full lap, unblocked — off the map, and back on it again — and a
      // little further still, so the car is genuinely out on its route
      // rather than sitting right on its own first waypoint: a stopped car's
      // own drawn body always straddles the tile it is standing on, the same
      // as anybody parked at the roadside, so measuring "overlap" against
      // whatever tile it already happens to be resting on would not be
      // testing the give-way check at all.
      let leftOnce = false;
      let backOnce = false;
      for (let t = 0; t < 40 && !backOnce; t += dt) {
        car.update(dt, clear);
        if (!car.onMap) leftOnce = true;
        if (leftOnce && car.onMap) backOnce = true;
      }
      expect(backOnce, `"${car.tile()}" never made it round one full unblocked lap`).toBe(true);
      for (let t = 0; t < 5 && car.x - path[0][0] < 3; t += dt) car.update(dt, clear);

      // Now the watch tile is occupied for the rest of the run, across
      // however many further laps it takes to see the car try to reappear
      // through it.
      const px = watchTile[0];
      const py = watchTile[1];
      const step: DriveStep = {
        blocked: (x, y) => x === px && y === py,
        player: (x, y) => x === px && y === py
      };
      let worstDepth = 0;
      let wentOffMapAgain = false;
      for (let t = 0; t < 40; t += dt) {
        car.update(dt, step);
        if (!car.onMap) wentOffMapAgain = true;
        // Once it has genuinely left the map on this pass, any reappearance
        // is the re-entry this test is watching for; overlap against the
        // watch tile before that is the same "already standing there"
        // non-issue the lead-in above sidesteps.
        if (wentOffMapAgain && car.onMap) {
          const depth = overlapDepth(playerRect(px, py), carRect(car.x, car.y, car.facing));
          worstDepth = Math.max(worstDepth, depth);
        }
      }
      expect(wentOffMapAgain, `"${car.tile()}" never left the map for its own reappear on tile ${watchTile}`).toBe(true);
      expect(worstDepth, `overlapped a player standing on the entry tile ${watchTile}`).toBeLessThanOrEqual(0);
      // Held off the map indefinitely rather than popping in on top of them —
      // it must still be off (or waiting right at the edge of arriving) once
      // the watch tile has been occupied the whole time.
      expect(car.onMap, `"${car.tile()}" came back on to the map through an occupied entry`).toBe(false);

      // And it resumes cleanly once the way is actually clear again.
      let resumed = false;
      for (let t = 0; t < 40 && !resumed; t += dt) {
        car.update(dt, clear);
        if (car.onMap && !car.stopped) resumed = true;
      }
      expect(resumed, `"${car.tile()}" never picked back up once the entry cleared`).toBe(true);
    }
  });
});
