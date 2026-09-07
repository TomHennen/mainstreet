import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTiledMap, parseTileset, tilesetSources } from './tiled';
import type { TilesetDef } from './tiled';
import { isSolid, moverWalkable, validateEpisode, validateWorld } from './validate';
import { hashId, Mover } from './mover';
import { plaqueTile } from './schema';
import type { BuildingDef, BuildingPlacement, Episode, Fixture, GameMap, MapMeta, World } from './schema';

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
    // A placed building needs a standing sign, so the default fixture has one.
    buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['Open till six.'] } },
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

  it('accepts a building with a standing sign', () => {
    const world = makeWorld({
      buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['Open till six.'] } }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a building that a map places with no standing sign at all', () => {
    const world = makeWorld({
      buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000' } },
      maps: {
        town: makeMap({ buildings: [{ id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1] }] })
      }
    });
    expect(runWorld(world).join('\n')).toContain(
      'building "shop" is placed on a map but has no "sign" — every door needs a standing sign'
    );
  });

  it('leaves a registry building alone while no map places it', () => {
    // A world pack may name a building ahead of putting it on a map; nobody
    // can walk up to that door yet, so it owes no copy.
    const world = makeWorld({
      buildings: {
        shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['Open till six.'] },
        future: { name: 'Future', wall: '#fff', roof: '#000' }
      },
      maps: {
        town: makeMap({ buildings: [{ id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1] }] })
      }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a standing sign with no lines in it', () => {
    const world = makeWorld({ buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: [] } } });
    expect(runWorld(world).join('\n')).toContain(
      'building "shop" has a "sign" that isn\'t a non-empty array of lines'
    );
  });

  it('flags a standing sign that isn\'t an array at all', () => {
    const world = makeWorld({
      // world.json is untyped JSON at load time, so a bare string here is a
      // realistic author mistake.
      buildings: {
        shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: 'Open till six.' } as unknown as BuildingDef
      }
    });
    expect(runWorld(world).join('\n')).toContain(
      'building "shop" has a "sign" that isn\'t a non-empty array of lines'
    );
  });

  it('flags an empty page in the middle of a standing sign', () => {
    const world = makeWorld({
      buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['Open till six.', '  '] } }
    });
    expect(runWorld(world).join('\n')).toContain('building "shop" sign line 1 is empty');
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
      buildings: { shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['Open till six.'] } }
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

  it('flags a "replace" that isn\'t a boolean', () => {
    const episode = makeEpisode({
      signs: [{ building: 'shop', requires: [], lines: ['a'], replace: 'yes' as unknown as boolean }]
    });
    expect(runEpisode(episode, world).join('\n')).toContain('has a "replace" that isn\'t a boolean');
  });

  it('flags "replace" on a prop sign, which has no standing sign behind it', () => {
    const episode = makeEpisode({
      signs: [{ map: 'town', pos: [0, 0], requires: [], lines: ['a'], replace: true }]
    });
    expect(runEpisode(episode, world).join('\n')).toContain('only building signs have');
  });

  it('accepts a well-formed building sign and a well-formed prop sign', () => {
    const episode = makeEpisode({
      signs: [
        { building: 'shop', requires: [], lines: ['a'] },
        { building: 'shop', requires: [], lines: ['c'], replace: true },
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

  /**
   * A route that validates is not yet a route that anybody walks: a first
   * waypoint on the tile somebody already stands on, or a wander with only its
   * own doorstep to go to, both pass the checks above and leave the village
   * standing still. So everybody the pack says walks is actually walked here.
   */
  it('everybody the pack gives a route or a wander actually gets somewhere', () => {
    const { world, maps } = loadPack(root);
    const walkers: { where: string; who: { id: string; pos: [number, number]; route?: unknown; wander?: unknown } }[] =
      [];
    for (const [mapId, meta] of Object.entries(world.maps)) {
      for (const person of meta.people ?? []) walkers.push({ where: mapId, who: person });
    }
    for (const episodeId of world.episodes) {
      const episode = JSON.parse(readFileSync(resolve(root, 'episodes', `${episodeId}.json`), 'utf8')) as Episode;
      for (const npc of episode.npcs) {
        if (npc.route || npc.wander) walkers.push({ where: npc.map, who: npc });
      }
    }
    expect(walkers.length).toBeGreaterThan(0);

    for (const { where, who } of walkers) {
      const mover = new Mover({
        home: who.pos,
        route: who.route as never,
        wander: who.wander as never,
        // The engine's default: the player's 102px/s, slowed to a stroll.
        speed: (102 * 0.8) / 16,
        walkable: moverWalkable(maps[where]),
        seed: hashId(who.id)
      });
      const seen = new Set<string>();
      for (let i = 0; i < 60 * 30; i++) {
        mover.update(1 / 30, { held: false, blocked: () => false });
        seen.add(mover.tile().join(','));
      }
      expect(seen.size, `"${who.id}" on "${where}" never left ${who.pos.join(',')}`).toBeGreaterThan(1);
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

/**
 * A `look` is the only part of a person the engine draws itself, so a value it
 * cannot draw has to be caught here rather than quietly leaving somebody
 * looking like everybody else (DESIGN.md §4).
 */
describe('look validation', () => {
  const withLook = (look: unknown) =>
    makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          look,
          dialogue: [{ requires: [], lines: ['hi'] }]
        } as unknown as Episode['npcs'][number]
      ]
    });

  it('accepts a full look', () => {
    const episode = withLook({ hair: 'long', hairColor: '#3a2c1e', skin: '#e8c39a', shirt: '#fff', build: 'slim' });
    expect(runEpisode(episode, makeWorld())).toEqual([]);
  });

  it('accepts no look at all', () => {
    expect(runEpisode(makeEpisode(), makeWorld())).toEqual([]);
  });

  it('rejects a hair style the engine cannot draw', () => {
    const problems = runEpisode(withLook({ hair: 'mullet' }), makeWorld());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('unknown hair "mullet"');
  });

  it('rejects a build the engine cannot draw', () => {
    const problems = runEpisode(withLook({ build: 'huge' }), makeWorld());
    expect(problems[0]).toContain('unknown build "huge"');
  });

  it('rejects a colour that is not a hex colour', () => {
    const problems = runEpisode(withLook({ hairColor: 'chestnut' }), makeWorld());
    expect(problems[0]).toContain('"hairColor" that isn\'t a hex colour');
  });

  it('catches a misspelt field rather than ignoring it', () => {
    const problems = runEpisode(withLook({ haircolor: '#fff' }), makeWorld());
    expect(problems[0]).toContain('unknown field "haircolor"');
  });

  it('rejects a look that is not an object', () => {
    const problems = runEpisode(withLook('long'), makeWorld());
    expect(problems[0]).toContain("has a \"look\" that isn't an object");
  });

  it('checks the player’s look too', () => {
    const world = makeWorld({
      player: { id: 'player', accent: '#fff', look: { hair: 'flattop' } } as unknown as World['player']
    });
    const problems = runWorld(world);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('player "player" look has unknown hair "flattop"');
  });
});

/**
 * Townspeople who walk (DESIGN.md §2/§3). A route is data, so every way it
 * could be wrong is caught here rather than by somebody noticing that nobody
 * on the green ever moves.
 */
describe('people, routes and wanders', () => {
  const ROWS = ['..........', '..........', '..#####...', '..........', '..........'];

  const townWith = (people: unknown) =>
    makeWorld({
      maps: {
        town: makeMap({ people: people as MapMeta['people'] }, ROWS)
      }
    });

  it('accepts a person with a route', () => {
    const problems = runWorld(
      townWith([{ id: 'stroller', pos: [1, 1], route: { path: [[8, 1], [1, 1]] } }])
    );
    expect(problems).toEqual([]);
  });

  it('accepts a person with a wander', () => {
    expect(runWorld(townWith([{ id: 'potterer', pos: [5, 4], wander: { radius: 2 } }]))).toEqual([]);
  });

  it('accepts a person who simply stands there', () => {
    expect(runWorld(townWith([{ id: 'watcher', pos: [5, 4] }]))).toEqual([]);
  });

  it('rejects a person with no id', () => {
    const problems = runWorld(townWith([{ id: '', pos: [1, 1] }]));
    expect(problems[0]).toContain('every person needs an id');
  });

  it('rejects the same person listed twice', () => {
    const problems = runWorld(
      townWith([
        { id: 'twin', pos: [1, 1] },
        { id: 'twin', pos: [3, 1] }
      ])
    );
    expect(problems[0]).toContain('is listed twice');
  });

  it('rejects a person standing in a wall', () => {
    const problems = runWorld(townWith([{ id: 'inwall', pos: [3, 2] }]));
    expect(problems[0]).toContain('is somewhere nobody can stand');
  });

  it('rejects a person standing on a doorstep', () => {
    const world = makeWorld({
      maps: {
        town: makeMap(
          {
            buildings: [{ id: 'shop', pos: [2, 0], size: [3, 1], door: [3, 1], plaque: [4, 1] }],
            people: [{ id: 'blocker', pos: [3, 1] }]
          },
          ROWS
        )
      }
    });
    expect(runWorld(world).join('\n')).toContain('is somewhere nobody can stand');
  });

  it('rejects a person standing on a plaque tile', () => {
    const world = makeWorld({
      maps: {
        town: makeMap(
          {
            buildings: [{ id: 'shop', pos: [2, 0], size: [3, 1], door: [3, 1], plaque: [4, 1] }],
            people: [{ id: 'blocker', pos: [4, 1] }]
          },
          ROWS
        )
      }
    });
    expect(runWorld(world).join('\n')).toContain('is somewhere nobody can stand');
  });

  it('rejects a route waypoint inside a wall', () => {
    const problems = runWorld(townWith([{ id: 'stroller', pos: [1, 1], route: { path: [[3, 2], [1, 1]] } }]));
    expect(problems.join('\n')).toContain('route waypoint 0');
  });

  it('rejects a route waypoint there is no way to walk to', () => {
    // A pocket of floor sealed off by the wall row, with a walled edge below.
    const rows = ['..........', '..........', '##########', '..........', '..........'];
    const problems = runWorld(
      makeWorld({
        maps: { town: makeMap({ people: [{ id: 'stroller', pos: [1, 1], route: { path: [[1, 4], [1, 1]] } }] }, rows) }
      })
    );
    expect(problems.join('\n')).toContain('no way through');
  });

  it('rejects a route with only one waypoint', () => {
    const problems = runWorld(townWith([{ id: 'stroller', pos: [1, 1], route: { path: [[3, 1]] } }]));
    expect(problems[0]).toContain('fewer than two waypoints');
  });

  it('rejects both a route and a wander on one person', () => {
    const problems = runWorld(
      townWith([{ id: 'busy', pos: [1, 1], route: { path: [[3, 1], [1, 1]] }, wander: { radius: 2 } }])
    );
    expect(problems[0]).toContain('walks one or the other');
  });

  it('rejects a wander radius below one', () => {
    const problems = runWorld(townWith([{ id: 'potterer', pos: [1, 1], wander: { radius: 0 } }]));
    expect(problems[0]).toContain('radius below 1');
  });

  it('rejects a wander with nowhere to go', () => {
    const rows = ['###', '#.#', '###'];
    const problems = runWorld(
      makeWorld({
        start: { map: 'town', pos: [1, 1], facing: 'down' },
        maps: { town: makeMap({ people: [{ id: 'stuck', pos: [1, 1], wander: { radius: 1 } }] }, rows) }
      })
    );
    expect(problems.join('\n')).toContain('no tile within 1');
  });

  it('refuses a crowd', () => {
    const crowd = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, pos: [i, 4] }));
    const problems = runWorld(townWith(crowd));
    expect(problems.join('\n')).toContain('as many as a village reads as');
  });

  it('checks a world person’s look like anybody else’s', () => {
    const problems = runWorld(townWith([{ id: 'stroller', pos: [1, 1], look: { hair: 'mullet' } }]));
    expect(problems[0]).toContain('unknown hair "mullet"');
  });

  it('checks an episode NPC’s route the same way', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          route: { path: [[3, 2], [1, 1]] },
          dialogue: [{ requires: [], lines: ['hi'] }]
        }
      ]
    });
    const world = makeWorld({ maps: { town: makeMap({}, ROWS) } });
    expect(runEpisode(episode, world).join('\n')).toContain('route waypoint 0');
  });

  it('accepts an episode NPC with a small wander', () => {
    const episode = makeEpisode({
      npcs: [
        {
          id: 'npc1',
          name: 'NPC',
          map: 'town',
          pos: [1, 1],
          wander: { radius: 2 },
          dialogue: [{ requires: [], lines: ['hi'] }]
        }
      ]
    });
    expect(runEpisode(episode, makeWorld({ maps: { town: makeMap({}, ROWS) } }))).toEqual([]);
  });
});
