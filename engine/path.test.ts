import { describe, expect, it } from 'vitest';
import { findPath, pathToTile } from './path';
import type { Vec2 } from './schema';

/**
 * Grids are written as rows of characters so the obstacle is visible in the
 * test: '.' is walkable, '#' is not. Everything off the grid is solid.
 */
function grid(rows: string[]) {
  return (x: number, y: number): boolean => {
    if (y < 0 || y >= rows.length) return false;
    if (x < 0 || x >= rows[y].length) return false;
    return rows[y][x] === '.';
  };
}

const open = grid(['.....', '.....', '.....', '.....', '.....']);

const steps = (route: Vec2[] | null): number => (route ? route.length - 1 : -1);

/** Every leg of a route has to be one orthogonal step onto a walkable tile. */
function isContinuous(route: Vec2[], walkable: (x: number, y: number) => boolean): boolean {
  for (let i = 1; i < route.length; i++) {
    const dx = Math.abs(route[i][0] - route[i - 1][0]);
    const dy = Math.abs(route[i][1] - route[i - 1][1]);
    if (dx + dy !== 1) return false;
    if (!walkable(route[i][0], route[i][1])) return false;
  }
  return true;
}

describe('findPath', () => {
  it('walks a straight line down an open row', () => {
    const route = findPath([0, 2], (x, y) => x === 4 && y === 2, open);
    expect(route).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2]
    ]);
  });

  it('returns the start alone when it is already the goal', () => {
    expect(findPath([2, 2], (x, y) => x === 2 && y === 2, open)).toEqual([[2, 2]]);
  });

  it('finds the start even when the start tile itself is not walkable', () => {
    // The player can be astride two tiles when they tap, so the start is never
    // asked to be walkable.
    const walls = grid(['###', '###', '###']);
    expect(findPath([1, 1], (x, y) => x === 1 && y === 1, walls)).toEqual([[1, 1]]);
  });

  it('goes around an obstacle rather than through it', () => {
    const walled = grid(['.....', '..#..', '..#..', '..#..', '.....']);
    const route = findPath([0, 2], (x, y) => x === 4 && y === 2, walled);
    expect(route).not.toBeNull();
    expect(isContinuous(route!, walled)).toBe(true);
    expect(route![0]).toEqual([0, 2]);
    expect(route![route!.length - 1]).toEqual([4, 2]);
    // Four along and four around the wall, whichever end it goes past.
    expect(steps(route)).toBe(8);
    expect(route!.some(([x, y]) => x === 2 && y >= 1 && y <= 3)).toBe(false);
  });

  it('takes the shortest of several routes', () => {
    const walled = grid(['.....', '.###.', '.....']);
    expect(steps(findPath([0, 0], (x, y) => x === 4 && y === 0, walled))).toBe(4);
  });

  it('returns null when the goal is walled off', () => {
    const sealed = grid(['.....', '#####', '.....']);
    expect(findPath([0, 0], (x, y) => x === 0 && y === 2, sealed)).toBeNull();
  });

  it('returns null when nothing satisfies the goal at all', () => {
    expect(findPath([0, 0], () => false, open)).toBeNull();
  });

  it('accepts a goal given as a reach, which is how a shopkeeper is walked up to', () => {
    // '@' stands behind a counter with no free tile beside her, so the route
    // has to stop at the nearest tile she can still be spoken to from.
    const shop = grid(['.....', '..@..', '.###.', '.....', '.....']);
    const reach = 2.3;
    const route = findPath([4, 4], (x, y) => Math.hypot(x - 2, y - 1) <= reach, shop);
    expect(route).not.toBeNull();
    const end = route![route!.length - 1];
    expect(Math.hypot(end[0] - 2, end[1] - 1)).toBeLessThanOrEqual(reach);
    expect(shop(end[0], end[1])).toBe(true);
  });

  it('stops at the search limit instead of running away', () => {
    const endless = () => true;
    expect(findPath([0, 0], (x) => x === 500, endless, 50)).toBeNull();
  });
});

describe('pathToTile', () => {
  it('walks onto the goal when the goal can be stood on', () => {
    expect(pathToTile([0, 0], [0, 2], open)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2]
    ]);
  });

  it('falls back to the nearest tile beside a blocked goal', () => {
    const walled = grid(['.....', '.....', '..#..', '.....', '.....']);
    const route = pathToTile([2, 0], [2, 2], walled);
    expect(route).not.toBeNull();
    // Straight down the column and stop on the tile above the obstacle.
    expect(route![route!.length - 1]).toEqual([2, 1]);
    expect(isContinuous(route!, walled)).toBe(true);
  });

  it('picks the side of a blocked goal the player is coming from', () => {
    const walled = grid(['.....', '.....', '..#..', '.....', '.....']);
    // Same obstacle, approached from below: the route stops short of it on the
    // near side rather than walking round to a further neighbour.
    expect(pathToTile([2, 4], [2, 2], walled)).toEqual([
      [2, 4],
      [2, 3]
    ]);
  });

  it('returns null when neither the goal nor anything beside it is reachable', () => {
    const sealed = grid(['...', '###', '.#.']);
    expect(pathToTile([0, 0], [2, 2], sealed)).toBeNull();
  });

  it('returns the start alone when the player taps the tile they are on', () => {
    expect(pathToTile([3, 3], [3, 3], open)).toEqual([[3, 3]]);
  });
});
