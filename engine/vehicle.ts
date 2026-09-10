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
 * - **A route that runs off the map.** `loop` (default true) ordinarily
 *   sends a car back to its first waypoint once it reaches its last, over
 *   whatever paved way there is — fine for a route that is a loop in its own
 *   right (Route 10's cars run a lap of two lanes). But when the *last*
 *   waypoint is where the road runs out — the map's own edge, or one of its
 *   `exits` — the only way back is the way it came, which reads as a car
 *   doing a U-turn at the edge of town. `runsOffMap` reads that off the path
 *   itself rather than a flag a world pack has to set, and a car whose route
 *   qualifies drives straight past its last waypoint instead, off the map,
 *   out of sight for a short beat, then reappears already under way at the
 *   first waypoint — never visibly turning around. A route that ends
 *   mid-map, or is explicitly `loop: false`, is unaffected: that is a car
 *   legitimately parking, and keeps doing exactly that.
 * - **The holler.** Brought to a full stop by the player specifically —
 *   never by another car ahead of it, which is nothing to say anything
 *   about — for `HOLLER_AFTER` seconds, a car has something to say about it.
 *   `takeHoller` is the one-shot: it hands the caller (`engine/scenes/map.ts`,
 *   which holds the world pack's `ui.honk` lines and shows them the way any
 *   ambient one-liner is shown) the index of the line to use and will not
 *   hand out another until this stop is over and a new one begins, and its
 *   own count moves on each time so the same car never repeats a line right
 *   after saying it.
 *
 * Phaser is nowhere in here, so all of the above is testable under plain Node
 * (engine/vehicle.test.ts). The scene owns only the sprite, and the line.
 */
import { Mover } from './mover';
import type { Walkable } from './path';
import type { Facing, Rect, Vec2 } from './schema';

/** How far up the road a driver looks, in tiles. */
export const LOOK_AHEAD = 3;
/** How much road a car takes to come to a stop, in tiles. Inside LOOK_AHEAD. */
export const STOP_TILES = 2;
/** A car moves at about this multiple of the player's walking speed. */
export const DRIVE_FACTOR = 3;
/** Seconds a car stands at a waypoint before taking the turn, by default. */
export const DEFAULT_VEHICLE_PAUSE = 0.8;
/**
 * Tiles a through-route car drives past its last waypoint before it counts
 * as gone. The engine-drawn car is two tiles wide on its own centre, so this
 * clears it of the camera, which never scrolls past the map's own edge
 * (`applyCamera` in engine/scenes/map.ts) — the car is already out of sight
 * well before this, this is just margin against it popping away mid-frame.
 */
export const VANISH_TILES = 2;
/** Seconds a through-route car sits off the map before it reappears. */
export const REAPPEAR_PAUSE = 1;
/** Seconds a car has to sit stopped for the player before it hollers — long enough that a quick crossing never triggers it. */
export const HOLLER_AFTER = 1;
/** Below this the car reads as stopped rather than crawling. */
const STILL = 0.02;
/** Sub-tick slack, so a nonsensical speed can never divide by zero. */
const EPS = 1e-6;
/** One tile in each facing, for driving straight off the map. */
const STEP: Record<Facing, Vec2> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

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
  /** The map's own size in tiles — what "off the map" means to `runsOffMap`. */
  bounds: { width: number; height: number };
  /** The map's own `exits`, so a route ending in one reads as "keeps going" too. */
  exits?: Rect[];
}

/** Rectangle containment — the same test as `engine/edges.ts`'s, kept local here too so this module stays a single, independently-testable file. */
const within = (rect: Rect, x: number, y: number): boolean =>
  x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];

/**
 * Whether a route's last waypoint is where the road runs out, rather than
 * somewhere mid-map a car might plausibly stop or turn (see "A route that
 * runs off the map" above). True when that waypoint sits on the map's
 * outermost ring of tiles, when the tile straight on from it — in the
 * direction the car arrives from — would be off the grid entirely, or when
 * the waypoint itself lies inside one of the map's `exits`. A path shorter
 * than two waypoints has no direction of travel to read, so it never counts.
 */
export function runsOffMap(
  path: Vec2[] | undefined,
  bounds: { width: number; height: number },
  exits: readonly Rect[] = []
): boolean {
  if (!path || path.length < 2) return false;
  const [lx, ly] = path[path.length - 1];
  if (lx === 0 || ly === 0 || lx === bounds.width - 1 || ly === bounds.height - 1) return true;
  const [px, py] = path[path.length - 2];
  const beyondX = lx + Math.sign(lx - px);
  const beyondY = ly + Math.sign(ly - py);
  if (beyondX < 0 || beyondY < 0 || beyondX >= bounds.width || beyondY >= bounds.height) return true;
  return exits.some((rect) => within(rect, lx, ly));
}

/** What the road looks like on the frame being stepped. */
export interface DriveStep {
  /** Tiles somebody is standing on this instant — the player, and anyone else. */
  blocked: (x: number, y: number) => boolean;
  /**
   * Tiles the player specifically is standing on — a narrower question than
   * `blocked`, and the only thing `takeHoller` cares about: a car stopped
   * behind another car has nobody to holler at. Omitted where nobody needs
   * to know (a scene's own one-off `sendTo`, say), in which case a car never
   * hollers.
   */
  player?: (x: number, y: number) => boolean;
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
  /** This car's own top speed, tiles per second — driving off the map uses it directly, with no ramp. */
  private readonly speed: number;
  /** True on the frames the road ahead is occupied. */
  private giveWay = false;
  /** True for a route `runsOffMap` says keeps going rather than turns around. */
  private readonly throughRoute: boolean;
  /** This route's first two waypoints, kept for reappearing under way at the start of it. */
  private readonly routeStart?: Vec2;
  private readonly routeSecond?: Vec2;
  /** This route's last waypoint — where a through-route car is once it is due to vanish. */
  private readonly lastWaypoint?: Vec2;
  /** `driving` normally; the rest is a through-route car's trip off the map and back — see `driveOffMap`. */
  private phase: 'driving' | 'vanishing' | 'off' = 'driving';
  /** Tiles still to cover before a vanishing car counts as gone. */
  private vanishLeft = 0;
  /** Seconds still to sit off the map before an off car reappears. */
  private offClock = 0;
  /** Seconds this stop has been the player's doing, specifically. */
  private stoppedForPlayer = 0;
  /** True once this stop has already handed out its one holler. */
  private hollered = false;
  /** How many times this car has hollered, so a world pack's lines can move on each time rather than repeat. */
  private hollerCount = 0;

  constructor(options: DriverOptions) {
    // A car with no waypoints is a parked one: it is given no route at all, so
    // the mover stands it exactly where the world pack put it, for ever. It is
    // still a Driver, so the scene draws it and gives way around it in one
    // place rather than two.
    const path = options.path ?? [];
    const start = options.pos ?? path[0] ?? [0, 0];
    const loops = options.loop ?? true;
    this.speed = options.speed;
    this.throughRoute = loops && runsOffMap(path, options.bounds, options.exits);
    this.routeStart = path[0];
    this.routeSecond = path[1];
    this.lastWaypoint = path[path.length - 1];
    this.mover = new Mover({
      home: [start[0], start[1]],
      // A car with somewhere to go already points that way on the frame it is
      // first drawn, rather than sitting across the road for a moment while
      // it works out which way it is going.
      facing: options.facing ?? headingTo(start, path.find((point) => point[0] !== start[0] || point[1] !== start[1])),
      route: path.length
        ? {
            path,
            // A through route never loops back through the mover's own
            // pathfinder — `update` drives it off the map and reappears it
            // at the start instead, once it reaches the end (see above).
            loop: this.throughRoute ? false : options.loop,
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

  /**
   * Every tile this car currently occupies, for another car's own give-way
   * check (`updateCars` in engine/scenes/map.ts) — none at all while a
   * through-route car is off the map between one lap and the next, so
   * nothing ever sits waiting on a car that has already left.
   */
  tiles(): Vec2[] {
    return this.phase === 'driving' ? this.mover.tiles() : [];
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
   *
   * A through-route car hands off to `driveOffMap` the moment it arrives at
   * its last waypoint with nowhere its own route says to go next — the trip
   * off the map and back that keeps it from ever turning around.
   */
  update(dt: number, step: DriveStep): void {
    if (this.phase !== 'driving') {
      this.driveOffMap(dt);
      return;
    }
    const ahead = this.mover.ahead(LOOK_AHEAD);
    this.giveWay = ahead.some(([x, y]) => step.blocked(x, y));
    const target = this.giveWay ? 0 : 1;
    const change = dt / this.ramp;
    this.throttle =
      target > this.throttle ? Math.min(1, this.throttle + change) : Math.max(0, this.throttle - change);
    this.mover.update(dt * this.throttle, { held: false, blocked: () => false });

    if (this.throughRoute && !this.mover.busy && this.atLastWaypoint()) {
      this.phase = 'vanishing';
      this.vanishLeft = VANISH_TILES;
      this.throttle = 1;
      return;
    }

    // A parked car is always stopped — nothing "brought it" to a stop, so it
    // never has cause to holler. A moving one only does when the player
    // specifically, rather than another car ahead of it, is why it isn't
    // moving right now.
    const byPlayer = !this.parked && this.stopped && ahead.some(([x, y]) => step.player?.(x, y));
    if (byPlayer) {
      this.stoppedForPlayer += dt;
    } else {
      this.stoppedForPlayer = 0;
      this.hollered = false;
    }
  }

  /**
   * The index into the world pack's `ui.honk` lines to show, the one time a
   * stop for the player has gone on long enough to be worth a holler — see
   * "The holler" above. `null` on every other frame, including every frame
   * after the first for the same stop.
   */
  takeHoller(): number | null {
    if (this.hollered || this.stoppedForPlayer < HOLLER_AFTER) return null;
    this.hollered = true;
    return this.hollerCount++;
  }

  private atLastWaypoint(): boolean {
    if (!this.lastWaypoint) return false;
    const [tx, ty] = this.mover.tile();
    return tx === this.lastWaypoint[0] && ty === this.lastWaypoint[1];
  }

  /**
   * The stretch of a through-route car's trip that its own `route` never
   * covers: straight on past the last waypoint at a steady clip — no giving
   * way, nobody can be standing past the edge of the map — until it is well
   * off screen, a short wait out there out of sight, and a jump back to the
   * start of the route, already moving, timed for while nobody can see it
   * happen.
   */
  private driveOffMap(dt: number): void {
    if (this.phase === 'vanishing') {
      const [dx, dy] = STEP[this.mover.facing];
      const covered = this.speed * dt;
      this.mover.x += dx * covered;
      this.mover.y += dy * covered;
      this.vanishLeft -= covered;
      if (this.vanishLeft <= 0) {
        this.phase = 'off';
        this.throttle = 0;
        this.offClock = REAPPEAR_PAUSE;
      }
      return;
    }
    this.offClock -= dt;
    if (this.offClock > 0 || !this.routeStart) return;
    this.mover.warpTo(this.routeStart, headingTo(this.routeStart, this.routeSecond) ?? this.mover.facing);
    this.throttle = 1;
    this.phase = 'driving';
  }
}
