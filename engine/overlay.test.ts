import { describe, expect, it } from 'vitest';
import { activeOverlays, canCoOccur, combinations, overlapsIn, patchFor, resolveTile, withOverlays } from './overlay';
import { parseTiledMap } from './tiled';
import { isSolid, moverWalkable } from './validate';
import type { GameMap, MapOverlay } from './schema';

/**
 * Overlays are pure data over a canonical map (engine/overlay.ts), so the whole
 * of "what is standing on the green this week" is testable here: which patches
 * are on, what they paint, and — the point of the exercise — that collision and
 * routing follow them without anything else in the engine being told.
 */

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
      type: 'wall',
      properties: [
        { name: 'colors', type: 'string', value: '#000' },
        { name: 'solid', type: 'bool', value: true },
        { name: 'style', type: 'string', value: 'flat' }
      ]
    }
  ]
};

function makeMap(rows: string[]): GameMap {
  const height = rows.length;
  const width = rows[0].length;
  const grid = parseTiledMap(
    {
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
          data: rows.flatMap((row) => [...row].map((ch) => (ch === '#' ? 2 : 1)))
        }
      ]
    },
    () => undefined,
    'fixture'
  );
  return { name: 'Town', kind: 'village', buildings: [], labels: [], exits: [], ...grid };
}

const OPEN = ['.....', '.....', '.....', '.....', '.....'];

const flags = (set: string[]) => ({
  get: (name: string) => set.includes(name),
  met: (names: string[] | undefined) => (names ?? []).every((name) => set.includes(name))
});

const overlay = (over: Partial<MapOverlay> = {}): MapOverlay => ({
  id: 'flood',
  map: 'town',
  requires: [],
  tiles: [{ pos: [2, 2], tile: 1 }],
  ...over
});

describe('activeOverlays', () => {
  it('keeps only the overlays for this map whose requires are met', () => {
    const list = [
      overlay({ id: 'always' }),
      overlay({ id: 'later', requires: ['damBuilt'] }),
      overlay({ id: 'elsewhere', map: 'other' })
    ];
    expect(activeOverlays(list, 'town', flags([])).map((o) => o.id)).toEqual(['always']);
    expect(activeOverlays(list, 'town', flags(['damBuilt'])).map((o) => o.id)).toEqual(['always', 'later']);
  });

  it('switches one off the moment an unless flag is set', () => {
    const list = [
      overlay({ id: 'flooded', requires: ['damBuilt'], unless: ['damBroken'] }),
      overlay({ id: 'drained', requires: ['damBroken'] })
    ];
    expect(activeOverlays(list, 'town', flags(['damBuilt'])).map((o) => o.id)).toEqual(['flooded']);
    expect(activeOverlays(list, 'town', flags(['damBuilt', 'damBroken'])).map((o) => o.id)).toEqual(['drained']);
  });

  it('keeps the episode\'s own order, which is what decides who paints last', () => {
    const list = [overlay({ id: 'first' }), overlay({ id: 'second' })];
    expect(activeOverlays(list, 'town', flags([])).map((o) => o.id)).toEqual(['first', 'second']);
  });
});

describe('resolveTile', () => {
  const map = makeMap(OPEN);

  it('takes a bare id against the tilesets the map uses', () => {
    expect(resolveTile(map, 1)?.kind).toBe('wall');
    expect(resolveTile(map, 0)?.kind).toBe('grass');
  });

  it('takes a tileset-qualified id', () => {
    expect(resolveTile(map, 'test:1')?.kind).toBe('wall');
  });

  it('returns nothing for a tile no tileset on this map has', () => {
    expect(resolveTile(map, 9)).toBeNull();
    expect(resolveTile(map, 'other:1')).toBeNull();
    expect(resolveTile(map, 'nonsense')).toBeNull();
  });
});

describe('withOverlays', () => {
  it('hands the map straight back when nothing is on', () => {
    const map = makeMap(OPEN);
    expect(withOverlays(map, [])).toBe(map);
  });

  it('makes an overlay tile solid, so collision follows it', () => {
    const map = makeMap(OPEN);
    expect(isSolid(map, 2, 2)).toBe(false);
    const patched = withOverlays(map, [overlay()]);
    expect(isSolid(patched, 2, 2)).toBe(true);
    // And the map underneath is untouched: one canonical map, always.
    expect(isSolid(map, 2, 2)).toBe(false);
  });

  it('lets the later overlay win a tile they both paint', () => {
    const map = makeMap(OPEN);
    const patched = withOverlays(map, [
      overlay({ id: 'wall', tiles: [{ pos: [2, 2], tile: 1 }] }),
      overlay({ id: 'clear', tiles: [{ pos: [2, 2], tile: 0 }] })
    ]);
    expect(isSolid(patched, 2, 2)).toBe(false);
  });

  it('brings its fixtures with it, which routing then walks around', () => {
    const map = makeMap(OPEN);
    const patched = withOverlays(map, [
      overlay({ tiles: [], fixtures: [{ kind: 'suggestion-box', pos: [1, 1] }] })
    ]);
    expect(patched.fixtures).toEqual([{ kind: 'suggestion-box', pos: [1, 1] }]);
    expect(moverWalkable(patched)(1, 1)).toBe(false);
    expect(moverWalkable(map)(1, 1)).toBe(true);
  });

  it('ignores a tile painted outside the map', () => {
    const map = makeMap(OPEN);
    const patch = patchFor(map, [overlay({ tiles: [{ pos: [99, 99], tile: 1 }] })]);
    expect(patch.cells.size).toBe(0);
  });

  it('reports a tile no tileset has rather than painting nothing quietly', () => {
    const map = makeMap(OPEN);
    const patch = patchFor(map, [overlay({ tiles: [{ pos: [1, 1], tile: 42 }] })]);
    expect(patch.unknown).toEqual([{ overlay: 'flood', pos: [1, 1], tile: 42 }]);
  });
});

describe('deconfliction', () => {
  it('knows a before and an after can never be on together', () => {
    const flooded = overlay({ id: 'flooded', requires: ['damBuilt'], unless: ['damBroken'] });
    const drained = overlay({ id: 'drained', requires: ['damBroken'] });
    expect(canCoOccur([flooded, drained])).toBe(false);
    expect(canCoOccur([flooded, overlay({ id: 'festival' })])).toBe(true);
  });

  it('lists every set that could be on together, the plain map included', () => {
    const a = overlay({ id: 'a', requires: ['x'], unless: ['y'] });
    const b = overlay({ id: 'b', requires: ['y'] });
    const sets = combinations([a, b]).map((set) => set.map((o) => o.id).join('+'));
    expect(sets).toEqual(['', 'a', 'b']);
  });

  it('reports the tiles two overlays both paint', () => {
    const a = overlay({ id: 'a', tiles: [{ pos: [1, 1], tile: 1 }, { pos: [2, 2], tile: 1 }] });
    const b = overlay({ id: 'b', tiles: [{ pos: [2, 2], tile: 0 }] });
    expect(overlapsIn([a, b])).toEqual([{ pos: [2, 2], ids: ['a', 'b'] }]);
    expect(overlapsIn([a])).toEqual([]);
  });
});
