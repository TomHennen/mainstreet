/**
 * Townspeople who move (DESIGN.md §2/§3).
 *
 * A mover walks one person along the tiles a world pack asked for — a `route`
 * of waypoints, or a `wander` around the tile they live on — and knows nothing
 * else: no scene, no map, no world (CLAUDE.md hard rule 1). It is handed a
 * walkability callback for the static ground, a "who is standing there right
 * now" callback for everything that moves, and a delta in seconds, and it
 * keeps a tile position, a facing and a walk-cycle clock in return. Phaser is
 * nowhere in here, which is what makes the pausing and the leg-by-leg walk
 * testable under plain Node (engine/mover.test.ts).
 *
 * Positions are in tiles, as floats, the same units `engine/path.ts` routes in:
 * a whole number is a person standing on that tile, and anything between is a
 * person part-way along a leg of it.
 */
import { findPath } from './path.ts';
import type { Walkable } from './path';
import type { Facing, Route, Vec2, Wander } from './schema';

/** Seconds a person waits at a waypoint, or between wanders, by default. */
export const DEFAULT_PAUSE = 1.5;
/** A townsperson is strolling; the player is going somewhere. */
export const STROLL_FACTOR = 0.45;
/** How long a blocked person waits for the way to clear before re-routing. */
const REPLAN_AFTER = 0.6;
/** Sub-pixel slack, in tiles. */
const EPS = 1e-6;
/** One tile in each facing, for looking along the way ahead. */
const STEPS: Record<Facing, Vec2> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** The axis-aligned unit step from one tile towards another, favouring the longer axis — the same rule `headingTo` (engine/vehicle.ts) turns to face. */
function stepToward(from: Vec2, to: Vec2): Vec2 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return [dx < 0 ? -1 : dx > 0 ? 1 : 0, 0];
  return [0, dy < 0 ? -1 : 1];
}

export interface MoverOptions {
  /** The tile the person is placed on, and the middle of a wander. */
  home: Vec2;
  facing?: Facing;
  route?: Route;
  wander?: Wander;
  /** Tiles per second. */
  speed: number;
  /** The static ground: what this person may ever stand on. */
  walkable: Walkable;
  /** Seeds the wander's choices, so a village looks the same on every visit. */
  seed?: number;
}

/** What the world looks like on the frame being stepped. */
export interface MoverStep {
  /** True while the person must stand still: a dialogue, or the player close by. */
  held: boolean;
  /** Tiles somebody else is standing on this instant. */
  blocked: (x: number, y: number) => boolean;
}

/**
 * A tiny seeded generator, so a wander looks the same on every visit to a
 * village rather than jittering differently each load. Mulberry32.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable small number for an id — a wander's seed, and which line a passer-by says. */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Mover {
  /** Tile position, as floats. */
  x: number;
  y: number;
  facing: Facing;
  /** True on a frame the person actually covered ground. */
  moving = false;
  /** Seconds spent walking, for the walk cycle. */
  walkTime = 0;

  private readonly walkable: Walkable;
  private readonly speed: number;
  private readonly pause: number;
  private readonly route?: Route;
  private readonly wander?: Wander;
  private readonly home: Vec2;
  private readonly spots: Vec2[] = [];
  private readonly random: () => number;

  /** The last tile fully arrived at; with `path[0]` it is what this person covers. */
  private anchor: Vec2;
  /** Tiles still to walk on this leg, nearest first. */
  private path: Vec2[] = [];
  /** Seconds still to stand still for. */
  private wait: number;
  /** Seconds the way ahead has been occupied by somebody else. */
  private held = 0;
  /** Which waypoint comes next. */
  private next = 0;
  /** True while somebody is on their way over to say hello. */
  private waiting = false;

  /**
   * An errand: somewhere a scene has sent this person, which overrides
   * whatever their route or wander had in mind until they get there
   * (DESIGN.md §3). Somebody with no route at all can still be sent on one,
   * which is how a townsperson who normally stands at the bar walks in
   * through the door when the party starts.
   */
  private errandGoal: Vec2 | null = null;
  private errandSpeed: number | undefined;

  constructor(options: MoverOptions) {
    this.home = [options.home[0], options.home[1]];
    this.x = options.home[0];
    this.y = options.home[1];
    this.anchor = [options.home[0], options.home[1]];
    this.facing = options.facing ?? 'down';
    this.walkable = options.walkable;
    this.speed = options.speed;
    this.route = options.route;
    this.wander = options.wander;
    this.pause = Math.max(0, options.route?.pause ?? options.wander?.pause ?? DEFAULT_PAUSE);
    this.random = rng(options.seed ?? 1);
    this.wait = this.pause;

    // Where a wander may go, worked out once: the static ground never changes
    // under a running map, and a list is cheaper than a search every pause.
    if (this.wander) {
      const radius = this.wander.radius;
      const span = Math.ceil(radius);
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.hypot(dx, dy) > radius) continue;
          const x = this.home[0] + dx;
          const y = this.home[1] + dy;
          if (this.walkable(x, y)) this.spots.push([x, y]);
        }
      }
    }
  }

  /** The tile this person reads as being on. */
  tile(): Vec2 {
    return [this.anchor[0], this.anchor[1]];
  }

  /**
   * Every tile this person is standing on: the one they came from and the one
   * they are stepping into, so the player is never squeezed through somebody
   * half way across a doorway.
   */
  tiles(): Vec2[] {
    const at = this.tile();
    // Only once a step is actually under way: a person waiting to set off is
    // standing on one tile, however firmly they intend to use the next.
    if (this.x === at[0] && this.y === at[1]) return [at];
    const to = this.path[0];
    if (!to || (to[0] === at[0] && to[1] === at[1])) return [at];
    return [at, [to[0], to[1]]];
  }

  /**
   * The next `count` tiles of the way ahead: the planned leg while there is
   * one, then — for a route, which knows where it turns next even before it
   * has planned that far — on through its own upcoming waypoints, one after
   * another, so a car a short leg or a paused wait away from a corner still
   * sees round however many turns it needs to rather than only the tiles
   * straight on from its current facing (which is what "ahead" fell back to
   * for anyone without a route to consult, and still does — a wander, or a
   * route that has genuinely run out). Reading only the *first* turn and
   * then carrying on along the old facing was a real bug: past a sharp
   * corner that put the tiles on the wrong side of it entirely, sometimes
   * even back the way the mover came. Nothing here says whether these tiles
   * may be walked on — it is what the road ahead *is*, which is what a
   * driver looks at before pulling away, and before it pulls away at all
   * (engine/vehicle.ts).
   */
  ahead(count: number): Vec2[] {
    const out: Vec2[] = [];
    for (let i = 0; i < count && i < this.path.length; i++) out.push([this.path[i][0], this.path[i][1]]);
    if (out.length >= count) return out;

    let from = out.length ? out[out.length - 1] : this.tile();
    let waypointIndex = this.next;
    // Bounded by however many waypoints a route has, plus the tiles already
    // found, so a pathological route (every waypoint the same tile, say)
    // still terminates rather than spinning forever.
    let guard = out.length + (this.route?.path.length ?? 0) + 1;
    while (out.length < count && guard-- > 0) {
      const to = this.routeWaypointAt(waypointIndex);
      if (!to) break;
      waypointIndex++;
      const [dx, dy] = stepToward(from, to);
      if (dx === 0 && dy === 0) continue; // a duplicate waypoint — nothing to walk, move on to the next
      while (out.length < count && (from[0] !== to[0] || from[1] !== to[1])) {
        from = [from[0] + dx, from[1] + dy];
        out.push(from);
      }
    }
    if (out.length >= count) return out;

    const [dx, dy] = STEPS[this.facing];
    let [x, y] = out.length ? out[out.length - 1] : this.tile();
    while (out.length < count) {
      x += dx;
      y += dy;
      out.push([x, y]);
    }
    return out;
  }

  /**
   * The route's own waypoint at this index, wrapping once the route loops —
   * `undefined` for a wander, or a route that has genuinely run out (no
   * more waypoints, and not set to loop). `next` already points past
   * whichever waypoint is the current goal by the time either of `ahead`'s
   * two callers would ask, in both the "mid-leg" and the "paused" case, so
   * `routeWaypointAt(this.next)` is exactly "what comes after" either way,
   * and `ahead` walks on from there through as many further waypoints as it
   * needs.
   */
  private routeWaypointAt(index: number): Vec2 | undefined {
    if (!this.route) return undefined;
    const path = this.route.path;
    if (!path.length) return undefined;
    if (index < path.length) return path[index];
    return this.route.loop !== false ? path[index % path.length] : undefined;
  }

  /** True while this person has somewhere to be. */
  get busy(): boolean {
    return this.path.length > 0;
  }

  /** True when the world pack actually gave this person somewhere to go. */
  get walks(): boolean {
    return Boolean(this.route || this.wander);
  }

  /** True while this person is on an errand a scene sent them on. */
  get onErrand(): boolean {
    return this.errandGoal !== null;
  }

  /**
   * Go here, now (DESIGN.md §3). Returns false when there is no way through,
   * so a scene can carry on with the rest of itself rather than waiting on
   * somebody who is never going to arrive. `clear` is an optional stricter
   * walkability — "and nobody standing in it" — tried first, so a route goes
   * round whoever is in the way when it can and straight at them when it
   * cannot.
   */
  sendTo(goal: Vec2, speed?: number, clear?: Walkable): boolean {
    this.errandSpeed = speed;
    const standing = this.x === this.anchor[0] && this.y === this.anchor[1];
    if (goal[0] === this.anchor[0] && goal[1] === this.anchor[1]) {
      // Already there — or a stride short of it, in which case the last step
      // is finished rather than abandoned half way across a tile.
      this.path = standing ? [] : [[this.anchor[0], this.anchor[1]]];
      this.errandGoal = standing ? null : [goal[0], goal[1]];
      this.wait = 0;
      return true;
    }
    const isGoal = (x: number, y: number) => x === goal[0] && y === goal[1];
    const route =
      (clear ? findPath(this.anchor, isGoal, (x, y) => this.walkable(x, y) && clear(x, y)) : null) ??
      findPath(this.anchor, isGoal, this.walkable);
    if (!route || route.length < 2) {
      this.errandGoal = null;
      return false;
    }
    this.errandGoal = [goal[0], goal[1]];
    this.path = route.slice(1);
    this.wait = 0;
    this.held = 0;
    // A scene taking charge of somebody ends any "wait there, I'm coming
    // over": the errand is what they are doing now, and whoever was walking
    // across to them finds them where the errand leaves them.
    this.waiting = false;
    return true;
  }

  /**
   * Somebody has set off across the street to talk to this person, so they
   * wait where they are until whoever it is gets here (DESIGN.md §2). It is
   * the same standing still as when the player is already within reach, held
   * a little earlier: without it, walking over to somebody would be walking
   * over to where they *were*, and on a slow frame they would be gone by the
   * time the walk ended.
   *
   * An errand outranks it: somebody a scene has sent somewhere keeps going,
   * and stands still for whoever hailed them once they get there.
   */
  hail(): void {
    this.waiting = true;
  }

  /** They arrived, or thought better of it: carry on where the walk left off. */
  release(): void {
    this.waiting = false;
  }

  /** True while somebody is on their way over. */
  get hailed(): boolean {
    return this.waiting;
  }

  /**
   * Places this person exactly as if they had just been dropped at `pos`,
   * already pointed `facing`, with their whole route ahead of them again.
   * This is the jump a through-route car takes off the edge of the map and
   * back in at the start of its route rather than turning around
   * (engine/vehicle.ts, DESIGN.md §2) — done while the car is off screen, so
   * nobody sees it happen. Unlike arriving anywhere else, it skips the usual
   * pause: by the time anything calls this the car is already under way, so
   * it is given the second waypoint to head for rather than the first (which
   * is where it is standing), and no reason to stand still first.
   */
  warpTo(pos: Vec2, facing: Facing): void {
    this.anchor = [pos[0], pos[1]];
    this.x = pos[0];
    this.y = pos[1];
    this.facing = facing;
    this.path = [];
    this.wait = 0;
    this.held = 0;
    this.next = this.route && this.route.path.length > 1 ? 1 : 0;
    this.waiting = false;
    this.errandGoal = null;
    this.errandSpeed = undefined;
  }

  /** Turn to look at a point in tile space — what being spoken to does. */
  faceToward(x: number, y: number): void {
    const dx = x - (this.x + 0.5);
    const dy = y - (this.y + 0.5);
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return;
    this.facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  }

  /**
   * One frame. `dt` is in seconds, so the walk is the same on any machine.
   * A held person stands exactly where they are: their pause is not counted
   * down, so stopping to say hello never costs them their place in the walk.
   * Being hailed — somebody walking over to talk — holds them the same way.
   * An errand outranks both: a scene that has sent somebody somewhere is not
   * something the player can interrupt by standing near them.
   */
  update(dt: number, step: MoverStep): void {
    this.moving = false;
    if (!this.walks && !this.onErrand) return;
    // An errand is a scene's instruction, so nothing holds it: somebody
    // crossing the room on cue keeps crossing it with the player standing
    // there, and keeps crossing it when the player taps them on the way. Any
    // hail waits for them at the far end of the errand.
    if (!this.onErrand && (step.held || this.waiting)) return;

    let left = dt;
    if (!this.path.length) {
      this.wait -= left;
      if (this.wait > 0) return;
      // Whatever the pause overran by is walked this frame, so the same
      // journey takes the same time at 20fps and at 240.
      left = -this.wait;
      this.wait = 0;
      this.plan(step);
      if (!this.path.length) return;
    }
    if (left > 0) this.walk(left, step);
  }

  /** Walks along the current leg, exactly as the player's tapped walk does. */
  private walk(dt: number, step: MoverStep): void {
    // An errand may set its own pace; everybody else keeps theirs.
    const speed = (this.onErrand && this.errandSpeed) || this.speed;
    let budget = speed * dt;

    while (budget > EPS && this.path.length) {
      const [tx, ty] = this.path[0];
      const standing = this.x === this.anchor[0] && this.y === this.anchor[1];

      // The check is only made with both feet on the anchor tile: once a step
      // is under way it is finished, so nobody stops mid-stride.
      if (standing && (step.blocked(tx, ty) || !this.walkable(tx, ty))) {
        this.held += dt;
        if (this.held >= REPLAN_AFTER) {
          // Whoever it is has settled in. Find another way round, or wait.
          this.held = 0;
          this.path = [];
          this.wait = 0;
          // Somebody on an errand has somewhere to be, so they go round rather
          // than falling back on their route; when there is no way round at
          // all the errand is given up on, which the scene takes as arrival.
          if (this.errandGoal && !this.sendTo(this.errandGoal, this.errandSpeed, (x, y) => !step.blocked(x, y))) {
            this.errandGoal = null;
          }
        }
        return;
      }
      this.held = 0;

      const dx = tx - this.x;
      const dy = ty - this.y;
      const len = Math.hypot(dx, dy);
      if (len < EPS) {
        this.anchor = [tx, ty];
        this.path.shift();
        continue;
      }
      this.facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';

      const use = Math.min(budget, len);
      this.x += (dx / len) * use;
      this.y += (dy / len) * use;
      budget -= use;
      this.moving = true;
      this.walkTime += use / speed;
      if (use >= len - EPS) {
        this.x = tx;
        this.y = ty;
        this.anchor = [tx, ty];
        this.path.shift();
      }
    }

    // Arrived: stand a while before the next leg, less whatever of this frame
    // was left over once the last step was taken. An errand ends here, and
    // whatever route or wander this person had picks up again after the pause.
    if (!this.path.length) {
      this.errandGoal = null;
      this.errandSpeed = undefined;
      this.wait = Math.max(0, this.pause - budget / speed);
    }
  }

  /**
   * Where next, and how to get there. Somebody standing in the way is routed
   * around here rather than waited out, and a dead end is simply another
   * pause — a person with nowhere to go stands still, which is what a person
   * with nowhere to go does.
   */
  private plan(step: MoverStep): void {
    const goal = this.goal(step);
    if (!goal || (goal[0] === this.anchor[0] && goal[1] === this.anchor[1])) {
      this.wait = this.pause;
      return;
    }
    const clear = (x: number, y: number) => this.roam(x, y) && !step.blocked(x, y);
    const route =
      findPath(this.anchor, (x, y) => x === goal[0] && y === goal[1], clear) ??
      findPath(this.anchor, (x, y) => x === goal[0] && y === goal[1], this.roam);
    if (!route || route.length < 2) {
      this.wait = this.pause;
      return;
    }
    this.path = route.slice(1);
  }

  /**
   * Where this person may put their feet. A wander stays inside its radius all
   * the way round, not only at the ends of it: somebody pottering outside the
   * cafe should never take a short cut down the block to get back.
   */
  private readonly roam: Walkable = (x, y) => {
    if (!this.walkable(x, y)) return false;
    if (!this.wander) return true;
    return Math.hypot(x - this.home[0], y - this.home[1]) <= this.wander.radius;
  };

  private goal(step: MoverStep): Vec2 | null {
    if (this.route) {
      const path = this.route.path;
      if (!path.length) return null;
      if (this.next >= path.length) {
        if (this.route.loop === false) return null;
        this.next = 0;
      }
      const goal = path[this.next];
      this.next += 1;
      return [goal[0], goal[1]];
    }
    if (this.wander && this.spots.length) {
      // A few tries rather than a shuffle: somebody standing on the one tile
      // this person picked is a reason to pick again, not to give up.
      for (let i = 0; i < 4; i++) {
        const spot = this.spots[Math.floor(this.random() * this.spots.length)];
        if (!spot) break;
        if (spot[0] === this.anchor[0] && spot[1] === this.anchor[1]) continue;
        if (step.blocked(spot[0], spot[1])) continue;
        return [spot[0], spot[1]];
      }
    }
    return null;
  }
}
