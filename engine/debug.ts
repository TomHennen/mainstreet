import type { Facing } from './schema';

/**
 * Dev-only read-only snapshot for the headless playtest harness
 * (`scripts/playtest.mjs`). It describes engine state only — nothing here is
 * world-specific — and it is stripped from production builds by the
 * `import.meta.env.DEV` guard at the call site.
 */
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
  flags: Record<string, boolean>;
}

declare global {
  interface Window {
    __mainstreet?: DebugSnapshot;
  }
}

export function publishDebug(snapshot: DebugSnapshot): void {
  window.__mainstreet = snapshot;
}
