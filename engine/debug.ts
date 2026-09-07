import type { Facing } from './schema';

/**
 * Dev-only read-only snapshot for the headless playtest harness
 * (`scripts/playtest.mjs`). It describes engine state only — nothing here is
 * world-specific — and it is stripped from production builds by the
 * `import.meta.env.DEV` guard at the call site.
 */
/** The dialogue page on screen, so the harness can read the copy back. */
export interface DebugDialogue {
  speaker: string;
  /** Zero-based page within the entry being read. */
  page: number;
  pages: number;
  text: string;
}

export interface DebugSnapshot {
  map: string;
  /** Tile coordinates, as floats. */
  x: number;
  y: number;
  facing: Facing;
  dialogueOpen: boolean;
  locked: boolean;
  /** Destination tile of a tapped walk while one is running, else null. */
  walkTo: [number, number] | null;
  /**
   * The slice of the world on screen, in world pixels, and the tile size it is
   * measured in — enough for the harness to turn a tile into a point on the
   * canvas and tap it.
   */
  view: { x: number; y: number; width: number; height: number; tile: number };
  /**
   * Every rectangle of world pixels a building's picture covers on this map —
   * footprint, the art standing on it, its name plate and its plaque. A tap
   * inside one of these is a tap on that building, so the harness knows which
   * ground is plain ground (engine/scenes/map.ts tapTargetAt).
   */
  art: { x: number; y: number; w: number; h: number }[];
  flags: Record<string, boolean>;
  /** The page of dialogue on screen, or null when no box is open. */
  dialogue: DebugDialogue | null;
}

/**
 * The dialogue box draws to the canvas, where nothing outside the game can
 * read it, so the UI scene leaves the page it just laid out here for the
 * snapshot to carry. Recorded behind the same `import.meta.env.DEV` guard as
 * the snapshot itself.
 */
let dialogue: DebugDialogue | null = null;

export function noteDialogue(page: DebugDialogue | null): void {
  dialogue = page;
}

export function currentDialogue(): DebugDialogue | null {
  return dialogue;
}

/**
 * The title screen's list, for the same harness and for the same reason: the
 * words are drawn to the canvas, where nothing outside the game can read them.
 * Each item carries where it sits on the page, in client (CSS) pixels, so a
 * tap can be aimed at it.
 */
export interface DebugTitleItem {
  kind: 'episode' | 'write';
  /** Episode id, or "" for the write-to-us row. */
  id: string;
  label: string;
  /** "Play" / "Continue" / "Play again" — empty unless this item is selected. */
  action: string;
  done: boolean;
  /** The world's word for a finished episode, as drawn — empty on the rest. */
  doneMark: string;
  selected: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export interface DebugTitle {
  world: string;
  items: DebugTitleItem[];
}

declare global {
  interface Window {
    __mainstreet?: DebugSnapshot;
    __mainstreetTitle?: DebugTitle | null;
  }
}

export function publishDebug(snapshot: DebugSnapshot): void {
  window.__mainstreet = snapshot;
}

export function publishTitle(title: DebugTitle | null): void {
  window.__mainstreetTitle = title;
}
