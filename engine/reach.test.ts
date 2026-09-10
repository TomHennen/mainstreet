import { describe, expect, it } from 'vitest';
import { clearBetween, offsetsWithin, REACH } from './reach';

type Tile = [number, number];
const opaqueAt =
  (...tiles: Tile[]) =>
  (x: number, y: number) =>
    tiles.some(([tx, ty]) => tx === x && ty === y);
const nothing = () => false;
const everything = () => true;

describe('clearBetween', () => {
  it('is clear along a straight line with nothing opaque on it', () => {
    expect(clearBetween([0, 0], [4, 0], nothing)).toBe(true);
    expect(clearBetween([0, 0], [0, 4], nothing)).toBe(true);
    // Something opaque off the line does not count.
    expect(clearBetween([0, 0], [4, 0], opaqueAt([2, 1]))).toBe(true);
  });

  it('is blocked by an opaque tile one or two tiles along a straight line', () => {
    expect(clearBetween([0, 0], [0, 2], opaqueAt([0, 1]))).toBe(false);
    expect(clearBetween([0, 0], [0, 3], opaqueAt([0, 2]))).toBe(false);
    expect(clearBetween([3, 5], [0, 5], opaqueAt([1, 5]))).toBe(false);
    // Read the other way round it is the same wall.
    expect(clearBetween([0, 2], [0, 0], opaqueAt([0, 1]))).toBe(false);
  });

  it('follows a diagonal', () => {
    expect(clearBetween([0, 0], [2, 2], nothing)).toBe(true);
    expect(clearBetween([0, 0], [2, 2], opaqueAt([1, 1]))).toBe(false);
    expect(clearBetween([2, 0], [0, 2], opaqueAt([1, 1]))).toBe(false);
    // The corners the diagonal skips past are not on it.
    expect(clearBetween([0, 0], [2, 2], opaqueAt([1, 0], [0, 1], [2, 1], [1, 2]))).toBe(true);
  });

  it('always clears neighbours, diagonal ones included, and a tile from itself', () => {
    expect(clearBetween([0, 0], [1, 0], everything)).toBe(true);
    expect(clearBetween([0, 0], [0, -1], everything)).toBe(true);
    expect(clearBetween([0, 0], [1, 1], everything)).toBe(true);
    expect(clearBetween([3, 3], [3, 3], everything)).toBe(true);
  });

  it('leaves both endpoints out, so a sign on a wall is read from two tiles off it', () => {
    // A shelf on an opaque wall read from across the counter: the wall tile is
    // the sign's own, and the player's tile is never in the way of itself.
    expect(clearBetween([0, 2], [0, 0], opaqueAt([0, 0], [0, 2]))).toBe(true);
    expect(clearBetween([0, 0], [0, 2], opaqueAt([0, 0], [0, 2]))).toBe(true);
    // ...but a wall between still blocks.
    expect(clearBetween([0, 0], [0, 2], opaqueAt([0, 0], [0, 1], [0, 2]))).toBe(false);
  });

  it('agrees with the reach table: every offset a prop is read from is clear when nothing is opaque', () => {
    for (const [dx, dy] of offsetsWithin(REACH.prop)) {
      expect(clearBetween([5, 5], [5 + dx, 5 + dy], nothing)).toBe(true);
    }
  });
});
