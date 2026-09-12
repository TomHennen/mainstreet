/**
 * The scene runner (DESIGN.md §3): an episode's staged moments, played one
 * step at a time.
 *
 * Like `engine/mover.ts` this is a pure state machine with no Phaser in it and
 * no idea of any world (CLAUDE.md hard rules 1 and 2). It walks a list of data
 * steps, asks a driver to do each one, and waits for the driver to say that it
 * is finished. The map scene is the only driver that exists; the tests drive it
 * with a hand-written one, which is what makes the whole of the sequencing —
 * legs of a walk, skipping a wait, the flag a `once` scene leaves behind —
 * testable under plain Node.
 */
import { MAX_WAIT, SCENE_PLAYER, sceneFlag } from './schema';
import type { EpisodeScene, LightSpec, SceneStep, Vec2 } from './schema';

/**
 * What a running scene needs of the world around it. Every method is either
 * "start this" or "is it over yet", so the runner never has to know how long
 * anything takes.
 */
export interface SceneDriver {
  /**
   * Start walking somebody to one tile. False when there is no way there at
   * all, which abandons the rest of that move rather than hanging the scene.
   */
  beginMove(who: string, to: Vec2, speed?: number): boolean;
  /** True while that person is still on their way. */
  moving(who: string): boolean;
  /** Open the dialogue box. `who` is an NPC id, or undefined for the narrator. */
  say(who: string | undefined, lines: string[]): void;
  /** True while a box is open. */
  talking(): boolean;
  toast(text: string): void;
  beginCamera(to: Vec2 | 'player', speed?: number): void;
  panning(): boolean;
  setFlag(name: string): void;
  light(spec: LightSpec): void;
  /** Hide the player sprite: invisible, and out of everyone else's way. */
  hidePlayer(): void;
  /** Show the player again — where they already stand, or at `at` if given. */
  showPlayer(at?: Vec2): void;
}

type Phase = 'run' | 'move' | 'say' | 'wait' | 'camera' | 'done';

/**
 * However long a walk is given before the scene gives up on it. Not a timer
 * the player can feel (DESIGN.md §1) — nothing on screen counts down and
 * nothing is lost — only a safety valve, so a townsperson boxed in by a
 * player standing in a doorway can never leave a scene stuck mid-step.
 */
const STUCK_AFTER = 20;

/** A step that finishes instantly chains into the next one; this ends a loop. */
const MAX_CHAIN = 500;

export class SceneRunner {
  readonly id: string;
  private readonly steps: SceneStep[];
  private readonly driver: SceneDriver;
  private readonly once: boolean;

  private phase: Phase = 'run';
  private index = -1;
  /** Legs of the move being walked, nearest first. */
  private legs: Vec2[] = [];
  private who = '';
  private speed: number | undefined;
  /** Seconds still to hold on a `wait`. */
  private left = 0;
  /** Seconds the current step has been running, for the stuck valve. */
  private elapsed = 0;

  constructor(scene: EpisodeScene, driver: SceneDriver) {
    this.id = scene.id;
    this.steps = scene.steps ?? [];
    this.driver = driver;
    this.once = scene.once !== false;
  }

  /** True once every step has run (or an `end` step cut the rest short). */
  get finished(): boolean {
    return this.phase === 'done';
  }

  /**
   * True while the scene is speaking or walking the player somewhere — the
   * only two things that take the controls off them. Everything else (a
   * townsperson crossing the room, the lights coming up, a toast) happens
   * around a player who is still free to walk about.
   */
  get holds(): boolean {
    if (this.phase === 'say') return true;
    return this.phase === 'move' && this.who === SCENE_PLAYER;
  }

  /**
   * The A button. It cuts a `wait` short; while the scene has the controls it
   * is swallowed, so a press meant to hurry a line along never strikes up a
   * conversation with whoever is standing there. Returns true when the press
   * belonged to the scene.
   */
  skip(): boolean {
    if (this.phase === 'wait') {
      this.left = 0;
      return true;
    }
    return this.holds;
  }

  update(dt: number): void {
    let time = dt;
    for (let guard = 0; guard < MAX_CHAIN; guard++) {
      if (this.phase === 'done') return;
      if (this.phase === 'run') {
        if (!this.advance()) return;
        continue;
      }
      if (!this.tick(time)) return;
      // Steps that finish instantly run on in the same frame, but the seconds
      // that have already been spent are not spent twice.
      time = 0;
    }
  }

  /** Starts the next step. False when the scene is over. */
  private advance(): boolean {
    this.index += 1;
    this.elapsed = 0;
    if (this.index >= this.steps.length) {
      this.finish();
      return false;
    }
    const step = this.steps[this.index];

    if (step.end) {
      this.finish();
      return false;
    }
    if (step.move) {
      this.who = step.move.who;
      this.speed = step.move.speed;
      const path = step.move.path ?? (step.move.to ? [step.move.to] : []);
      this.legs = path.map((tile) => [tile[0], tile[1]] as Vec2);
      this.phase = 'move';
      this.nextLeg();
      return true;
    }
    if (step.say) {
      this.driver.say(step.say.who, step.say.lines);
      this.phase = 'say';
      return true;
    }
    if (step.wait !== undefined) {
      this.left = Math.min(Math.max(step.wait, 0), MAX_WAIT);
      this.phase = 'wait';
      return true;
    }
    if (step.camera) {
      this.driver.beginCamera(step.camera.to, step.camera.speed);
      this.phase = 'camera';
      return true;
    }
    // The rest happen on the beat they are reached, and the next step starts
    // in the same frame.
    if (step.toast !== undefined) this.driver.toast(step.toast);
    if (step.set) this.driver.setFlag(step.set);
    if (step.light) this.driver.light(step.light);
    if (step.player?.hide) this.driver.hidePlayer();
    else if (step.player?.show) this.driver.showPlayer(step.player.show.at);
    return true;
  }

  /** Aims the next leg of a move, or ends the step when they run out. */
  private nextLeg(): void {
    const leg = this.legs.shift();
    if (!leg) {
      this.phase = 'run';
      return;
    }
    this.elapsed = 0;
    if (!this.driver.beginMove(this.who, leg, this.speed)) {
      // Nowhere to go. A scene that cannot stage its move carries on with the
      // rest of itself rather than stopping dead in the middle of a party.
      this.legs = [];
      this.phase = 'run';
    }
  }

  /** True when the current step just finished and the next one may start. */
  private tick(dt: number): boolean {
    this.elapsed += dt;
    switch (this.phase) {
      case 'move': {
        if (this.driver.moving(this.who)) {
          if (this.elapsed < STUCK_AFTER) return false;
          this.legs = [];
          this.phase = 'run';
          return true;
        }
        this.nextLeg();
        // nextLeg may have started the next leg, or run the move out.
        return (this.phase as Phase) === 'run';
      }
      case 'say': {
        if (this.driver.talking()) return false;
        this.phase = 'run';
        return true;
      }
      case 'wait': {
        this.left -= dt;
        if (this.left > 0) return false;
        this.phase = 'run';
        return true;
      }
      case 'camera': {
        if (this.driver.panning() && this.elapsed < STUCK_AFTER) return false;
        this.phase = 'run';
        return true;
      }
      default:
        return false;
    }
  }

  private finish(): void {
    this.phase = 'done';
    this.legs = [];
    // A scene that runs once records itself, so a save remembers it happened
    // and it never plays twice (DESIGN.md §2/§3).
    if (this.once) this.driver.setFlag(sceneFlag(this.id));
  }
}

/**
 * Whether a scene should start now. `on.flag` fires the moment that flag is
 * set; `on.enter` fires on arriving at that map with every `requires` flag
 * true. A `once` scene that has already run never fires again.
 */
export function sceneTriggered(
  scene: EpisodeScene,
  trigger: { enter?: string },
  flags: { get(name: string): boolean; met(names: string[] | undefined): boolean }
): boolean {
  if (scene.once !== false && flags.get(sceneFlag(scene.id))) return false;
  if (scene.on.flag) return flags.get(scene.on.flag);
  if (scene.on.enter) return trigger.enter === scene.on.enter && flags.met(scene.on.requires);
  return false;
}
