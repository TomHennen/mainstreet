/**
 * The pure decision behind "walking into a door" opening it (DESIGN.md §2,
 * `MapScene.checkDoors`) — kept apart from the scene, like `engine/edges.ts`
 * keeps road ends apart from it, so the two cases that made this take three
 * tries to get right can be pinned down without a running game:
 *
 * - A diagonal step only ever clips a door's tile in passing. Held the whole
 *   way across, it still keeps inching forward on at least one axis, so it
 *   is never actually `stuck` — unlike a straight "up" into the solid wall
 *   behind the door, which really does stop the player dead.
 * - A doorstep a player was just dropped on (leaving the very same door) is
 *   disarmed on purpose (`armEnters`), so holding "up" against it does not
 *   walk straight back in.
 */

/** How long a held "up," genuinely stuck against a door, has to keep leaning
 *  into it before it opens — long enough that the single tile a diagonal
 *  step might clip past a doorstep never adds up to it (that step is never
 *  `stuck` at all), short enough that actually walking into one never feels
 *  like a wait. */
export const DOOR_PRESS_MS = 180;

export interface DoorPress {
  /** Milliseconds counted so far against this door — 0 once it opens, or
   *  the moment any of `armed`/`heldUp`/`stuck` stops holding. */
  ms: number;
  /** True on the one call that crosses `thresholdMs` — open the door. */
  open: boolean;
}

/**
 * `armed` is the doorstep guard (`armEnters`), `heldUp` is this frame's own
 * held direction, and `stuck` is what actually happened to the player's
 * position this frame: pinned exactly where it was, on both axes, which a
 * real "up" into a solid wall gives every single frame it stays blocked, and
 * a diagonal slide past the same tile never does. All three have to hold at
 * once for the count to advance; any one going false resets it to zero,
 * whether that is a fresh door, a released key, or a step that actually
 * went somewhere. Reaching `thresholdMs` opens the door and resets the count
 * for whatever comes next.
 */
export function doorPressAdvance(
  armed: boolean,
  heldUp: boolean,
  stuck: boolean,
  delta: number,
  ms: number,
  thresholdMs: number = DOOR_PRESS_MS
): DoorPress {
  if (!armed || !heldUp || !stuck) return { ms: 0, open: false };
  const next = ms + delta;
  if (next >= thresholdMs) return { ms: 0, open: true };
  return { ms: next, open: false };
}
