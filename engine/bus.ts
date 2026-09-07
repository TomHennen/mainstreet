import type { Effect } from './schema';

export interface SayRequest {
  speaker: string;
  lines: string[];
  /** Texture key of a 96x96 portrait, when the world pack ships one. */
  portrait?: string;
  /** Applied once the last line is dismissed. */
  effects?: Effect[];
  /**
   * The id of an episode item this entry is the picking-up of, if it is one.
   * Recorded with the effects when the entry is read to the end, so a save can
   * say plainly what has been taken (DESIGN.md §2).
   */
  item?: string;
  /**
   * A DOM link offered alongside the entry. With `line` set it shows only
   * while that line (by index) is on screen; without it, it stays up for the
   * whole entry, every page. Its URL and label are composed by the caller
   * from world data — the bus carries no world knowledge of its own.
   */
  link?: { url: string; label: string; line?: number };
}

type Listener = (...args: any[]) => void;

interface Registration {
  fn: Listener;
  context: unknown;
}

/**
 * Minimal pub/sub — scenes are decoupled through this, nothing else.
 *
 * This used to be a bare `new Phaser.Events.EventEmitter()`, which pulled a
 * `import Phaser from 'phaser'` in at module scope. `flags.ts` emits a toast
 * through this bus, and importing Phaser outside a browser throws (it touches
 * `window` at import time), which made `flags.ts` — and so any test of effect
 * application — untestable under plain Node/Vitest. The on/off/emit surface
 * below matches the subset of `Phaser.Events.EventEmitter` this codebase
 * actually used (including the `context` argument for `this`-binding), so
 * every call site is unchanged.
 */
class EventBus {
  private readonly listeners = new Map<string, Registration[]>();

  on(event: string, fn: Listener, context?: unknown): void {
    const list = this.listeners.get(event) ?? [];
    list.push({ fn, context });
    this.listeners.set(event, list);
  }

  off(event: string, fn: Listener, context?: unknown): void {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(
      event,
      list.filter((reg) => reg.fn !== fn || reg.context !== context)
    );
  }

  emit(event: string, ...args: any[]): void {
    for (const { fn, context } of this.listeners.get(event) ?? []) {
      fn.apply(context, args);
    }
  }
}

/** Engine-wide events. Scenes are decoupled through this, nothing else. */
export const bus = new EventBus();

export const EV = {
  say: 'say',
  toast: 'toast',
  /**
   * A flag has just been set. Carries the flag's name. Overlays and scenes
   * both hang off this (DESIGN.md §3): a patch to a map appears the moment the
   * flag gating it is set, and a scene triggered `on: { flag }` starts there
   * and then — wherever the player happens to be standing.
   */
  flags: 'flags'
} as const;
