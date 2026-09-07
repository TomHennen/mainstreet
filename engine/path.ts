import type { Vec2 } from './schema';

/**
 * Tile routing for tap-to-walk. Pure: it knows a start tile and a callback
 * that answers "can the player stand here", and nothing else — no scene, no
 * map, and certainly nothing about any world (CLAUDE.md hard rule 1). The
 * caller decides what walkable means, which is what lets the map scene fold
 * NPCs and the exits it must not wander across into the same question.
 */
export type Walkable = (x: number, y: number) => boolean;

/** Four-neighbour: the player walks the grid, and diagonals cut corners. */
const STEPS: readonly Vec2[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

/** Generous for any hand-authored village, and a runaway search stops rather than hangs. */
const LIMIT = 40000;

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Breadth-first search from `from` to the first tile that satisfies `isGoal`.
 * Returns the whole route including `from`, or null when nothing reachable
 * satisfies it. `from` itself is never asked to be walkable — the player can
 * be standing astride two tiles when they tap — but it is tested against
 * `isGoal`, so a tap on the tile underfoot returns a one-tile route.
 */
export function findPath(from: Vec2, isGoal: (x: number, y: number) => boolean, walkable: Walkable, limit = LIMIT): Vec2[] | null {
  if (isGoal(from[0], from[1])) return [[from[0], from[1]]];

  const prev = new Map<string, Vec2 | null>([[key(from[0], from[1]), null]]);
  const queue: Vec2[] = [[from[0], from[1]]];
  let head = 0;
  let seen = 1;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      if (!walkable(nx, ny)) continue;
      prev.set(k, [cx, cy]);
      if (isGoal(nx, ny)) {
        const route: Vec2[] = [];
        let node: Vec2 | null = [nx, ny];
        while (node) {
          route.unshift(node);
          node = prev.get(key(node[0], node[1])) ?? null;
        }
        return route;
      }
      if (++seen > limit) return null;
      queue.push([nx, ny]);
    }
  }
  return null;
}

/**
 * The route a tap asks for: to `goal` if the player can stand there, and
 * otherwise to the nearest reachable tile beside it — tapping a wall, a
 * counter or somebody's shoes should walk you up to them rather than do
 * nothing. Null when neither is reachable.
 */
export function pathToTile(from: Vec2, goal: Vec2, walkable: Walkable, limit = LIMIT): Vec2[] | null {
  const exact = findPath(from, (x, y) => x === goal[0] && y === goal[1], walkable, limit);
  if (exact) return exact;
  return findPath(from, (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]) === 1, walkable, limit);
}
