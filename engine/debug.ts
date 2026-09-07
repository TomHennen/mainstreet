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
  /**
   * Everybody on this map who is not the player, where they are *now*: tile
   * coordinates as floats, and every tile they are standing on (two while
   * they are stepping between tiles). Townspeople walk (engine/mover.ts), so
   * the harness cannot take their placed position for where they are.
   */
  people: { id: string; x: number; y: number; tiles: [number, number][] }[];
  flags: Record<string, boolean>;
  /** The page of dialogue on screen, or null when no box is open. */
  dialogue: DebugDialogue | null;
  /**
   * The scene playing right now, or null (DESIGN.md §3). `holds` is true while
   * it has the controls off the player — a line being read, or a walk it is
   * staging.
   */
  scene: { id: string; holds: boolean } | null;
  /** What the lights are doing, and how many discs are hanging (engine/lighting.ts). */
  light: { mode: 'off' | 'dim' | 'party'; spots: number };
  /** The ids of the map overlays currently patched onto this map. */
  overlays: string[];
  /** The toast banner on screen, or null. Drawn to the canvas, like the dialogue. */
  toast: string | null;
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

/** The toast banner, recorded the same way and for the same reason. */
let toast: string | null = null;

export function noteToast(message: string | null): void {
  toast = message;
}

export function currentToast(): string | null {
  return toast;
}

export interface DebugRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The title screen's list, for the same harness and for the same reason: the
 * words are drawn to the canvas, where nothing outside the game can read them.
 * Each item carries where it sits on the page, in client (CSS) pixels, so a
 * tap can be aimed at it.
 */
export interface DebugTitleItem {
  kind: 'episode' | 'write' | 'forget' | 'credits';
  /** Episode id, or "" for a row that isn't one. */
  id: string;
  label: string;
  /** "Play" / "Continue" / "Play again" — empty unless this item is selected. */
  action: string;
  done: boolean;
  /** The world's word for a finished episode, as drawn — empty on the rest. */
  doneMark: string;
  selected: boolean;
  rect: DebugRect;
  /** "Start over" — this row's secondary action, when it has one (an episode with progress or done). */
  secondary?: string;
  /** Its tap target, when `secondary` is set and this row is selected. */
  secondaryRect?: DebugRect;
  /** True while this row is asking "are you sure?" in place of its usual label/action. */
  confirming?: boolean;
  /** The question being asked, while `confirming`. */
  confirmAsk?: string;
  /** The "Yes" tap target, while `confirming`. */
  yesRect?: DebugRect;
  /** The "Keep it" tap target, while `confirming`. */
  keepRect?: DebugRect;
}

/** One line of the Credits list: who painted a building, or who wrote an episode. */
export interface DebugCreditsLine {
  label: string;
  credit: string;
}

/** One of the Credits screen's own DOM link rows: About this game, Paint a building, Open source on GitHub. */
export interface DebugCreditsLink {
  label: string;
  /** The anchor's resolved `href` (absolute, even when written as a relative URL). */
  href: string;
  rect: DebugRect;
}

/** The Credits list's content, published only while it is open (engine/scenes/title.ts). */
export interface DebugCredits {
  heading: string;
  buildings: DebugCreditsLine[];
  stories: DebugCreditsLine[];
  palette: string;
  licence: string;
  /** Tapping anywhere in here goes back to the episode list. */
  backRect: DebugRect;
  /** About/Paint/Source — only the rows actually shown, in the order they're drawn. */
  links: DebugCreditsLink[];
  /** The visible "Back" row (issue #65 addendum), when the world labels one. */
  back?: { label: string; rect: DebugRect };
}

export interface DebugTitle {
  world: string;
  items: DebugTitleItem[];
  /** Set while the Credits list is open in place of the episode list. */
  credits?: DebugCredits | null;
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
