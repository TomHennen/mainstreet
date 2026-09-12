import { describe, expect, it } from 'vitest';
import { edgeAt, lostAt, nearRect, pickByPosition, rectsOverlap, roadEndLine } from './edges';
import { parseTiledMap } from './tiled';
import type { GameMap, MapEdge, MapLost } from './schema';

// A tiny two-tile tileset — grass (walkable) and road (walkable) — enough to
// tell `roadEndLine` a road tile from bare ground without pulling in the real
// route10 tileset.
const TILESET = {
  type: 'tileset',
  name: 'test',
  image: 'test.png',
  tilewidth: 16,
  tileheight: 16,
  columns: 2,
  tilecount: 2,
  imagewidth: 32,
  imageheight: 16,
  tiles: [
    {
      id: 0,
      type: 'grass',
      properties: [
        { name: 'colors', type: 'string', value: '#0f0' },
        { name: 'solid', type: 'bool', value: false },
        { name: 'style', type: 'string', value: 'flat' }
      ]
    },
    {
      id: 1,
      type: 'road',
      properties: [
        { name: 'colors', type: 'string', value: '#888' },
        { name: 'solid', type: 'bool', value: false },
        { name: 'style', type: 'string', value: 'flat' }
      ]
    }
  ]
};

/** `.` grass, `r` road — a single `ground` layer, as the engine expects. */
function makeMap(rows: string[]): GameMap {
  const height = rows.length;
  const width = height ? rows[0].length : 0;
  const raw = {
    type: 'map',
    orientation: 'orthogonal',
    infinite: false,
    width,
    height,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, ...TILESET }],
    layers: [
      {
        type: 'tilelayer',
        name: 'ground',
        visible: true,
        width,
        height,
        data: rows.flatMap((row) => [...row].map((ch) => (ch === 'r' ? 2 : 1)))
      }
    ]
  };
  const grid = parseTiledMap(raw, () => undefined, 'fixture');
  return { name: 'Town', kind: 'village', buildings: [], labels: [], exits: [], ...grid };
}

describe('rectsOverlap', () => {
  it('is false for rectangles that do not touch', () => {
    expect(rectsOverlap([0, 0, 2, 2], [5, 5, 2, 2])).toBe(false);
  });

  it('is true for rectangles that share a tile', () => {
    expect(rectsOverlap([0, 0, 2, 2], [1, 1, 2, 2])).toBe(true);
  });

  it('is false for rectangles that only touch at an edge', () => {
    expect(rectsOverlap([0, 0, 2, 2], [2, 0, 2, 2])).toBe(false);
  });
});

describe('nearRect', () => {
  const rect: [number, number, number, number] = [5, 5, 2, 2];

  it('is true inside the rectangle itself', () => {
    expect(nearRect(rect, 5, 5, 1)).toBe(true);
    expect(nearRect(rect, 6, 6, 1)).toBe(true);
  });

  it('is true one tile out with margin 1, including the corners', () => {
    expect(nearRect(rect, 4, 5, 1)).toBe(true);
    expect(nearRect(rect, 7, 5, 1)).toBe(true);
    expect(nearRect(rect, 5, 4, 1)).toBe(true);
    expect(nearRect(rect, 5, 7, 1)).toBe(true);
    expect(nearRect(rect, 4, 4, 1)).toBe(true);
  });

  it('is false two tiles out with margin 1', () => {
    expect(nearRect(rect, 3, 5, 1)).toBe(false);
    expect(nearRect(rect, 8, 5, 1)).toBe(false);
    expect(nearRect(rect, 5, 3, 1)).toBe(false);
  });

  it('with margin 0 matches only the rectangle itself, same as `within`', () => {
    expect(nearRect(rect, 4, 5, 0)).toBe(false);
    expect(nearRect(rect, 5, 5, 0)).toBe(true);
  });
});

describe('edgeAt', () => {
  const edge: MapEdge = { id: 'north-road', at: [1, 0, 2, 1], lines: ['On it goes.'] };
  const map = { ...makeMap(['rrrr', 'rrrr']), edges: [edge] };

  it('finds the edge whose rectangle covers the tile', () => {
    expect(edgeAt(map, 1, 0)).toBe(edge);
    expect(edgeAt(map, 2, 0)).toBe(edge);
  });

  it('finds nothing outside the rectangle', () => {
    expect(edgeAt(map, 0, 0)).toBeUndefined();
    expect(edgeAt(map, 1, 1)).toBeUndefined();
  });

  it('finds nothing on a map with no edges at all', () => {
    expect(edgeAt(makeMap(['rrrr']), 0, 0)).toBeUndefined();
  });
});

describe('pickByPosition', () => {
  it('is undefined for an empty list', () => {
    expect(pickByPosition(0, 0, [])).toBeUndefined();
  });

  it('always picks the only line there is', () => {
    expect(pickByPosition(3, 7, ['only one'])).toBe('only one');
    expect(pickByPosition(99, 4, ['only one'])).toBe('only one');
  });

  it('picks the same line for the same tile every time', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const first = pickByPosition(12, 5, lines);
    const second = pickByPosition(12, 5, lines);
    expect(first).toBe(second);
  });

  it('spreads across the list rather than always landing on the first entry', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const seen = new Set<string | undefined>();
    for (let x = 0; x < 20; x++) seen.add(pickByPosition(x, 0, lines));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('roadEndLine', () => {
  const lines = ['The road stops here.', 'Not today.'];

  it('is undefined with no lines to pick from', () => {
    const map = makeMap(['rrrr']);
    expect(roadEndLine(map, 0, 0, undefined)).toBeUndefined();
    expect(roadEndLine(map, 0, 0, [])).toBeUndefined();
  });

  it('is undefined off the map boundary, even on a road tile', () => {
    const map = makeMap(['rrrr', 'rrrr', 'rrrr']);
    expect(roadEndLine(map, 1, 1, lines)).toBeUndefined();
  });

  it('is undefined on grass at the boundary', () => {
    const map = makeMap(['....', '....']);
    expect(roadEndLine(map, 0, 0, lines)).toBeUndefined();
  });

  it('picks a line for a road tile at the boundary', () => {
    const map = makeMap(['rrrr', 'rrrr']);
    expect(lines).toContain(roadEndLine(map, 0, 0, lines));
    expect(lines).toContain(roadEndLine(map, map.width - 1, 0, lines));
    expect(lines).toContain(roadEndLine(map, 0, map.height - 1, lines));
  });
});

describe('lostAt', () => {
  const lost: MapLost = { lines: ['You got turned around.'], to: 'town', spawn: [1, 1], facing: 'up' };
  const woods = (rows: string[], extra: Partial<GameMap> = {}): GameMap => ({ ...makeMap(rows), lost, ...extra });

  it('is the map\'s lost entry on grass at the boundary', () => {
    const map = woods(['....', '....', '....']);
    expect(lostAt(map, 0, 0)).toBe(lost);
    expect(lostAt(map, 2, 0)).toBe(lost);
    expect(lostAt(map, 0, 1)).toBe(lost);
    expect(lostAt(map, map.width - 1, 1)).toBe(lost);
    expect(lostAt(map, 1, map.height - 1)).toBe(lost);
  });

  it('is undefined on grass inside the map', () => {
    const map = woods(['....', '....', '....']);
    expect(lostAt(map, 1, 1)).toBeUndefined();
    expect(lostAt(map, 2, 1)).toBeUndefined();
  });

  it('is undefined on a road at the boundary — that is a road end, not the woods', () => {
    const map = woods(['r...', '....']);
    expect(lostAt(map, 0, 0)).toBeUndefined();
    expect(lostAt(map, 1, 0)).toBe(lost);
  });

  it('is undefined where an exit or an edge already stands', () => {
    const map = woods(['......', '......'], {
      exits: [{ id: 'away', at: [0, 0, 2, 1], to: 'town', spawn: [1, 1], facing: 'up', style: 'road' }],
      edges: [{ id: 'north-road', at: [3, 0, 1, 1], lines: ['On it goes.'] }]
    });
    expect(lostAt(map, 0, 0)).toBeUndefined();
    expect(lostAt(map, 1, 0)).toBeUndefined();
    expect(lostAt(map, 3, 0)).toBeUndefined();
  });

  it('is undefined a tile adjacent to an exit or an edge — that is the road\'s shoulder, not the woods', () => {
    const map = woods(['......', '......'], {
      exits: [{ id: 'away', at: [0, 0, 2, 1], to: 'town', spawn: [1, 1], facing: 'up', style: 'road' }],
      edges: [{ id: 'north-road', at: [3, 0, 1, 1], lines: ['On it goes.'] }]
    });
    // One tile out from the exit (which ends at x=1) and from the edge (at x=3).
    expect(lostAt(map, 2, 0)).toBeUndefined();
    expect(lostAt(map, 4, 0)).toBeUndefined();
  });

  it('is the map\'s lost entry two tiles from an exit or an edge', () => {
    const map = woods(['......', '......'], {
      exits: [{ id: 'away', at: [0, 0, 2, 1], to: 'town', spawn: [1, 1], facing: 'up', style: 'road' }],
      edges: [{ id: 'north-road', at: [3, 0, 1, 1], lines: ['On it goes.'] }]
    });
    expect(lostAt(map, 5, 0)).toBe(lost);
  });

  it('is undefined on a map with no lost entry at all', () => {
    expect(lostAt(makeMap(['....', '....']), 0, 0)).toBeUndefined();
  });

  it('is undefined off the map', () => {
    expect(lostAt(woods(['....']), -1, 0)).toBeUndefined();
    expect(lostAt(woods(['....']), 4, 0)).toBeUndefined();
  });
});
