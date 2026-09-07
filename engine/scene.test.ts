import { describe, expect, it } from 'vitest';
import { SceneRunner, sceneTriggered } from './scene';
import type { SceneDriver } from './scene';
import { sceneFlag } from './schema';
import type { EpisodeScene, LightSpec, Vec2 } from './schema';

/**
 * The runner is Phaser-free on purpose (engine/scene.ts), so the whole of a
 * scene's sequencing is testable here under plain Node: what happens on which
 * beat, what the player can and cannot do while it runs, and the flag a `once`
 * scene leaves behind. The driver below stands in for the map scene, and
 * records what it was asked to do in the order it was asked.
 */

interface Recorded {
  log: string[];
  driver: SceneDriver;
  /** Whoever is walking right now, and how many more frames of it are left. */
  walking: Map<string, number>;
  talking: boolean;
  panning: boolean;
  flags: Set<string>;
  lights: LightSpec[];
  /** Tiles `beginMove` should refuse to route to. */
  unreachable: Set<string>;
}

function recorder(): Recorded {
  const rec: Recorded = {
    log: [],
    walking: new Map(),
    talking: false,
    panning: false,
    flags: new Set(),
    lights: [],
    unreachable: new Set(),
    driver: null as unknown as SceneDriver
  };

  rec.driver = {
    beginMove(who: string, to: Vec2, speed?: number): boolean {
      if (rec.unreachable.has(`${to[0]},${to[1]}`)) {
        rec.log.push(`refuse ${who} -> ${to.join(',')}`);
        return false;
      }
      rec.log.push(`move ${who} -> ${to.join(',')}${speed ? ` @${speed}` : ''}`);
      // Two frames of walking, so "is it there yet" is actually asked.
      rec.walking.set(who, 2);
      return true;
    },
    moving(who: string): boolean {
      const left = rec.walking.get(who) ?? 0;
      if (left <= 0) return false;
      rec.walking.set(who, left - 1);
      return true;
    },
    say(who: string | undefined, lines: string[]): void {
      rec.log.push(`say ${who ?? '(narrator)'}: ${lines.join(' / ')}`);
      rec.talking = true;
    },
    talking: () => rec.talking,
    toast(text: string): void {
      rec.log.push(`toast ${text}`);
    },
    beginCamera(to: Vec2 | 'player'): void {
      rec.log.push(`camera ${Array.isArray(to) ? to.join(',') : to}`);
      rec.panning = true;
    },
    panning: () => rec.panning,
    setFlag(name: string): void {
      rec.log.push(`set ${name}`);
      rec.flags.add(name);
    },
    light(spec: LightSpec): void {
      rec.log.push(`light ${spec.mode}`);
      rec.lights.push(spec);
    }
  };
  return rec;
}

const scene = (steps: EpisodeScene['steps'], over: Partial<EpisodeScene> = {}): EpisodeScene => ({
  id: 'party',
  on: { enter: 'bar' },
  steps,
  ...over
});

/** Runs `frames` frames of a sixtieth of a second each. */
function run(runner: SceneRunner, frames = 1, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) runner.update(dt);
}

describe('SceneRunner', () => {
  it('runs the instant steps in order, in one frame', () => {
    const rec = recorder();
    const runner = new SceneRunner(
      scene([{ light: { mode: 'party' } }, { set: 'lightsUp' }, { toast: 'The Belvedere, on a good night.' }]),
      rec.driver
    );
    run(runner);
    expect(rec.log).toEqual([
      'light party',
      'set lightsUp',
      'toast The Belvedere, on a good night.',
      `set ${sceneFlag('party')}`
    ]);
    expect(runner.finished).toBe(true);
  });

  it('waits for a move to arrive before starting the next step', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ move: { who: 'gus', to: [4, 5] } }, { toast: 'in' }]), rec.driver);
    run(runner);
    expect(rec.log).toEqual(['move gus -> 4,5']);
    run(runner);
    expect(rec.log).toEqual(['move gus -> 4,5']);
    run(runner, 2);
    expect(rec.log).toContain('toast in');
  });

  it('walks a path one leg at a time', () => {
    const rec = recorder();
    const runner = new SceneRunner(
      scene([{ move: { who: 'sal', path: [[2, 2], [2, 6], [7, 6]], speed: 3 } }]),
      rec.driver
    );
    run(runner, 12);
    expect(rec.log).toEqual([
      'move sal -> 2,2 @3',
      'move sal -> 2,6 @3',
      'move sal -> 7,6 @3',
      `set ${sceneFlag('party')}`
    ]);
  });

  it('carries on with the rest of the scene when a move has nowhere to go', () => {
    const rec = recorder();
    rec.unreachable.add('9,9');
    const runner = new SceneRunner(
      scene([{ move: { who: 'sal', path: [[9, 9], [1, 1]] } }, { toast: 'anyway' }]),
      rec.driver
    );
    run(runner, 4);
    expect(rec.log).toEqual(['refuse sal -> 9,9', 'toast anyway', `set ${sceneFlag('party')}`]);
  });

  it('holds the player through a say, and hands control back after it', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ say: { who: 'vera', lines: ['Come in, come in.'] } }, { toast: 'after' }]), rec.driver);
    run(runner);
    expect(runner.holds).toBe(true);
    run(runner, 5);
    expect(rec.log).not.toContain('toast after');
    rec.talking = false;
    run(runner);
    expect(rec.log).toContain('toast after');
    expect(runner.holds).toBe(false);
  });

  it('holds the player only while it is the player who is walking', () => {
    const rec = recorder();
    const theirs = new SceneRunner(scene([{ move: { who: 'gus', to: [1, 1] } }]), rec.driver);
    run(theirs);
    expect(theirs.holds).toBe(false);

    const mine = new SceneRunner(scene([{ move: { who: 'player', to: [1, 1] } }]), recorder().driver);
    run(mine);
    expect(mine.holds).toBe(true);
  });

  it('holds a wait for its seconds, and lets A cut it short', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ wait: 2 }, { toast: 'later' }]), rec.driver);
    run(runner, 60);
    expect(rec.log).toEqual([]);
    expect(runner.skip()).toBe(true);
    run(runner);
    expect(rec.log).toContain('toast later');
  });

  it('never holds a wait longer than the schema allows', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ wait: 30 }, { toast: 'later' }]), rec.driver);
    run(runner, 60 * 3 + 2);
    expect(rec.log).toContain('toast later');
  });

  it('swallows A while it has the controls, and leaves it alone otherwise', () => {
    const rec = recorder();
    const saying = new SceneRunner(scene([{ say: { lines: ['A quiet line.'] } }]), rec.driver);
    run(saying);
    expect(saying.skip()).toBe(true);

    const strolling = new SceneRunner(scene([{ move: { who: 'gus', to: [3, 3] } }]), recorder().driver);
    run(strolling);
    expect(strolling.skip()).toBe(false);
  });

  it('waits for the camera to finish its pan', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ camera: { to: [8, 3] } }, { camera: { to: 'player' } }]), rec.driver);
    run(runner, 4);
    expect(rec.log).toEqual(['camera 8,3']);
    rec.panning = false;
    run(runner);
    expect(rec.log).toContain('camera player');
  });

  it('stops at an end step without running what follows it', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ toast: 'first' }, { end: true }, { toast: 'never' }]), rec.driver);
    run(runner);
    expect(rec.log).toEqual(['toast first', `set ${sceneFlag('party')}`]);
    expect(runner.finished).toBe(true);
  });

  it('records nothing when the scene may run again', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ toast: 'again' }], { once: false }), rec.driver);
    run(runner);
    expect(rec.log).toEqual(['toast again']);
    expect(rec.flags.size).toBe(0);
  });

  it('gives up on a walk that never arrives rather than hanging the scene', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ move: { who: 'gus', to: [4, 4] } }, { toast: 'on with it' }]), rec.driver);
    // Somebody boxed in: the driver says they are still walking, for ever.
    rec.driver.moving = () => true;
    run(runner, 60 * 21);
    expect(rec.log).toContain('toast on with it');
    expect(runner.finished).toBe(true);
  });

  it('does nothing at all once it is finished', () => {
    const rec = recorder();
    const runner = new SceneRunner(scene([{ toast: 'once' }]), rec.driver);
    run(runner, 10);
    expect(rec.log.filter((line) => line === 'toast once')).toHaveLength(1);
    expect(runner.skip()).toBe(false);
    expect(runner.holds).toBe(false);
  });
});

describe('sceneTriggered', () => {
  const flags = (set: string[]) => ({
    get: (name: string) => set.includes(name),
    met: (names: string[] | undefined) => (names ?? []).every((name) => set.includes(name))
  });

  it('fires on entering the map it names', () => {
    const s = scene([], { on: { enter: 'bar' } });
    expect(sceneTriggered(s, { enter: 'bar' }, flags([]))).toBe(true);
    expect(sceneTriggered(s, { enter: 'street' }, flags([]))).toBe(false);
  });

  it('holds an enter scene back until its requires are met', () => {
    const s = scene([], { on: { enter: 'bar', requires: ['invited'] } });
    expect(sceneTriggered(s, { enter: 'bar' }, flags([]))).toBe(false);
    expect(sceneTriggered(s, { enter: 'bar' }, flags(['invited']))).toBe(true);
  });

  it('fires on a flag, wherever the player is', () => {
    const s = scene([], { on: { flag: 'lightsUp' } });
    expect(sceneTriggered(s, {}, flags([]))).toBe(false);
    expect(sceneTriggered(s, {}, flags(['lightsUp']))).toBe(true);
  });

  it('never fires a once scene that has already played', () => {
    const s = scene([], { on: { flag: 'lightsUp' } });
    expect(sceneTriggered(s, {}, flags(['lightsUp', sceneFlag('party')]))).toBe(false);
    const again = scene([], { on: { flag: 'lightsUp' }, once: false });
    expect(sceneTriggered(again, {}, flags(['lightsUp', sceneFlag('party')]))).toBe(true);
  });
});
