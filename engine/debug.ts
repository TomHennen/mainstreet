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
