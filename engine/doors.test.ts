import { describe, expect, it } from 'vitest';
import { DOOR_PRESS_MS, doorPressAdvance } from './doors';

describe('doorPressAdvance', () => {
  it('opens once the count reaches the threshold, and resets it', () => {
    const short = doorPressAdvance(true, true, true, DOOR_PRESS_MS - 1, 0);
    expect(short).toEqual({ ms: DOOR_PRESS_MS - 1, open: false });
    const long = doorPressAdvance(true, true, true, 1, DOOR_PRESS_MS - 1);
    expect(long).toEqual({ ms: 0, open: true });
  });

  it('accumulates across calls while all three keep holding, then opens', () => {
    let ms = 0;
    for (let i = 0; i < 2; i++) {
      const result = doorPressAdvance(true, true, true, 60, ms);
      expect(result.open).toBe(false);
      ms = result.ms;
    }
    expect(ms).toBe(120);
    // The tick that reaches the threshold opens it, and resets the count.
    expect(doorPressAdvance(true, true, true, 60, ms)).toEqual({ ms: 0, open: true });
  });

  // The diagonal-slide case: SPEED=102 means 72px/s on each axis of a
  // diagonal, so crossing a door's tile with "up" and a side both held takes
  // longer than a straight approach — but the player is still moving the
  // whole time, never actually stuck, so no amount of holding ever counts.
  it('never accumulates while the player keeps moving — a diagonal slide past the door', () => {
    let ms = 0;
    for (let i = 0; i < 10; i++) {
      const result = doorPressAdvance(true, true, false, 60, ms);
      expect(result).toEqual({ ms: 0, open: false });
      ms = result.ms;
    }
  });

  // The doorstep-disarm case: fresh out of this very door, "up" held across
  // the transition — armEnters keeps the door quiet no matter how long the
  // player stands there pressed against it.
  it('never accumulates while disarmed — the doorstep just left', () => {
    let ms = 0;
    for (let i = 0; i < 10; i++) {
      const result = doorPressAdvance(false, true, true, 60, ms);
      expect(result).toEqual({ ms: 0, open: false });
      ms = result.ms;
    }
  });

  it('resets on a released "up", not just on a fresh door', () => {
    const held = doorPressAdvance(true, true, true, 100, 0);
    expect(held.open).toBe(false);
    const released = doorPressAdvance(true, false, true, 60, held.ms);
    expect(released).toEqual({ ms: 0, open: false });
  });

  it('honours a custom threshold', () => {
    expect(doorPressAdvance(true, true, true, 50, 40, 100)).toEqual({ ms: 90, open: false });
    expect(doorPressAdvance(true, true, true, 60, 40, 100)).toEqual({ ms: 0, open: true });
  });
});
