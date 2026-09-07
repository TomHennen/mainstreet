/**
 * Ambient traffic (DESIGN.md §2, issue #72).
 *
 * A car is a `Mover` with a driver in it. The mover does all the actual
 * travelling — the legs, the corners, the pause at a waypoint — and the driver
 * adds the one thing that makes a car a car rather than a very fast
 * townsperson: it watches the road ahead and lifts off when somebody is
 * standing in it.
 *
 * Cars are never a hazard and never anything else either (DESIGN.md §1): they
 * are not solid, they have nothing to say, tapping one does nothing, and they
 * write nothing to a save. Everything that could go wrong between a car and a
 * player is settled in the car's favour of stopping:
 *
 * - **Giving way.** A car looks `LOOK_AHEAD` tiles along its own route. If
 *   anybody is on one of those tiles it closes the throttle and coasts to a
 *   stop, and it stands there for as long as they stay. When the way clears it
 *   pulls away again on the same ramp. It never routes around anybody: a car
 *   that swerved past somebody standing in the road would read as impatience,
 *   and a car that waits reads as a neighbour.
 * - **Braking distance.** The ramp is worked out from the car's own speed, so
 *   however fast it is driving it comes to a stop within `STOP_TILES` — inside
 *   the distance it looks ahead, which is what makes the stop land *behind*
 *   whoever it stopped for rather than on top of them.
 * - **Stepping out in front of one.** Somebody who walks into the road a tile
 *   in front of a moving car is simply passed under, with nothing happening to
 *   either of them. There is no collision to have.
 * - **Parked cars.** A car with no waypoints at all is one somebody has left
 *   in a lot. It is the same object, drawn the same way and just as
 *   un-solid — it simply never sets off, until a scene sends it somewhere
 *   (`sendTo`), which is how an episode's pickup pulls out of the forecourt
 *   and heads off down the road (DESIGN.md §3).
 *
 * Phaser is nowhere in here, so all of the above is testable under plain Node
 * (engine/vehicle.test.ts). The scene owns only the sprite.
 */
import { Mover } from './mover';
import type { Walkable } from './path';
import type { Facing, Vec2 } from './schema';

/** How far up the road a driver looks, in tiles. */
export const LOOK_AHEAD = 3;
/** How much road a car takes to come to a stop, in tiles. Inside LOOK_AHEAD. */
export const STOP_TILES = 2;
/** A car moves at about this multiple of the player's walking speed. */
export const DRIVE_FACTOR = 3;
/** Seconds a car stands at a waypoint before taking the turn, by default. */
export const DEFAULT_VEHICLE_PAUSE = 0.8;
/** Below this the car reads as stopped rather than crawling. */
const STILL = 0.02;
/** Sub-tick slack, so a nonsensical speed can never divide by zero. */
const EPS = 1e-6;

export interface DriverOptions {
  /** The tile the car starts on. Defaults to the first waypoint. */
  pos?: Vec2;
  /** Waypoints, in order. No path at all is a car parked where it stands. */
  path?: Vec2[];
  loop?: boolean;
  /** Tiles per second at full throttle. */
  speed: number;
  pause?: number;
  /** The paved ground this car may drive on (engine/validate.ts `driveable`). */
  drivable: Walkable;
  facing?: Facing;
}

/** What the road looks like on the frame being stepped. */
export interface DriveStep {
  /** Tiles somebody is standing on this instant — the player, and anyone else. */
  blocked: (x: number, y: number) => boolean;
}

/** Which way something at `from` is pointing if it is off to `to`. */
function headingTo(from: Vec2, to: Vec2 | undefined): Facing | undefined {
  if (!to) return undefined;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return undefined;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

export class Driver {
  readonly mover: Mover;
  /** 0 stopped, 1 at full speed; everything between is the brake or the pull-away. */
  throttle = 1;
  /** Seconds from full speed to a stop, worked out from this car's own speed. */
  private readonly ramp: number;
  /** True on the frames the road ahead is occupied. */
  private giveWay = false;

  constructor(options: DriverOptions) {
    // A car with no waypoints is a parked one: it is given no route at all, so
    // the mover stands it exactly where the world pack put it, for ever. It is
    // still a Driver, so the scene draws it and gives way around it in one
    // place rather than two.
    const path = options.path ?? [];
    const start = options.pos ?? path[0] ?? [0, 0];
    this.mover = new Mover({
      home: [start[0], start[1]],
      // A car with somewhere to go already points that way on the frame it is
      // first drawn, rather than sitting across the road for a moment while
      // it works out which way it is going.
      facing: options.facing ?? headingTo(start, path.find((point) => point[0] !== start[0] || point[1] !== start[1])),
      route: path.length
        ? {
            path,
            loop: options.loop,
            pause: options.pause ?? DEFAULT_VEHICLE_PAUSE,
            speed: options.speed
          }
        : undefined,
      speed: options.speed,
      walkable: options.drivable
    });
    // Under a linear ramp the car covers half its top speed for the length of
    // the ramp, so stopping inside STOP_TILES means ramping in 2·d/v seconds.
    this.ramp = Math.max((2 * STOP_TILES) / Math.max(options.speed, EPS), EPS);
  }

  get x(): number {
    return this.mover.x;
  }

  get y(): number {
    return this.mover.y;
  }

  get facing(): Facing {
    return this.mover.facing;
  }

  /** The tile the car reads as being on. */
  tile(): Vec2 {
    return this.mover.tile();
  }

  /** True while the car is standing still — parked, waiting, or between legs. */
  get stopped(): boolean {
    return this.parked || this.throttle < STILL;
  }

  /**
   * True for a car that is not going anywhere: one that was never given a
   * route, and is not on an errand a scene sent it on either.
   */
  get parked(): boolean {
    return !this.mover.walks && !this.mover.onErrand;
  }

  /** True while a scene has this car on its way somewhere (`sendTo`). */
  get driving(): boolean {
    return this.mover.onErrand;
  }

  /**
   * Drive to one tile, now — the scene runner's `move` step for a
   * `"vehicle:<id>"` (engine/scene.ts, DESIGN.md §3). It is the mover's own
   * `sendTo`, with one thing deliberately left out: no "and nobody standing
   * in it" walkability. A car does not thread its way round somebody in the
   * road, it slows down and waits for them, which is the throttle's business
   * in `update` and nothing to do with the route. Returns false when there is
   * no paved way there, so the scene carries on rather than waiting on a car
   * that is never going to arrive.
   */
  sendTo(goal: Vec2, speed?: number): boolean {
    return this.mover.sendTo(goal, speed);
  }

  /** True on the frames a car is giving way to somebody in the road. */
  get yielding(): boolean {
    return this.giveWay;
  }

  /**
   * One frame. Closing the throttle is done by handing the mover less of the
   * frame than really passed: a car at half throttle covers half the ground,
   * and a car at nothing covers none of it and does not count down its pause
   * either — a car stopped in the road stays stopped, however long the wait.
   *
   * The mover is told nothing is in its way, deliberately. Everything about
   * giving way is the throttle's business, so the car waits where it is
   * instead of finding a way round whoever it is waiting for.
   */
  update(dt: number, step: DriveStep): void {
    this.giveWay = this.mover.ahead(LOOK_AHEAD).some(([x, y]) => step.blocked(x, y));
    const target = this.giveWay ? 0 : 1;
    const change = dt / this.ramp;
    this.throttle =
      target > this.throttle ? Math.min(1, this.throttle + change) : Math.max(0, this.throttle - change);
    this.mover.update(dt * this.throttle, { held: false, blocked: () => false });
  }
}
