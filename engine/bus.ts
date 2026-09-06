import Phaser from 'phaser';
import type { Effect } from './schema';

export interface SayRequest {
  speaker: string;
  lines: string[];
  /** Texture key of a 96x96 portrait, when the world pack ships one. */
  portrait?: string;
  /** Applied once the last line is dismissed. */
  effects?: Effect[];
}

/** Engine-wide events. Scenes are decoupled through this, nothing else. */
export const bus = new Phaser.Events.EventEmitter();

export const EV = {
  say: 'say',
  toast: 'toast'
} as const;
