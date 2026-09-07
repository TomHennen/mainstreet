import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTiledMap, parseTileset, tilesetSources } from './tiled';
import type { TilesetDef } from './tiled';
import { isSolid, validateEpisode, validateWorld } from './validate';
import { plaqueTile } from './schema';
import type { BuildingPlacement, Episode, Fixture, GameMap, MapMeta, World } from './schema';

// --- small fixture builders --------------------------------------------------
// Kept deliberately minimal — just enough to satisfy the schema — so each test
// only sets the one thing it's actually exercising. Tile grids come from the
// same Tiled parser the engine uses, off a two-tile stand-in tileset, so a rule
// tested here is tested against real map data.

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

/** `.` walkable, `#` solid — one `ground` layer, as the engine expects. */
function tiledMap(rows: string[]) {
  const height = rows.length;
  const width = height ? rows[0].length : 0;
  return {
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
  };
}

const grid = (rows: string[]) => parseTiledMap(tiledMap(rows), () => undefined, 'fixture');

function makeMap(overrides: Partial<MapMeta> = {}, rows = ['....', '....', '....', '....']): GameMap {
  return {
    name: 'Town',
    kind: 'village',
    buildings: [],
    labels: [],
    exits: [],
    ...overrides,
    ...grid(rows)
  };
}

function makeWorld(overrides: Partial<World> = {}): World {
  return {
    id: 'testworld',
    title: 'Test World',
    episodes: ['ep000'],
    player: { id: 'player', accent: '#fff' },
    start: { map: 'town', pos: [1, 1], facing: 'down' },
    buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000' } },
    maps: { town: makeMap() },
    ...overrides
  };
}

/**
 * The validators are pure: they take the loaded grids alongside the world. In
 * these fixtures the world's own map objects already are the loaded grids, so
 * the two arguments come from one place.
 */
const grids = (world: World) => world.maps as Record<string, GameMap>;
const runWorld = (world: World) => validateWorld(world, grids(world));
const runEpisode = (episode: Episode, world: World) => validateEpisode(episode, world, grids(world));

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep000',
    title: 'Test Episode',
    flags: ['metNpc', 'done'],
    npcs: [
      {
        id: 'npc1',
        name: 'NPC',
        map: 'town',
        pos: [1, 1],
        dialogue: [{ requires: [], lines: ['hi'] }]
      }
    ],
    ...overrides
  };
}

describe('validateWorld', () => {
  it('accepts a minimal valid world', () => {
    expect(runWorld(makeWorld())).toEqual([]);
  });

  it('flags a world with no maps', () => {
    const problems = runWorld(makeWorld({ maps: {} }));
    expect(problems).toContainEqual(expect.stringContaining('world has no maps'));
  });

  it('flags a map with no tile grid loaded (a missing maps/<id>.json)', () => {
    const world = makeWorld();
    const problems = validateWorld(world, {});
    expect(problems.join('\n')).toContain('map "town" has no tile grid — expected maps/town.json');
  });

  it('flags a building placement referencing an unknown building id', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'ghost-shop', pos: [0, 0], size: [1, 1], door: [1, 1] }]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('places unknown building "ghost-shop"');
  });

  it('flags a building whose door sits on a solid tile', () => {
    // The door (1,1) sits on a "#" tile that is outside the building's own
    // footprint (3,3), so this exercises the tile-solidity check specifically,
    // not "the door is inside its own building".
    const world = makeWorld({
      maps: {
        town: makeMap(
          { buildings: [{ id: 'shop', pos: [3, 3], size: [1, 1], door: [1, 1] }] },
          ['....', '.##.', '....', '....']
        )
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its door on a solid tile');
  });

  it('accepts a building placement with a boolean "label"', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], label: false }]
        })
      }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a building placement whose "label" isn\'t a boolean', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          // world.json is untyped JSON at load time, so a bad value here is a
          // realistic author mistake, not just a TypeScript escape hatch.
          buildings: [
            { id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], label: 'yes' } as unknown as BuildingPlacement
          ]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has a "label" that isn\'t a boolean');
  });

  it('accepts the plaque tile the engine puts beside a door by default', () => {
    // Right of the door, which on this footprint is still a walkable tile.
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [1, 0], size: [2, 1], door: [1, 1] }]
        })
      }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a building whose plaque tile is solid', () => {
    const world = makeWorld({
      maps: {
        town: makeMap(
          { buildings: [{ id: 'shop', pos: [1, 0], size: [2, 1], door: [1, 1] }] },
          ['....', '..#.', '....', '....']
        )
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its plaque on a solid tile');
  });

  it('flags a plaque placed outside the map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [1, 0], size: [2, 1], door: [1, 1], plaque: [9, 9] }]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its plaque outside the map');
  });

  it('flags a plaque sitting on the door tile itself', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [1, 0], size: [2, 1], door: [1, 1], plaque: [1, 1] }]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its plaque on its own door tile');
  });

  it('accepts a building that opts out of a plaque altogether', () => {
    const world = makeWorld({
      maps: {
        town: makeMap(
          { buildings: [{ id: 'shop', pos: [1, 0], size: [2, 1], door: [1, 1], plaque: false }] },
          // The tile the default plaque would have taken is solid, so this
          // only passes because opting out skips the check entirely.
          ['....', '..#.', '....', '....']
        )
      }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a building interior pointing at an unknown map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [
            { id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], interior: 'nowhere', enter: [0, 0] }
          ]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" points at unknown interior "nowhere"');
  });

  it('flags a building with an interior but no "enter" spawn', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], interior: 'shop-interior' }]
        })
      },
      buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000' } }
    });
    world.maps['shop-interior'] = makeMap({ kind: 'interior' });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has an interior but no "enter" spawn');
  });

  it('accepts a building interior that does declare an "enter" spawn', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [
            { id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], interior: 'shop-interior', enter: [0, 0] }
          ]
        })
      }
    });
    world.maps['shop-interior'] = makeMap({ kind: 'interior' });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags an exit leading to an unknown map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          exits: [{ id: 'town-nowhere', at: [0, 0, 1, 1], to: 'nowhere', spawn: [0, 0], facing: 'down', style: 'road' }]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('exit "town-nowhere" leads to unknown map "nowhere"');
  });

  it('flags an exit whose spawn point is solid in the destination map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          exits: [{ id: 'town-away', at: [0, 0, 1, 1], to: 'away', spawn: [1, 1], facing: 'down', style: 'road' }]
        }),
        away: makeMap({}, ['....', '.##.', '....', '....'])
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('exit "town-away" spawns on a solid tile in "away"');
  });

  it('flags a start map that does not exist', () => {
    const world = makeWorld({ start: { map: 'nowhere', pos: [0, 0], facing: 'down' } });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('start map "nowhere" does not exist');
  });

  it('flags a start position on a solid tile', () => {
    const world = makeWorld({
      start: { map: 'town', pos: [1, 1], facing: 'down' },
      maps: { town: makeMap({}, ['....', '.#..', '....', '....']) }
    });
    const problems = runWorld(world);
    expect(problems).toContainEqual(expect.stringContaining('start position is on a solid tile'));
  });

  // Street fixtures (DESIGN.md §2): the engine's own furniture, standing on a
  // tile of its own and blocking it. The tile therefore has to be one the
  // player could have walked on, and it must not be a tile the player has to
  // reach some other way.
  it('accepts a fixture on a walkable tile', () => {
    const world = makeWorld({
      maps: { town: makeMap({ fixtures: [{ kind: 'suggestion-box', pos: [2, 2] }] }) }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a fixture outside the map', () => {
    const world = makeWorld({
      maps: { town: makeMap({ fixtures: [{ kind: 'suggestion-box', pos: [9, 1] }] }) }
    });
    expect(runWorld(world).join('\n')).toContain('is outside the map');
  });

  it('flags a fixture on a solid tile', () => {
    const world = makeWorld({
      maps: { town: makeMap({ fixtures: [{ kind: 'suggestion-box', pos: [1, 1] }] }, ['....', '.#..', '....', '....']) }
    });
    expect(runWorld(world).join('\n')).toContain('fixture "suggestion-box" at 1,1 is on a solid tile');
  });

  it('flags a fixture standing on a building footprint', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [2, 0], size: [2, 2], door: [2, 2] }],
          fixtures: [{ kind: 'suggestion-box', pos: [2, 1] }]
        })
      }
    });
    expect(runWorld(world).join('\n')).toContain('is on a solid tile');
  });

  it("flags a fixture on a building's door tile", () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [0, 0], size: [2, 2], door: [0, 2] }],
          fixtures: [{ kind: 'suggestion-box', pos: [0, 2] }]
        })
      }
    });
    expect(runWorld(world).join('\n')).toContain('is on building "shop"\'s door tile');
  });

  it("flags a fixture on a building's plaque tile", () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          // The plaque defaults to the tile right of the door.
          buildings: [{ id: 'shop', pos: [0, 0], size: [2, 2], door: [0, 2] }],
          fixtures: [{ kind: 'suggestion-box', pos: [1, 2] }]
        })
      }
    });
    expect(runWorld(world).join('\n')).toContain('is on building "shop"\'s plaque tile');
  });

  it('flags a fixture standing where the player arrives', () => {
    const onStart = makeWorld({
      start: { map: 'town', pos: [2, 2], facing: 'down' },
      maps: { town: makeMap({ fixtures: [{ kind: 'suggestion-box', pos: [2, 2] }] }) }
    });
    expect(runWorld(onStart).join('\n')).toContain("is on the world's start tile");

    const onSpawn = makeWorld({
      maps: {
        town: makeMap({
          exits: [{ id: 'town-away', at: [0, 0, 1, 1], to: 'away', spawn: [3, 3], facing: 'down', style: 'road' }]
        }),
        away: makeMap({ fixtures: [{ kind: 'suggestion-box', pos: [3, 3] }] })
      }
    });
    expect(runWorld(onSpawn).join('\n')).toContain('is on the tile exit "town-away" spawns onto');
  });

  it('flags a fixture kind the engine has no shape for', () => {
    const world = makeWorld({
      maps: {
        // world.json is untyped JSON at load time, so a typo here is a
        // realistic author mistake rather than a TypeScript escape hatch.
        town: makeMap({ fixtures: [{ kind: 'suggestion-bin', pos: [2, 2] } as unknown as Fixture] })
      }
    });
    expect(runWorld(world).join('\n')).toContain('unknown fixture kind');
  });
});

describe('isSolid', () => {
  const map = makeMap(
    { buildings: [{ id: 'shop', pos: [2, 2], size: [2, 2], door: [2, 3] }] },
    ['....', '.#..', '....', '....']
  );

  it('is true for a tileset tile marked solid', () => {
    expect(isSolid(map, 1, 1)).toBe(true);
  });

  it('is false for an ordinary walkable tile', () => {
    expect(isSolid(map, 0, 0)).toBe(false);
  });

  it('is true anywhere inside a building footprint, even on a "." tile underneath', () => {
    expect(isSolid(map, 2, 2)).toBe(true);
    expect(isSolid(map, 3, 3)).toBe(true);
  });

  it('is true out of bounds in every direction', () => {
    expect(isSolid(map, -1, 0)).toBe(true);
    expect(isSolid(map, 0, -1)).toBe(true);
    expect(isSolid(map, 4, 0)).toBe(true);
    expect(isSolid(map, 0, 4)).toBe(true);
  });
});

describe('validateEpisode', () => {
  const world = makeWorld();

  it('accepts a minimal valid episode', () => {
    expect(runEpisode(makeEpisode(), world)).toEqual([]);
  });

  it('flags an npc dialogue entry that requires an undeclared flag', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          dialogue: [
            { requires: ['ghostFlag'], lines: ['a'] },
            { requires: [], lines: ['b'] }
          ]
        }
      ]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" dialogue 0 uses undeclared flag "ghostFlag"');
  });

  it('flags an npc dialogue entry whose effect sets an undeclared flag', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          dialogue: [{ requires: [], lines: ['a'], effects: [{ set: 'ghostFlag' }] }]
        }
      ]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" dialogue 0 sets undeclared flag "ghostFlag"');
  });

  it('flags a dialogue entry that is unreachable after an earlier unconditional entry', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          dialogue: [
            { requires: [], lines: ['catch-all first'] },
            { requires: ['done'], lines: ['never reached'] }
          ]
        }
      ]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain(
      'npc "npc1" dialogue 1 is unreachable — entry 0 matches everything'
    );
  });

  it('flags an npc with no unconditional fallback line', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          dialogue: [{ requires: ['done'], lines: ['only conditional'] }]
        }
      ]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" has no unconditional fallback line');
  });

  it('flags an npc placed on an unknown map', () => {
    const episode = makeEpisode({
      npcs: [{ id: 'npc1', name: 'NPC', map: 'nowhere', pos: [1, 1], dialogue: [{ requires: [], lines: ['a'] }] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" is on unknown map "nowhere"');
  });

  it('flags an npc position outside its map', () => {
    const episode = makeEpisode({
      npcs: [{ id: 'npc1', name: 'NPC', map: 'town', pos: [99, 99], dialogue: [{ requires: [], lines: ['a'] }] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" is outside map "town"');
  });

  it('flags an item position outside its map', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [-1, 0], requires: [], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" is outside map "town"');
  });

  it('flags an item that requires an undeclared flag', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: ['ghostFlag'], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" uses undeclared flag "ghostFlag"');
  });

  it('flags an item effect that sets an undeclared flag', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ set: 'ghostFlag' }], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" sets undeclared flag "ghostFlag"');
  });

  it('flags an item with no effect that sets a flag (it could never be marked taken)', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ toast: 'got it' }], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" has no effect that sets a flag');
  });

  it('accepts a well-formed item', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: ['metNpc'], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    expect(runEpisode(episode, world)).toEqual([]);
  });

  it('flags a sign that requires an undeclared flag', () => {
    const episode = makeEpisode({
      signs: [{ building: 'shop', requires: ['ghostFlag'], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('uses undeclared flag "ghostFlag"');
  });

  it('flags a sign with neither "building" nor "map"+"pos"', () => {
    const episode = makeEpisode({ signs: [{ requires: [], lines: ['a'] }] });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('needs exactly one of "building" or "map" + "pos"');
  });

  it('flags a sign with both "building" and "map"', () => {
    const episode = makeEpisode({
      signs: [{ building: 'shop', map: 'town', pos: [0, 0], requires: [], lines: ['a'] }]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('needs exactly one of "building" or "map" + "pos"');
  });

  it('flags a prop sign that has "pos" but no "map"', () => {
    const episode = makeEpisode({ signs: [{ pos: [0, 0], requires: [], lines: ['a'] }] });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('prop sign needs both "map" and "pos"');
  });

  it('flags a prop sign that has "map" but no "pos"', () => {
    const episode = makeEpisode({ signs: [{ map: 'town', requires: [], lines: ['a'] }] });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('prop sign needs both "map" and "pos"');
  });

  it('flags a building sign referring to an unknown building', () => {
    const episode = makeEpisode({ signs: [{ building: 'ghost-shop', requires: [], lines: ['a'] }] });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('sign refers to unknown building "ghost-shop"');
  });

  it('flags a prop sign whose position is outside its map', () => {
    const episode = makeEpisode({ signs: [{ map: 'town', pos: [99, 99], requires: [], lines: ['a'] }] });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('is outside map "town"');
  });

  it('accepts a well-formed building sign and a well-formed prop sign', () => {
    const episode = makeEpisode({
      signs: [
        { building: 'shop', requires: [], lines: ['a'] },
        { map: 'town', pos: [0, 0], requires: [], lines: ['b'] }
      ]
    });
    expect(runEpisode(episode, world)).toEqual([]);
  });
});

/**
 * The real pack, loaded the way engine/loader.ts and scripts/validate-episodes
 * load it: world.json's map metadata joined to the Tiled grid under maps/, with
 * the external tileset resolved relative to the map file.
 */
function loadPack(root: string) {
  const world = JSON.parse(readFileSync(resolve(root, 'world.json'), 'utf8')) as World;
  const tilesets = new Map<string, TilesetDef>();
  const maps: Record<string, GameMap> = {};
  for (const mapId of Object.keys(world.maps)) {
    const file = resolve(root, 'maps', `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    for (const source of tilesetSources(raw, file)) {
      const tilesetFile = resolve(dirname(file), source);
      if (!tilesets.has(tilesetFile)) {
        tilesets.set(tilesetFile, parseTileset(JSON.parse(readFileSync(tilesetFile, 'utf8')), tilesetFile));
      }
    }
    const gridData = parseTiledMap(raw, (source) => tilesets.get(resolve(dirname(file), source)), file);
    maps[mapId] = { ...world.maps[mapId], ...gridData };
  }
  return { world, maps };
}

describe('worlds/route10 validates cleanly', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../worlds/route10');

  it('has no problems from validateWorld', () => {
    const { world, maps } = loadPack(root);
    expect(validateWorld(world, maps)).toEqual([]);
  });

  it('has no problems from validateEpisode, for every episode listed in world.json', () => {
    const { world, maps } = loadPack(root);
    for (const episodeId of world.episodes) {
      const episode = JSON.parse(
        readFileSync(resolve(root, 'episodes', `${episodeId}.json`), 'utf8')
      ) as Episode;
      expect(validateEpisode(episode, world, maps)).toEqual([]);
    }
  });

  it('every map the pack declares has a Tiled grid with a ground layer', () => {
    const { world, maps } = loadPack(root);
    for (const mapId of Object.keys(world.maps)) {
      expect(maps[mapId].layers.map((layer) => layer.name)).toContain('ground');
      expect(maps[mapId].width).toBeGreaterThan(0);
      expect(maps[mapId].height).toBeGreaterThan(0);
    }
  });
});

describe('plaqueTile', () => {
  const place = (over: Partial<BuildingPlacement>): BuildingPlacement => ({
    id: 'shop',
    pos: [2, 2],
    size: [3, 2],
    door: [3, 4],
    ...over
  });

  it('defaults to the tile right of the door', () => {
    expect(plaqueTile(place({}))).toEqual([4, 4]);
  });

  it('defaults to the left of the door when the door is in the right-most column', () => {
    expect(plaqueTile(place({ door: [4, 4] }))).toEqual([3, 4]);
  });

  it('uses an explicit plaque tile when the placement gives one', () => {
    expect(plaqueTile(place({ plaque: [7, 4] }))).toEqual([7, 4]);
  });

  it('returns null when the placement opts out', () => {
    expect(plaqueTile(place({ plaque: false }))).toBeNull();
  });
});
