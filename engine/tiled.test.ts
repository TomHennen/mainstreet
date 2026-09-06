import { describe, expect, it } from 'vitest';
import { parseTiledMap, parseTileset, TILE, tileAt, tilesetSources } from './tiled';
import type { TilesetDef } from './tiled';

/**
 * The Tiled conventions the engine relies on (DESIGN.md §2). These are the
 * rules a world pack has to keep for its maps to load at all, so each one gets
 * a test that the error message is the one an author would need.
 */

function tilesetJson(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tileset',
    name: 'test',
    image: 'test.png',
    tilewidth: 16,
    tileheight: 16,
    columns: 2,
    tilecount: 4,
    imagewidth: 32,
    imageheight: 32,
    tiles: [
      {
        id: 0,
        type: 'grass',
        properties: [
          { name: 'colors', type: 'string', value: '#5e8c50,#578349' },
          { name: 'solid', type: 'bool', value: false },
          { name: 'style', type: 'string', value: 'flat' }
        ]
      },
      {
        id: 3,
        type: 'water',
        properties: [
          { name: 'base', type: 'string', value: '#4a7f96' },
          { name: 'colors', type: 'string', value: '#5d93a8' },
          { name: 'solid', type: 'bool', value: true },
          { name: 'style', type: 'string', value: 'ripple' }
        ]
      }
    ],
    ...overrides
  };
}

function mapJson(overrides: Record<string, unknown> = {}) {
  return {
    type: 'map',
    orientation: 'orthogonal',
    infinite: false,
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, source: '../assets/tiles/test.json' }],
    layers: [
      {
        type: 'tilelayer',
        name: 'ground',
        visible: true,
        width: 2,
        height: 2,
        data: [1, 4, 4, 1]
      }
    ],
    ...overrides
  };
}

const tileset = () => parseTileset(tilesetJson(), 'test.json');
const resolver = (set: TilesetDef = tileset()) => (source: string) =>
  source === '../assets/tiles/test.json' ? set : undefined;
const parse = (overrides: Record<string, unknown> = {}, set?: TilesetDef) =>
  parseTiledMap(mapJson(overrides), resolver(set), 'town.json');

describe('parseTileset', () => {
  it('reads a tile’s class, style, colours and solidity out of Tiled properties', () => {
    const water = tileset().tiles.get(3);
    expect(water).toMatchObject({
      kind: 'water',
      style: 'ripple',
      base: '#4a7f96',
      colors: ['#5d93a8'],
      solid: true,
      tileset: 'test',
      id: 3
    });
  });

  it('places each tile in the tileset image by its id, columns, margin and spacing', () => {
    const plain = tileset();
    expect(plain.tiles.get(0)).toMatchObject({ sx: 0, sy: 0 });
    // id 3 with 2 columns is column 1 of row 1.
    expect(plain.tiles.get(3)).toMatchObject({ sx: TILE, sy: TILE });

    const padded = parseTileset(tilesetJson({ margin: 2, spacing: 1 }), 'test.json');
    expect(padded.tiles.get(3)).toMatchObject({ sx: 2 + TILE + 1, sy: 2 + TILE + 1 });
  });

  it('defaults solid to false when the property is absent', () => {
    const raw = tilesetJson();
    raw.tiles[0].properties = [
      { name: 'colors', type: 'string', value: '#0f0' },
      { name: 'style', type: 'string', value: 'flat' }
    ];
    expect(parseTileset(raw, 'test.json').tiles.get(0)?.solid).toBe(false);
  });

  it('rejects a tile with no style', () => {
    const raw = tilesetJson();
    raw.tiles[0].properties = [{ name: 'colors', type: 'string', value: '#0f0' }];
    expect(() => parseTileset(raw, 'test.json')).toThrow(/"style" must be a non-empty string/);
  });

  it('rejects a style the engine cannot draw', () => {
    const raw = tilesetJson();
    raw.tiles[0].properties = [
      { name: 'colors', type: 'string', value: '#0f0' },
      { name: 'style', type: 'string', value: 'hexagon' }
    ];
    expect(() => parseTileset(raw, 'test.json')).toThrow(/unknown style "hexagon"/);
  });

  it('rejects a tileset that is not on the engine’s 16px grid', () => {
    expect(() => parseTileset(tilesetJson({ tilewidth: 32, tileheight: 32 }), 'test.json')).toThrow(
      /the engine's grid is 16×16/
    );
  });

  it('rejects a tile id outside the tileset', () => {
    const raw = tilesetJson({ tilecount: 2 });
    expect(() => parseTileset(raw, 'test.json')).toThrow(/tile id 3 is outside/);
  });
});

describe('parseTiledMap', () => {
  it('turns gids into tile definitions, row-major, with firstgid subtracted', () => {
    const grid = parse();
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(grid.layers).toHaveLength(1);
    expect(grid.layers[0].name).toBe('ground');
    expect(grid.layers[0].cells.map((cell) => cell?.kind)).toEqual(['grass', 'water', 'water', 'grass']);
  });

  it('reports which tilesets the map actually uses', () => {
    expect(parse().tilesets.map((set) => set.name)).toEqual(['test']);
  });

  it('masks the flip and rotation bits Tiled packs into a gid', () => {
    // Tiled writes the flags unsigned: 0x80000000 is "flipped horizontally",
    // so this cell is still gid 1.
    const grid = parse({ layers: [{ ...mapJson().layers[0], data: [1 + 0x80000000, 4, 4, 1] }] });
    expect(grid.layers[0].cells[0]?.kind).toBe('grass');
  });

  it('treats gid 0 as an empty cell', () => {
    const grid = parse({ layers: [{ ...mapJson().layers[0], data: [0, 4, 4, 1] }] });
    expect(grid.layers[0].cells[0]).toBeNull();
  });

  it('reads every visible tile layer, in file order, and skips hidden ones', () => {
    const base = mapJson().layers[0];
    const grid = parse({
      layers: [
        base,
        { ...base, name: 'overlay', data: [0, 0, 0, 4] },
        { ...base, name: 'notes', visible: false, data: [4, 4, 4, 4] }
      ]
    });
    expect(grid.layers.map((layer) => layer.name)).toEqual(['ground', 'overlay']);
    // tileAt reads topmost-first, so the overlay wins where it is not empty.
    expect(tileAt(grid, 1, 1)?.kind).toBe('water');
    expect(tileAt(grid, 0, 0)?.kind).toBe('grass');
  });

  it('descends into layer groups', () => {
    const base = mapJson().layers[0];
    const grid = parse({ layers: [{ type: 'group', name: 'terrain', layers: [base] }] });
    expect(grid.layers.map((layer) => layer.name)).toEqual(['ground']);
  });

  it('ignores object layers — gameplay positions live in world.json', () => {
    const grid = parse({
      layers: [
        mapJson().layers[0],
        { type: 'objectgroup', name: 'exits', objects: [{ id: 1, x: 0, y: 0, width: 16, height: 16 }] }
      ]
    });
    expect(grid.layers.map((layer) => layer.name)).toEqual(['ground']);
  });

  it('requires a visible tile layer named "ground"', () => {
    const base = mapJson().layers[0];
    expect(() => parse({ layers: [{ ...base, name: 'terrain' }] })).toThrow(/no visible tile layer named "ground"/);
    expect(() => parse({ layers: [{ ...base, visible: false }] })).toThrow(/no visible tile layer named "ground"/);
  });

  it('rejects a layer whose data is the wrong length', () => {
    const base = mapJson().layers[0];
    expect(() => parse({ layers: [{ ...base, data: [1, 4, 4] }] })).toThrow(
      /layer "ground" holds 3 tiles, expected 4 \(2×2\)/
    );
  });

  it('rejects a gid with no properties in its tileset', () => {
    // gid 2 is tile id 1, which the fixture tileset leaves undefined.
    const base = mapJson().layers[0];
    expect(() => parse({ layers: [{ ...base, data: [2, 4, 4, 1] }] })).toThrow(
      /has no properties for tile 1/
    );
  });

  it('rejects base64 layer data', () => {
    const base = mapJson().layers[0];
    expect(() => parse({ layers: [{ ...base, encoding: 'base64', data: 'AQAAAA==' }] })).toThrow(
      /re-export it with CSV\/uncompressed layer data/
    );
  });

  it('rejects an unresolved external tileset', () => {
    expect(() => parseTiledMap(mapJson(), () => undefined, 'town.json')).toThrow(
      /tileset "..\/assets\/tiles\/test.json" could not be loaded/
    );
  });

  it('accepts an embedded tileset too', () => {
    const grid = parseTiledMap(
      mapJson({ tilesets: [{ firstgid: 1, ...tilesetJson() }] }),
      () => undefined,
      'town.json'
    );
    expect(grid.layers[0].cells[0]?.kind).toBe('grass');
  });

  it('picks the right tileset when a map uses several', () => {
    const second = parseTileset(tilesetJson({ name: 'other' }), 'other.json');
    const grid = parseTiledMap(
      mapJson({
        tilesets: [
          { firstgid: 1, source: '../assets/tiles/test.json' },
          { firstgid: 5, ...tilesetJson({ name: 'other' }) }
        ],
        layers: [{ ...mapJson().layers[0], data: [1, 5, 8, 4] }]
      }),
      resolver(),
      'town.json'
    );
    expect(grid.layers[0].cells.map((cell) => cell?.tileset)).toEqual(['test', 'other', 'other', 'test']);
    expect(grid.tilesets.map((set) => set.name)).toEqual(['test', 'other']);
    expect(second.name).toBe('other');
  });

  it('rejects a map that is not orthogonal, or is infinite', () => {
    expect(() => parse({ orientation: 'isometric' })).toThrow(/only draws orthogonal maps/);
    expect(() => parse({ infinite: true })).toThrow(/infinite maps are not supported/);
  });

  it('rejects a map that is not on the engine’s 16px grid', () => {
    expect(() => parse({ tilewidth: 32, tileheight: 32 })).toThrow(/the engine's grid is 16×16/);
  });

  it('rejects a map with no tilesets', () => {
    expect(() => parse({ tilesets: [] })).toThrow(/references no tilesets/);
  });

  it('rejects a file that is not JSON object shaped', () => {
    expect(() => parseTiledMap([], () => undefined, 'town.json')).toThrow(/not a JSON object/);
  });
});

describe('tilesetSources', () => {
  it('lists the external tilesets a map file references, as written', () => {
    expect(tilesetSources(mapJson(), 'town.json')).toEqual(['../assets/tiles/test.json']);
  });

  it('skips embedded tilesets, which need no fetch', () => {
    expect(tilesetSources(mapJson({ tilesets: [{ firstgid: 1, ...tilesetJson() }] }), 'town.json')).toEqual([]);
  });
});

describe('tileAt', () => {
  it('is null outside the grid', () => {
    const grid = parse();
    expect(tileAt(grid, -1, 0)).toBeNull();
    expect(tileAt(grid, 0, 2)).toBeNull();
  });
});
