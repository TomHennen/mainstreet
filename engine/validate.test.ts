import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTiledMap, parseTileset, tilesetSources } from './tiled';
import type { TilesetDef } from './tiled';
import { driveable, isSolid, moverWalkable, overlayNotes, validateCopy, validateEpisode, validateWorld } from './validate';
import { hashId, Mover } from './mover';
import { plaqueTile, signBoardTile } from './schema';
import type {
  BuildingDef,
  BuildingPlacement,
  Episode,
  EpisodeItem,
  Fixture,
  GameMap,
  MapMeta,
  World,
  WorldCopy
} from './schema';

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
  columns: 3,
  tilecount: 3,
  imagewidth: 48,
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
    },
    // The paved surface a vehicle may drive along: `drive`, like `solid`, is a
    // tileset property rather than anything the engine knows the name of.
    {
      id: 2,
      type: 'asphalt',
      properties: [
        { name: 'colors', type: 'string', value: '#333' },
        { name: 'drive', type: 'bool', value: true },
        { name: 'solid', type: 'bool', value: false },
        { name: 'style', type: 'string', value: 'flat' }
      ]
    }
  ]
};

/** `.` walkable, `#` solid, `=` paved and drivable — one `ground` layer. */
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
        data: rows.flatMap((row) => [...row].map((ch) => (ch === '#' ? 2 : ch === '=' ? 3 : 1)))
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

  // `submit.art` is where the Studio posts a finished drawing. The post is
  // opaque across origins, so a wrong field id looks exactly like a submission
  // that arrived — which is why the shape is checked here rather than found
  // out later by a painting that never turned up.
  describe('submit.art', () => {
    const art = (over: Record<string, unknown> = {}) => ({
      art: {
        form: 'https://example.test/forms/d/e/abc/formResponse',
        fields: { building: 'entry.1', world: 'entry.2', credit: 'entry.3', code: 'entry.4' },
        ...over
      }
    });

    it('accepts a world with no submit block at all', () => {
      expect(runWorld(makeWorld())).toEqual([]);
    });

    it('accepts a well-formed form, with and without a notes field', () => {
      expect(runWorld(makeWorld({ submit: art() as never }))).toEqual([]);
      const withNotes = art({
        fields: { building: 'entry.1', world: 'entry.2', credit: 'entry.3', code: 'entry.4', notes: 'entry.5' }
      });
      expect(runWorld(makeWorld({ submit: withNotes as never }))).toEqual([]);
    });

    it('flags a form URL that is not https', () => {
      const submit = art({ form: 'http://example.test/formResponse' });
      expect(runWorld(makeWorld({ submit: submit as never })).join('\n')).toContain(
        'world "submit.art" needs a "form" URL beginning https://'
      );
    });

    it('flags a missing or empty field id', () => {
      const blank = art({ fields: { building: 'entry.1', world: '  ', credit: 'entry.3', code: 'entry.4' } });
      expect(runWorld(makeWorld({ submit: blank as never })).join('\n')).toContain(
        'world "submit.art" has a "world" field id that is empty'
      );
      const missing = art({ fields: { building: 'entry.1', world: 'entry.2', credit: 'entry.3' } });
      expect(runWorld(makeWorld({ submit: missing as never })).join('\n')).toContain(
        'world "submit.art" has no field id for "code"'
      );
    });

    it('flags a fields block that is not an object', () => {
      const submit = art({ fields: 'entry.1' });
      expect(runWorld(makeWorld({ submit: submit as never })).join('\n')).toContain(
        'world "submit.art" needs a "fields" object'
      );
    });

    it('flags an empty notes field id, since a blank one would post nowhere', () => {
      const submit = art({
        fields: { building: 'entry.1', world: 'entry.2', credit: 'entry.3', code: 'entry.4', notes: '' }
      });
      expect(runWorld(makeWorld({ submit: submit as never })).join('\n')).toContain(
        'world "submit.art" has a "notes" field id that is empty'
      );
    });

    it('accepts an explicit https "page" alongside the form', () => {
      const submit = art({ page: 'https://example.test/forms/d/e/abc/viewform' });
      expect(runWorld(makeWorld({ submit: submit as never }))).toEqual([]);
    });

    it('flags a "page" that is not https', () => {
      const submit = art({ page: 'http://example.test/forms/d/e/abc/viewform' });
      expect(runWorld(makeWorld({ submit: submit as never })).join('\n')).toContain(
        'world "submit.art" has a "page" that is not a URL beginning https://'
      );
    });
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
          // A footprint one row deep with the door in its middle column, one
          // row below it — the door sits outside the footprint's own solid
          // rectangle, the way a real door does (DESIGN.md §2).
          buildings: [
            { id: 'shop', pos: [0, 0], size: [3, 1], door: [1, 1], interior: 'shop-interior', enter: [0, 0] }
          ]
        })
      }
    });
    world.maps['shop-interior'] = makeMap({ kind: 'interior' });
    expect(runWorld(world)).toEqual([]);
  });

  // Once a door opens, its standing sign moves to a board beside it — the
  // engine's own new tile, held to the same "can stand here" rules the door
  // and the plaque already are (DESIGN.md §2). A door in the middle of a
  // footprint one row deep, sitting just below it (a real door's row, not the
  // building's own solid rectangle — see the test just above), and the
  // world's start moved off that row entirely so it never lands on one of
  // these tiles by coincidence.
  const withInterior = (over: Partial<BuildingPlacement> = {}) => {
    const world = makeWorld({
      start: { map: 'town', pos: [3, 3], facing: 'down' },
      maps: {
        town: makeMap({
          buildings: [
            { id: 'shop', pos: [0, 0], size: [4, 1], door: [1, 1], interior: 'shop-interior', enter: [0, 0], ...over }
          ]
        })
      }
    });
    world.maps['shop-interior'] = makeMap({ kind: 'interior' });
    return world;
  };

  it('accepts the sign board tile the engine puts beside a door with an interior', () => {
    // Default: [0,1], the far side of the door from the plaque at [2,1] —
    // both walkable on this footprint.
    expect(runWorld(withInterior())).toEqual([]);
  });

  it('flags a sign board tile that is solid', () => {
    // The default sign board lands at [0,1]; walling off that one tile
    // leaves the door at [1,1] and the plaque at [2,1] untouched.
    const world = withInterior();
    world.maps.town = makeMap({ buildings: world.maps.town.buildings }, ['....', '#...', '....', '....']);
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its sign board on a solid tile');
  });

  it('flags a sign board placed outside the map', () => {
    const world = withInterior({ signAt: [99, 99] });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its sign board outside the map');
  });

  it('flags a sign board sitting on its own door tile', () => {
    const world = withInterior({ signAt: [1, 1] });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its sign board on its own door tile');
  });

  it('flags a sign board sitting on its own plaque tile', () => {
    const world = withInterior({ signAt: [2, 1] });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its sign board on its own plaque tile');
  });

  it('flags a sign board outside its own footprint', () => {
    // The footprint only spans columns 0-3; a wider map gives column 5
    // somewhere to be that isn't solid, isn't the door, and isn't the plaque,
    // so only the footprint check fires.
    const world = withInterior({ signAt: [5, 1] });
    world.maps.town = makeMap({ buildings: world.maps.town.buildings }, ['......', '......', '......', '......']);
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain(
      'building "shop" has its sign board outside its own footprint — give it an explicit "signAt" inside it'
    );
  });

  it('flags a "signAt" on a building with no interior', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'shop', pos: [0, 0], size: [1, 1], door: [1, 1], signAt: [2, 1] }]
        })
      }
    });
    const problems = runWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has a "signAt" but no interior — its door already reads the sign');
  });

  it("flags a fixture on a building's sign board tile", () => {
    const world = withInterior();
    world.maps.town = makeMap({
      buildings: world.maps.town.buildings,
      fixtures: [{ kind: 'suggestion-box', pos: [0, 1] }]
    });
    expect(runWorld(world).join('\n')).toContain('is on building "shop"\'s sign board tile');
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

  // A sign that belongs to the map rather than to a story: a door with a
  // note on it, a wall worth stopping at (DESIGN.md §2). Unlike a fixture it
  // may sit on something solid — that is usually the point — but it has to be
  // readable from somewhere.
  it('accepts a map sign on a wall with floor beside it', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({ signs: [{ pos: [2, 1], lines: ['A note, in a careful hand.'] }] }, ['....', '..#.', '....', '....'])
      }
    });
    expect(runWorld(world)).toEqual([]);
  });

  it('flags a map sign outside the map, and one with nothing on it', () => {
    const away = makeWorld({ maps: { town: makeMap({ signs: [{ pos: [9, 1], lines: ['x'] }] }) } });
    expect(runWorld(away).join('\n')).toContain('sign at 9,1 is outside the map');
    const blank = makeWorld({ maps: { town: makeMap({ signs: [{ pos: [2, 2], lines: ['  '] }] }) } });
    expect(runWorld(blank).join('\n')).toContain('has nothing to read on it');
  });

  it('flags a map sign walled in on every side', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({ signs: [{ pos: [2, 1], lines: ['Nobody can get to this.'] }] }, ['..#.', '.###', '..#.', '....'])
      }
    });
    expect(runWorld(world).join('\n')).toContain('nowhere beside it to read it from');
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

  // Road ends (DESIGN.md §2): a rectangle shaped like an exit's `at`, but it
  // says a line instead of leading anywhere.
  describe('edges', () => {
    it('accepts an edge inside the map with non-empty lines', () => {
      const world = makeWorld({
        maps: { town: makeMap({ edges: [{ id: 'north-road', at: [0, 0, 2, 1], lines: ['On it goes.'] }] }) }
      });
      expect(runWorld(world)).toEqual([]);
    });

    it('flags an edge that reaches outside the map', () => {
      const world = makeWorld({
        maps: { town: makeMap({ edges: [{ id: 'north-road', at: [3, 0, 2, 1], lines: ['On it goes.'] }] }) }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" edge "north-road" is outside the map');
    });

    it('flags an edge that overlaps an exit', () => {
      const world = makeWorld({
        maps: {
          town: makeMap({
            exits: [{ id: 'town-away', at: [0, 0, 2, 1], to: 'away', spawn: [0, 0], facing: 'down', style: 'road' }],
            edges: [{ id: 'north-road', at: [1, 0, 2, 1], lines: ['On it goes.'] }]
          })
        }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" edge "north-road" overlaps exit "town-away"');
    });

    it('accepts an edge that merely sits beside an exit, not overlapping it', () => {
      const world = makeWorld({
        maps: {
          town: makeMap({
            exits: [{ id: 'town-away', at: [0, 0, 1, 1], to: 'away', spawn: [0, 0], facing: 'down', style: 'road' }],
            edges: [{ id: 'north-road', at: [1, 0, 2, 1], lines: ['On it goes.'] }]
          }),
          away: makeMap()
        }
      });
      expect(runWorld(world)).toEqual([]);
    });

    it('flags an edge with no lines', () => {
      const world = makeWorld({
        maps: { town: makeMap({ edges: [{ id: 'north-road', at: [0, 0, 2, 1], lines: [] }] }) }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" edge "north-road" has no "lines"');
    });

    it('flags an edge with an empty line', () => {
      const world = makeWorld({
        maps: { town: makeMap({ edges: [{ id: 'north-road', at: [0, 0, 2, 1], lines: ['Fine.', '  '] }] }) }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" edge "north-road" line 2 is empty');
    });
  });

  describe('lost', () => {
    const lost = { lines: ['You got turned around.'], to: 'town', spawn: [2, 2] as [number, number], facing: 'up' as const };

    it('accepts a lost entry that lands on a walkable tile of a real map', () => {
      expect(runWorld(makeWorld({ maps: { town: makeMap({ lost }) } }))).toEqual([]);
    });

    it('flags a lost entry leading to an unknown map', () => {
      const world = makeWorld({ maps: { town: makeMap({ lost: { ...lost, to: 'nowhere' } }) } });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" leads to unknown map "nowhere"');
    });

    it('flags a lost entry that spawns on a solid tile', () => {
      const world = makeWorld({ maps: { town: makeMap({ lost }, ['....', '....', '..#.', '....']) } });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" spawns on a solid tile in "town"');
    });

    it('flags a lost entry that spawns inside a building footprint', () => {
      const world = makeWorld({
        maps: { town: makeMap({ lost, buildings: [{ id: 'shop', pos: [2, 2], size: [1, 1], door: [2, 1] }] }) }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" spawns on a solid tile in "town"');
    });

    it('flags a lost entry that spawns outside its map', () => {
      const world = makeWorld({ maps: { town: makeMap({ lost: { ...lost, spawn: [9, 9] } }) } });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" spawn is outside the map');
    });

    it('flags a lost entry with an unknown facing', () => {
      const world = makeWorld({ maps: { town: makeMap({ lost: { ...lost, facing: 'sideways' as never } }) } });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" has an unknown "facing"');
    });

    it('flags a lost entry with no lines, or an empty one', () => {
      const none = makeWorld({ maps: { town: makeMap({ lost: { ...lost, lines: [] } }) } });
      expect(runWorld(none).join('\n')).toContain('map "town" "lost" has no "lines"');
      const blank = makeWorld({ maps: { town: makeMap({ lost: { ...lost, lines: ['Fine.', ' '] } }) } });
      expect(runWorld(blank).join('\n')).toContain('map "town" "lost" line 2 is empty');
    });

    it('flags a lost entry on a map that is not a village', () => {
      const world = makeWorld({ maps: { town: makeMap({ kind: 'interior', lost }) } });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" is on a "interior" map — only a village can have "lost"');
    });

    it('flags a lost entry leading to a map that is not a village', () => {
      const world = makeWorld({
        maps: {
          town: makeMap({ lost: { ...lost, to: 'cabin', spawn: [1, 1] } }),
          cabin: makeMap({ kind: 'interior' }, ['....', '....'])
        }
      });
      expect(runWorld(world).join('\n')).toContain('map "town" "lost" leads to "cabin", which isn\'t a village');
    });

    it('flags a lost entry whose spawn is itself lost-eligible — the player would get lost again on arrival', () => {
      const world = makeWorld({ maps: { town: makeMap({ lost: { ...lost, spawn: [0, 0] } }) } });
      expect(runWorld(world).join('\n')).toContain(
        'map "town" "lost" spawns onto "town"\'s own "lost" boundary — the player would get lost again on arrival'
      );
    });
  });

  // The carry verbs (DESIGN.md §2): one fixture hands a token over, another
  // spends it, and both have to have the words for it happening and for it
  // not happening.
  const carrying = (fixture: Partial<Fixture>) =>
    runWorld(
      makeWorld({
        maps: { town: makeMap({ fixtures: [{ kind: 'woodpile', pos: [2, 2], ...fixture } as Fixture] }) }
      })
    ).join('\n');

  it('takes a fixture that gives a token and says both halves of it', () => {
    expect(
      carrying({ give: 'log', lines: ['You take one off the pile.'], otherwise: ["You've got one already."] })
    ).toBe('');
  });

  it('flags a fixture that gives something but has nothing to say about it', () => {
    expect(carrying({ give: 'log', lines: ['You take one off the pile.'] })).toContain('no "otherwise" to say');
    expect(carrying({ give: 'log', otherwise: ["You've got one already."] })).toContain('no "lines" to say');
  });

  it('flags a fixture that both gives and takes, and an unnamed token', () => {
    expect(
      carrying({ give: 'log', take: 'log', lines: ['On it goes.'], otherwise: ['Not yet.'] })
    ).toContain('does one or the other');
    expect(carrying({ give: '  ', lines: ['On it goes.'], otherwise: ['Not yet.'] })).toContain(
      'not a name for the thing being carried'
    );
  });

  it('only lets something that takes a token glow, and only for real seconds', () => {
    expect(carrying({ give: 'log', lines: ['a'], otherwise: ['b'], glow: 60 })).toContain('takes nothing');
    expect(carrying({ take: 'log', lines: ['a'], otherwise: ['b'], glow: 0 })).toContain(
      'has to be more than none'
    );
    expect(carrying({ take: 'log', lines: ['a'], otherwise: ['b'], glow: 60 })).toBe('');
  });

  // The "with you" panel's own words for the token (DESIGN.md §2).
  it('accepts a fixture with heldName/heldBlurb written', () => {
    expect(
      carrying({
        give: 'log',
        lines: ['a'],
        otherwise: ['b'],
        heldName: 'A split log',
        heldBlurb: 'Tucked under your arm.'
      })
    ).toBe('');
  });

  it('flags an empty heldName or heldBlurb', () => {
    expect(carrying({ give: 'log', lines: ['a'], otherwise: ['b'], heldName: '  ' })).toContain(
      '"heldName" is empty'
    );
    expect(carrying({ give: 'log', lines: ['a'], otherwise: ['b'], heldBlurb: '' })).toContain(
      '"heldBlurb" is empty'
    );
  });
});

describe('validateCopy', () => {
  const baseCopy: WorldCopy = {
    ui: {
      narrator: 'You',
      advance: '▼',
      unpainted: '',
      plaque: { painted: '', anonymous: '', unpainted: '' }
    },
    transitions: {}
  };

  it('accepts copy with no `withYou` at all', () => {
    expect(validateCopy(baseCopy)).toEqual([]);
  });

  it('accepts a fully-written `withYou`', () => {
    const copy: WorldCopy = {
      ...baseCopy,
      ui: { ...baseCopy.ui, withYou: { button: 'With you', title: 'What you have', empty: 'Nothing on you.' } }
    };
    expect(validateCopy(copy)).toEqual([]);
  });

  it('flags an empty withYou.button/title/empty', () => {
    const withField = (field: 'button' | 'title' | 'empty', value: string) =>
      validateCopy({ ...baseCopy, ui: { ...baseCopy.ui, withYou: { [field]: value } } }).join('\n');
    expect(withField('button', '  ')).toContain('ui.withYou.button is empty');
    expect(withField('title', '')).toContain('ui.withYou.title is empty');
    expect(withField('empty', '   ')).toContain('ui.withYou.empty is empty');
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

  // The "with you" panel's own fields (DESIGN.md §2/§3).
  it('accepts an item with name, blurb and a declared `until` flag', () => {
    const episode = makeEpisode({
      items: [
        {
          id: 'pen',
          map: 'town',
          pos: [0, 0],
          requires: [],
          effects: [{ set: 'metNpc' }],
          lines: ['a'],
          name: "Earl's pen",
          blurb: 'A fine ballpoint.',
          until: 'done'
        }
      ]
    });
    expect(runEpisode(episode, world)).toEqual([]);
  });

  it('flags an item whose `until` names an undeclared flag', () => {
    const episode = makeEpisode({
      items: [
        { id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ set: 'done' }], lines: ['a'], until: 'ghostFlag' }
      ]
    });
    const problems = runEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" uses undeclared flag "ghostFlag"');
  });

  it('flags an empty item name or blurb', () => {
    const named = (overrides: Partial<EpisodeItem>) =>
      runEpisode(
        makeEpisode({
          items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ set: 'done' }], lines: ['a'], ...overrides }]
        }),
        world
      ).join('\n');
    expect(named({ name: '  ' })).toContain('item "pen" "name" is empty');
    expect(named({ blurb: '' })).toContain('item "pen" "blurb" is empty');
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

  describe('smallTalk vs. ambient people', () => {
    const worldWithWalkers = makeWorld({
      maps: {
        town: makeMap({
          people: [
            { id: 'walker1', name: 'A', pos: [1, 1] },
            { id: 'walker2', name: 'B', pos: [2, 1] },
            { id: 'walker3', name: 'C', pos: [3, 1] }
          ]
        })
      }
    });

    it('flags a smallTalk pool with fewer lines than ambient people', () => {
      const episode = makeEpisode({ smallTalk: ['one line'] });
      const problems = runEpisode(episode, worldWithWalkers);
      expect(problems.join('\n')).toContain('"smallTalk" has 1 line for 3 ambient people');
    });

    it('accepts a smallTalk pool with at least as many lines as ambient people', () => {
      const episode = makeEpisode({ smallTalk: ['one', 'two', 'three'] });
      expect(runEpisode(episode, worldWithWalkers)).toEqual([]);
    });

    it('does not require smallTalk at all, even with ambient people around', () => {
      const episode = makeEpisode({ smallTalk: undefined });
      expect(runEpisode(episode, worldWithWalkers)).toEqual([]);
    });
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
      // A person with neither is meant to stand still — someone posted behind
      // a counter, say — so only one who was actually given a route or a
      // wander belongs in this "did it walk" check (same filter as the
      // episode NPCs below).
      for (const person of meta.people ?? []) {
        if (person.route || person.wander) walkers.push({ where: mapId, who: person });
      }
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

describe('signBoardTile', () => {
  const place = (over: Partial<BuildingPlacement>): BuildingPlacement => ({
    id: 'shop',
    pos: [2, 2],
    size: [3, 2],
    door: [3, 4],
    ...over
  });

  it('returns null for a building with no interior — the door still reads the sign', () => {
    expect(signBoardTile(place({}))).toBeNull();
  });

  it('defaults to the opposite side of the door from the plaque', () => {
    // door at [3,4]: plaqueTile lands on [4,4] (right of the door), so the
    // sign board takes the other side.
    expect(signBoardTile(place({ interior: 'shop-interior' }))).toEqual([2, 4]);
  });

  it('flips to the other side of the door when an explicit plaque flips sides', () => {
    // The plaque is explicitly pulled to the door's left ([2,4] — normally
    // where the board itself would default to); the board has to notice and
    // take the right instead, never landing on the plaque's own tile.
    const tile = signBoardTile(place({ interior: 'shop-interior', plaque: [2, 4] }));
    expect(tile).toEqual([4, 4]);
    expect(tile).not.toEqual([2, 4]);
  });

  it('keeps the board inside the footprint when the door is in the right-most column', () => {
    // door in the right-most column (4, with this footprint's columns 2-4):
    // plaqueTile lands on the left at [3,4], so the board's "far side" is off
    // the right edge of the footprint entirely — clamped back to column 4,
    // the door's own. That collision is exactly what the validator's "sign
    // board on its own door tile" check exists to catch, with `signAt` as
    // the fix; this test only holds the clamp itself to account.
    const tile = signBoardTile(place({ door: [4, 4], interior: 'shop-interior' }));
    expect(tile).not.toBeNull();
    expect(tile![0]).toBeGreaterThanOrEqual(2);
    expect(tile![0]).toBeLessThanOrEqual(4);
  });

  it('keeps the board inside the footprint when the door is in the left-most column', () => {
    // Mirror image of the right-most case: the far side from the plaque
    // would fall left of column 2, clamped back to column 2 — the door's own.
    const tile = signBoardTile(place({ door: [2, 4], interior: 'shop-interior' }));
    expect(tile).not.toBeNull();
    expect(tile![0]).toBeGreaterThanOrEqual(2);
    expect(tile![0]).toBeLessThanOrEqual(4);
  });

  it('uses an explicit signAt tile when the placement gives one', () => {
    expect(signBoardTile(place({ interior: 'shop-interior', signAt: [9, 9] }))).toEqual([9, 9]);
  });
});

describe('moverWalkable', () => {
  it("excludes a building's sign board tile, the same as its door and its plaque", () => {
    // A footprint one row deep (row 0) with the door — and so the plaque and
    // the sign board too — on the real, walkable row just below it.
    const map = makeMap({
      buildings: [
        { id: 'shop', pos: [0, 0], size: [4, 1], door: [1, 1], interior: 'shop-interior', enter: [0, 0] }
      ]
    });
    // door=[1,1], plaque default=[2,1], sign board default=[0,1] — see
    // signBoardTile above for this same footprint.
    const walkable = moverWalkable(map);
    expect(walkable(1, 1)).toBe(false);
    expect(walkable(2, 1)).toBe(false);
    expect(walkable(0, 1)).toBe(false);
    // Elsewhere on this 4x4 grid stays open to a townsperson's route or wander.
    expect(walkable(3, 1)).toBe(true);
    expect(walkable(1, 3)).toBe(true);
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

/**
 * Scenes (DESIGN.md §3). A scene that cannot stage itself is a week of story
 * the player watches nothing happen in, so what is checked is that everybody
 * it names is somebody on that map and every tile it sends them to is one they
 * could stand on.
 */
describe('scenes', () => {
  const ROWS = ['......', '..##..', '......', '......', '......', '......'];
  const world = () => makeWorld({ maps: { town: makeMap({}, ROWS) } });
  const withScene = (steps: unknown[], over: Record<string, unknown> = {}) =>
    makeEpisode({ scenes: [{ id: 'welcome', on: { enter: 'town' }, steps, ...over }] as never });

  it('accepts a scene that stages itself', () => {
    const episode = withScene([
      { light: { mode: 'party', colours: ['#d9a441'], at: [[3, 3]] } },
      { move: { who: 'npc1', to: [4, 4], speed: 2 } },
      { say: { who: 'npc1', lines: ['Come in, come in.'] } },
      { wait: 1 },
      { camera: { to: [2, 2] } },
      { camera: { to: 'player' } },
      { toast: 'A good night.' },
      { set: 'done' }
    ]);
    expect(runEpisode(episode, world())).toEqual([]);
  });

  it('declares the scene flag on the episode\'s behalf', () => {
    // Nothing in the episode declares "scene:welcome", and nothing has to.
    const episode = withScene([{ toast: 'hello' }]);
    expect(runEpisode(episode, world())).toEqual([]);
  });

  it('wants exactly one trigger', () => {
    expect(runEpisode(withScene([{ toast: 'x' }], { on: {} }), world()).join('\n')).toContain(
      'needs exactly one of "on.flag" or "on.enter"'
    );
    expect(
      runEpisode(withScene([{ toast: 'x' }], { on: { flag: 'metNpc', enter: 'town' } }), world()).join('\n')
    ).toContain('needs exactly one of "on.flag" or "on.enter"');
  });

  it('flags an undeclared trigger flag', () => {
    expect(runEpisode(withScene([{ toast: 'x' }], { on: { flag: 'nope' } }), world()).join('\n')).toContain(
      'triggered by undeclared flag "nope"'
    );
  });

  it('flags a scene entered on a map that does not exist', () => {
    expect(runEpisode(withScene([{ toast: 'x' }], { on: { enter: 'nowhere' } }), world()).join('\n')).toContain(
      'entered on unknown map "nowhere"'
    );
  });

  it('flags a step that does nothing, and one that does two things', () => {
    expect(runEpisode(withScene([{}]), world()).join('\n')).toContain('does nothing');
    expect(runEpisode(withScene([{ toast: 'a', wait: 1 }]), world()).join('\n')).toContain('does 2 things at once');
  });

  it('flags a scene with no steps at all', () => {
    expect(runEpisode(withScene([]), world()).join('\n')).toContain('has no steps');
  });

  it('flags moving somebody who is not in the episode', () => {
    expect(runEpisode(withScene([{ move: { who: 'ghost', to: [1, 1] } }]), world()).join('\n')).toContain(
      'moves "ghost", who is not in this episode'
    );
  });

  it('flags moving somebody who is on another map', () => {
    const episode = makeEpisode({
      npcs: [
        { id: 'npc1', name: 'NPC', map: 'town', pos: [1, 1], dialogue: [{ requires: [], lines: ['hi'] }] },
        { id: 'npc2', name: 'Two', map: 'other', pos: [1, 1], dialogue: [{ requires: [], lines: ['hi'] }] }
      ],
      scenes: [{ id: 'welcome', on: { enter: 'town' }, steps: [{ move: { who: 'npc2', to: [3, 3] } }] }]
    } as never);
    const two = makeWorld({ maps: { town: makeMap({}, ROWS), other: makeMap({}, ROWS) } });
    expect(runEpisode(episode, two).join('\n')).toContain('who is on map "other" and not on "town"');
  });

  it('flags a walk into a wall, and one off the edge of the map', () => {
    expect(runEpisode(withScene([{ move: { who: 'npc1', to: [2, 1] } }]), world()).join('\n')).toContain(
      'is somewhere "npc1" cannot stand'
    );
    expect(runEpisode(withScene([{ move: { who: 'npc1', to: [99, 1] } }]), world()).join('\n')).toContain(
      'is outside the map'
    );
  });

  it('checks every leg of a path', () => {
    const problems = runEpisode(withScene([{ move: { who: 'npc1', path: [[4, 4], [2, 1]] } }]), world()).join('\n');
    expect(problems).toContain('path 1');
    expect(problems).not.toContain('path 0');
  });

  it('wants exactly one of "to" and "path"', () => {
    expect(runEpisode(withScene([{ move: { who: 'npc1' } }]), world()).join('\n')).toContain(
      'needs exactly one of "to" or "path"'
    );
  });

  it('lets the player stand where a townsperson may not', () => {
    // A doorstep is read by standing exactly on it, so nobody but the player
    // may be sent there (moverWalkable).
    const withDoor = makeWorld({
      maps: { town: makeMap({ buildings: [{ id: 'shop', pos: [0, 0], size: [2, 2], door: [1, 2] }] }, ROWS) }
    });
    expect(runEpisode(withScene([{ move: { who: 'player', to: [1, 2] } }]), withDoor)).toEqual([]);
    expect(runEpisode(withScene([{ move: { who: 'npc1', to: [1, 2] } }]), withDoor).join('\n')).toContain(
      'is somewhere "npc1" cannot stand'
    );
  });

  it('accepts a car the episode brought with it', () => {
    const paved = makeWorld({ maps: { town: makeMap({}, ['======', '..##..', '======', '......', '......', '......']) } });
    const episode = makeEpisode({
      vehicles: [{ id: 'pickup', map: 'town', kind: 'pickup', colour: '#8a6b48', pos: [1, 0] }] as never,
      scenes: [{ id: 'welcome', on: { enter: 'town' }, steps: [{ move: { who: 'vehicle:pickup', to: [4, 0] } }] }] as never
    });
    expect(runEpisode(episode, paved)).toEqual([]);
  });

  it('flags a vehicle no map has', () => {
    expect(runEpisode(withScene([{ move: { who: 'vehicle:pickup', to: [3, 3] } }]), world()).join('\n')).toContain(
      'which is not a vehicle on map "town"'
    );
  });

  it('accepts a vehicle a map does have', () => {
    const withCar = makeWorld({
      maps: { town: { ...makeMap({}, ROWS), vehicles: [{ id: 'pickup' }] } as never }
    });
    expect(runEpisode(withScene([{ move: { who: 'vehicle:pickup', to: [3, 3] } }]), withCar)).toEqual([]);
  });

  it('drives a car over the paved routes, out through an exit if that is where the road goes', () => {
    // The road runs east into an exit; nobody on foot may stand in an exit
    // tile, and a car driving out of town very much may.
    const ROADS = ['======', '..##..', '......', '......', '......', '......'];
    const paved = makeWorld({
      maps: { town: makeMap({ exits: [{ id: 'east', at: [5, 0, 1, 1], to: 'town', spawn: [1, 1], facing: 'down', style: 'road' }] }, ROADS) }
    });
    const episode = makeEpisode({
      vehicles: [{ id: 'pickup', map: 'town', kind: 'pickup', colour: '#8a6b48', pos: [0, 0] }] as never,
      scenes: [{ id: 'off', on: { flag: 'done' }, steps: [{ move: { who: 'vehicle:pickup', path: [[3, 0], [5, 0]] } }] }] as never
    });
    expect(runEpisode(episode, paved)).toEqual([]);
    expect(
      runEpisode(makeEpisode({ npcs: [{ id: 'npc1', name: 'NPC', map: 'town', pos: [1, 1], dialogue: [{ requires: [], lines: ['hi'] }] }], scenes: [{ id: 'off', on: { enter: 'town' }, steps: [{ move: { who: 'npc1', to: [5, 0] } }] }] as never }), paved).join('\n')
    ).toContain('is somewhere "npc1" cannot stand');
  });

  it('flags a car sent somewhere off the paved routes, and one with no way through', () => {
    const ROADS = ['======', '..##..', '......', '......', '=.....', '=====.'];
    const paved = makeWorld({ maps: { town: makeMap({}, ROADS) } });
    const stranded = (to: [number, number]) =>
      runEpisode(
        makeEpisode({
          vehicles: [{ id: 'pickup', map: 'town', kind: 'pickup', colour: '#8a6b48', pos: [0, 0] }] as never,
          scenes: [{ id: 'off', on: { flag: 'done' }, steps: [{ move: { who: 'vehicle:pickup', to } }] }] as never
        }),
        paved
      ).join('\n');
    expect(stranded([3, 3])).toContain('is not a tile a vehicle can drive on');
    // Paved at both ends, with lawn in between.
    expect(stranded([0, 4])).toContain('no paved way through');
  });

  it('flags a speaker who is not in the episode, and empty lines', () => {
    expect(runEpisode(withScene([{ say: { who: 'ghost', lines: ['hi'] } }]), world()).join('\n')).toContain(
      'has "ghost" speaking, who is not in this episode'
    );
    expect(runEpisode(withScene([{ say: { lines: [] } }]), world()).join('\n')).toContain('says nothing');
    expect(runEpisode(withScene([{ say: { lines: ['  '] } }]), world()).join('\n')).toContain('line 0 is empty');
  });

  it('lets the narrator speak with no "who" at all', () => {
    expect(runEpisode(withScene([{ say: { lines: ['The room goes warm.'] } }]), world())).toEqual([]);
  });

  it('keeps a wait to a beat', () => {
    expect(runEpisode(withScene([{ wait: 9 }]), world()).join('\n')).toContain('as long as a beat should ever hold');
    expect(runEpisode(withScene([{ wait: 0 }]), world()).join('\n')).toContain("isn't a number of seconds");
  });

  it('flags an undeclared flag on a set step', () => {
    expect(runEpisode(withScene([{ set: 'nope' }]), world()).join('\n')).toContain('sets undeclared flag "nope"');
  });

  it('checks the lights', () => {
    expect(runEpisode(withScene([{ light: { mode: 'disco' } }]), world()).join('\n')).toContain('expected one of off, dim, party');
    expect(runEpisode(withScene([{ light: { mode: 'party', colours: ['blue'] } }]), world()).join('\n')).toContain(
      "isn't a hex colour"
    );
    expect(runEpisode(withScene([{ light: { mode: 'party', at: [[99, 99]] } }]), world()).join('\n')).toContain(
      'outside the map'
    );
    expect(runEpisode(withScene([{ light: { mode: 'dim', at: [[1, 1]] } }]), world()).join('\n')).toContain(
      'names lights or colours on a "dim" step'
    );
  });

  it('flags a camera looking at nothing in particular', () => {
    expect(runEpisode(withScene([{ camera: { to: 'nobody' } }]), world()).join('\n')).toContain(
      'looks at neither a tile like [12, 4] nor "player"'
    );
  });

  it('flags two scenes with the same id', () => {
    const episode = makeEpisode({
      scenes: [
        { id: 'welcome', on: { enter: 'town' }, steps: [{ toast: 'a' }] },
        { id: 'welcome', on: { enter: 'town' }, steps: [{ toast: 'b' }] }
      ]
    } as never);
    expect(runEpisode(episode, world()).join('\n')).toContain('is listed twice');
  });
});

/**
 * Overlays (DESIGN.md §3). One canonical map per village: an episode is free
 * to put a marquee on the green, and not free to put it across the only way to
 * a door — which is why every combination that could be on together is checked
 * rather than each one on its own.
 */
describe('overlays', () => {
  //  0123456
  const ROWS = [
    '.......',
    '.......',
    '.......',
    '.......',
    '.......'
  ];
  // The shop sits in the top right corner, so the only way to its door is the
  // column of ground at x=4 — three tiles, and easy to wall off between two
  // overlays without either of them doing it alone.
  const shopMap = () =>
    makeMap({ buildings: [{ id: 'shop', pos: [5, 0], size: [2, 2], door: [5, 2] }] }, ROWS);
  const world = () => makeWorld({ maps: { town: shopMap() } });
  const withOverlay = (overlays: unknown[]) => makeEpisode({ overlays } as never);

  it('accepts an overlay that paints a tile', () => {
    const episode = withOverlay([{ id: 'market', map: 'town', requires: [], tiles: [{ pos: [5, 4], tile: 1 }] }]);
    expect(runEpisode(episode, world())).toEqual([]);
  });

  it('flags an undeclared requires or unless', () => {
    const problems = runEpisode(
      withOverlay([{ id: 'market', map: 'town', requires: ['nope'], unless: ['nah'], tiles: [{ pos: [5, 4], tile: 1 }] }]),
      world()
    ).join('\n');
    expect(problems).toContain('requires undeclared flag "nope"');
    expect(problems).toContain('an "unless" on undeclared flag "nah"');
  });

  it('flags one that requires and rules out the same flag', () => {
    const episode = withOverlay([
      { id: 'never', map: 'town', requires: ['metNpc'], unless: ['metNpc'], tiles: [{ pos: [5, 4], tile: 1 }] }
    ]);
    expect(runEpisode(episode, world()).join('\n')).toContain('can never be on');
  });

  it('flags a tile no tileset on that map has', () => {
    const episode = withOverlay([{ id: 'market', map: 'town', requires: [], tiles: [{ pos: [5, 4], tile: 42 }] }]);
    expect(runEpisode(episode, world()).join('\n')).toContain('which no tileset "town" uses has');
  });

  it('flags an overlay on an unknown map, and one painted off the edge', () => {
    expect(
      runEpisode(withOverlay([{ id: 'm', map: 'nowhere', requires: [], tiles: [{ pos: [0, 0], tile: 1 }] }]), world()).join('\n')
    ).toContain('patches unknown map "nowhere"');
    expect(
      runEpisode(withOverlay([{ id: 'm', map: 'town', requires: [], tiles: [{ pos: [99, 0], tile: 1 }] }]), world()).join('\n')
    ).toContain('outside map "town"');
  });

  it('refuses to let an overlay wall a "lost" spawn in — an arrival, same as a door', () => {
    const withLost = makeMap(
      {
        buildings: [{ id: 'shop', pos: [5, 0], size: [2, 2], door: [5, 2] }],
        lost: { lines: ['You wander off into the grass.'], to: 'town', spawn: [3, 2], facing: 'up' }
      },
      ROWS
    );
    const episode = withOverlay([{ id: 'wall-in', map: 'town', requires: [], tiles: [{ pos: [3, 2], tile: 1 }] }]);
    const problems = runEpisode(episode, makeWorld({ maps: { town: withLost } })).join('\n');
    expect(problems).toContain('the player arrives at 3,2 on ground nobody can stand on');
  });

  it('refuses to let an overlay wall a door in', () => {
    const episode = withOverlay([
      {
        id: 'stage',
        map: 'town',
        requires: [],
        tiles: [
          { pos: [4, 2], tile: 1 },
          { pos: [4, 3], tile: 1 },
          { pos: [4, 4], tile: 1 }
        ]
      }
    ]);
    expect(runEpisode(episode, world()).join('\n')).toContain("building \"shop\"'s door at 5,2 cannot be reached");
  });

  it('catches two overlays that only strand a door together', () => {
    const episode = withOverlay([
      { id: 'left', map: 'town', requires: [], tiles: [{ pos: [4, 2], tile: 1 }, { pos: [4, 3], tile: 1 }] },
      { id: 'right', map: 'town', requires: [], tiles: [{ pos: [4, 4], tile: 1 }] }
    ]);
    const problems = runEpisode(episode, world()).join('\n');
    // Neither of them does it alone; between them they take the last way in.
    expect(problems).toContain('with "left" + "right" on');
    expect(problems).toContain('door at 5,2 cannot be reached');
    expect(problems).not.toContain('with "left" on');
  });

  it('lets a before and an after wall the same door, since they never co-occur', () => {
    const episode = withOverlay([
      {
        id: 'before',
        map: 'town',
        requires: [],
        unless: ['metNpc'],
        tiles: [{ pos: [4, 2], tile: 1 }, { pos: [4, 3], tile: 1 }]
      },
      { id: 'after', map: 'town', requires: ['metNpc'], tiles: [{ pos: [4, 4], tile: 1 }] }
    ]);
    expect(runEpisode(episode, world())).toEqual([]);
  });

  it('flags a prop with nothing to read and an unknown fixture kind', () => {
    const problems = runEpisode(
      withOverlay([
        {
          id: 'market',
          map: 'town',
          requires: [],
          tiles: [{ pos: [5, 4], tile: 1 }],
          props: [{ pos: [5, 3], lines: [] }],
          fixtures: [{ kind: 'jukebox', pos: [4, 4] }]
        }
      ]),
      world()
    ).join('\n');
    expect(problems).toContain('with nothing to read');
    expect(problems).toContain('unknown fixture kind "jukebox"');
  });
});

describe('sign board reachability', () => {
  it('flags an explicit "signAt" the player has no way to stand on', () => {
    // Door and plaque sit on the open top of the map; the sign board is
    // pinned, by an explicit signAt, into a one-tile pocket walled in on
    // every side — reachable on its own tile, but from nowhere else.
    const rows = ['.....', '.....', '...#.', '..#.#', '...#.'];
    const world = makeWorld({
      maps: {
        town: makeMap(
          {
            buildings: [
              {
                id: 'shop',
                pos: [0, 0],
                size: [4, 1],
                door: [1, 1],
                interior: 'shop-interior',
                enter: [0, 0],
                signAt: [3, 3]
              }
            ]
          },
          rows
        )
      }
    });
    world.maps['shop-interior'] = makeMap({ kind: 'interior' });
    // unreachableWith only runs under an overlay combination (validateEpisode
    // has nothing to check reachability against on the bare map), so a
    // harmless overlay elsewhere gives it one to run under without touching
    // the walls that isolate the board.
    const episode = makeEpisode({
      npcs: [],
      overlays: [{ id: 'noop', map: 'town', requires: [], tiles: [{ pos: [4, 0], tile: 1 }] }]
    } as never);
    const problems = runEpisode(episode, world).join('\n');
    expect(problems).toContain('building "shop"\'s sign board at 3,3 cannot be reached');
  });
});

describe('overlayNotes', () => {
  const ROWS = ['.....', '.....', '.....'];
  it('names every tile two co-occurring overlays both paint', () => {
    const maps = { town: makeMap({}, ROWS) };
    const episode = makeEpisode({
      overlays: [
        { id: 'a', map: 'town', requires: [], tiles: [{ pos: [1, 1], tile: 1 }, { pos: [2, 1], tile: 1 }] },
        { id: 'b', map: 'town', requires: [], tiles: [{ pos: [2, 1], tile: 0 }] }
      ]
    } as never);
    const notes = overlayNotes(episode, maps as never);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"a" and "b" both paint 2,1');
  });

  it('says nothing about two that can never be on together', () => {
    const maps = { town: makeMap({}, ROWS) };
    const episode = makeEpisode({
      overlays: [
        { id: 'a', map: 'town', requires: [], unless: ['metNpc'], tiles: [{ pos: [1, 1], tile: 1 }] },
        { id: 'b', map: 'town', requires: ['metNpc'], tiles: [{ pos: [1, 1], tile: 0 }] }
      ]
    } as never);
    expect(overlayNotes(episode, maps as never)).toEqual([]);
  });
});

/**
 * A person's own standing line (DESIGN.md §2) — a barista behind a counter,
 * say, with something kind to say every week and no story attached to it.
 */
describe('a person’s own lines', () => {
  const ROWS = ['..........', '..........', '..#####...', '..........', '..........'];

  const townWith = (people: unknown) =>
    makeWorld({
      maps: {
        town: makeMap({ people: people as MapMeta['people'] }, ROWS)
      }
    });

  it('accepts a still person with their own lines', () => {
    const problems = runWorld(
      townWith([{ id: 'barista', pos: [1, 1], lines: ['Morning. What can I get you?'] }])
    );
    expect(problems).toEqual([]);
  });

  it('rejects lines that are not a non-empty array', () => {
    const problems = runWorld(townWith([{ id: 'barista', pos: [1, 1], lines: [] }]));
    expect(problems[0]).toContain('"lines" that isn\'t a non-empty array');
  });

  it('rejects an empty line', () => {
    const problems = runWorld(townWith([{ id: 'barista', pos: [1, 1], lines: ['Morning.', '  '] }]));
    expect(problems[0]).toContain('lines[1] is empty');
  });

  // Behind a counter, the staff strip is sealed off from the rest of the room
  // on foot (scripts/make-room.ts's sealStrip) — nobody could ever walk there,
  // but the tile itself is ordinary floor, so a still person is fine there the
  // same way Hannah is fine behind Stewart's counter (DESIGN.md §2).
  it('accepts a still person in a pocket of floor sealed off from the rest of the room', () => {
    const rows = ['.......', '.#####.', '.#...#.', '.#####.', '.......'];
    const problems = runWorld(
      makeWorld({
        start: { map: 'town', pos: [1, 0], facing: 'down' },
        maps: {
          town: makeMap({ people: [{ id: 'barista', pos: [3, 2], lines: ['Welcome in.'] }] }, rows)
        }
      })
    );
    expect(problems).toEqual([]);
  });
});

/**
 * Ambient traffic (DESIGN.md §2, issue #72). A car's path is data like
 * everything else, and the one rule about it — cars keep to the paved routes —
 * is a rule about tiles, so it is checked here against real parsed map data.
 */
describe('vehicles', () => {
  // A three-lane paved route across the middle, a sandy side street below it.
  const ROADS = [
    '..........',
    '==========',
    '==========',
    '==========',
    '..........'
  ];

  const townWith = (vehicles: unknown) =>
    makeWorld({
      maps: {
        town: makeMap({ vehicles: vehicles as MapMeta['vehicles'] }, ROADS)
      }
    });

  const car = (overrides: Record<string, unknown> = {}) => ({
    id: 'car1',
    kind: 'car',
    colour: '#9babb2',
    path: [[1, 3], [8, 3], [8, 1], [1, 1]],
    ...overrides
  });

  it('accepts a car looping the paved route', () => {
    expect(runWorld(townWith([car()]))).toEqual([]);
  });

  it('accepts a map with no vehicles at all', () => {
    expect(runWorld(makeWorld({ maps: { town: makeMap({}, ROADS) } }))).toEqual([]);
  });

  it('rejects a waypoint off the paved route', () => {
    const problems = runWorld(townWith([car({ path: [[1, 3], [1, 4]] })]));
    expect(problems.join('\n')).toContain('cars keep to the paved routes');
  });

  it('rejects a waypoint outside the map', () => {
    expect(runWorld(townWith([car({ path: [[1, 3], [40, 3]] })])).join('\n')).toContain('is outside the map');
  });

  it('rejects a path with one waypoint', () => {
    expect(runWorld(townWith([car({ path: [[1, 3]] })])).join('\n')).toContain('fewer than two waypoints');
  });

  it('rejects an unknown kind', () => {
    expect(runWorld(townWith([car({ kind: 'tractor' })])).join('\n')).toContain('unknown kind "tractor"');
  });

  it('rejects a colour that is not a colour', () => {
    expect(runWorld(townWith([car({ colour: 'green' })])).join('\n')).toContain("a \"colour\" that isn't a hex colour");
  });

  it('rejects a speed that is not a number of tiles per second', () => {
    expect(runWorld(townWith([car({ speed: 0 })])).join('\n')).toContain("a \"speed\" that isn't");
  });

  it('rejects a pause that is not a number of seconds', () => {
    expect(runWorld(townWith([car({ pause: -1 })])).join('\n')).toContain("a \"pause\" that isn't");
  });

  it('rejects a car with no id, and the same car listed twice', () => {
    expect(runWorld(townWith([car({ id: '' })])).join('\n')).toContain('every vehicle needs an id');
    expect(runWorld(townWith([car(), car()])).join('\n')).toContain('is listed twice');
  });

  it('rejects a leg with no paved way through', () => {
    // Two stretches of pavement with a field between them.
    const split = ['..........', '===..=====', '..........'];
    const problems = runWorld(
      makeWorld({
        maps: {
          town: makeMap({ vehicles: [car({ path: [[1, 1], [8, 1]], loop: false }) as never] }, split)
        }
      })
    );
    expect(problems.join('\n')).toContain('no paved way through');
  });

  it('accepts a parked car on the pavement', () => {
    expect(runWorld(townWith([{ id: 'parked', kind: 'pickup', colour: '#547e64', pos: [4, 1], facing: 'left' }]))).toEqual(
      []
    );
  });

  it('rejects a parked car left on the grass', () => {
    const problems = runWorld(townWith([{ id: 'parked', kind: 'pickup', colour: '#547e64', pos: [4, 0] }]));
    expect(problems.join('\n')).toContain('cars keep to the paved routes');
  });

  it('rejects a car with neither a path nor a pos', () => {
    expect(runWorld(townWith([{ id: 'nowhere', kind: 'car', colour: '#9babb2' }])).join('\n')).toContain(
      'neither a "path" to drive nor a "pos" to be parked on'
    );
  });

  it('rejects an unknown facing', () => {
    const problems = runWorld(townWith([car({ facing: 'sideways' })]));
    expect(problems.join('\n')).toContain('unknown "facing"');
  });

  it('lets a map with no paved tiles park a car anywhere it fits', () => {
    const yard = ['....', '..##', '....'];
    const parked = (pos: number[]) => ({ id: 'parked', kind: 'van', colour: '#ab947a', pos });
    const town = (pos: number[]) => makeMap({ vehicles: [parked(pos) as never] }, yard);
    expect(runWorld(makeWorld({ maps: { town: town([0, 0]) } }))).toEqual([]);
    expect(runWorld(makeWorld({ maps: { town: town([2, 1]) } })).join('\n')).toContain(
      'somewhere no vehicle could be left'
    );
  });

  it('checks the tile a moving car starts on, when it is given one', () => {
    const problems = runWorld(townWith([car({ pos: [4, 0] })]));
    expect(problems.join('\n')).toContain('cars keep to the paved routes');
  });

  it('rejects more traffic than a village reads as', () => {
    const many = [0, 1, 2, 3].map((n) => car({ id: `car${n}` }));
    expect(runWorld(townWith(many)).join('\n')).toContain('as much traffic as a village reads as');
  });

  // The cars a week's story brings with it (DESIGN.md §3). Same rules, on the
  // map each one names, and gone again when the episode stops playing.
  describe("an episode's own", () => {
    const withCars = (vehicles: unknown) => makeEpisode({ vehicles: vehicles as never });
    const truck = (overrides: Record<string, unknown> = {}) => ({
      id: 'pickup',
      map: 'town',
      kind: 'pickup',
      colour: '#8a6b48',
      pos: [4, 2],
      facing: 'down',
      ...overrides
    });

    it('accepts one parked on the paved route', () => {
      expect(runEpisode(withCars([truck()]), townWith([]))).toEqual([]);
    });

    it('flags one left on the grass', () => {
      expect(runEpisode(withCars([truck({ pos: [4, 0] })]), townWith([])).join('\n')).toContain(
        'cars keep to the paved routes'
      );
    });

    it('flags one on a map that does not exist', () => {
      expect(runEpisode(withCars([truck({ map: 'nowhere' })]), townWith([])).join('\n')).toContain(
        'is on unknown map "nowhere"'
      );
    });

    it('flags one that shares an id with a car the village already has', () => {
      expect(runEpisode(withCars([truck({ id: 'car1' })]), townWith([car()])).join('\n')).toContain(
        'has the same id as a car already on map "town"'
      );
    });

    it('flags two of its own with the same id', () => {
      expect(runEpisode(withCars([truck(), truck({ pos: [5, 2] })]), townWith([])).join('\n')).toContain(
        'is listed twice'
      );
    });

    it('flags one with neither a path nor a place to be parked', () => {
      expect(runEpisode(withCars([{ id: 'pickup', map: 'town', kind: 'pickup', colour: '#8a6b48' }]), townWith([])).join('\n')).toContain(
        'has neither a "path" to drive nor a "pos" to be parked on'
      );
    });
  });
});

describe('driveable', () => {
  const ROADS = ['....', '====', '....'];

  it('is true only on paved tiles inside the map', () => {
    const drive = driveable(makeMap({}, ROADS));
    expect(drive(1, 1)).toBe(true);
    expect(drive(1, 0)).toBe(false);
    expect(drive(-1, 1)).toBe(false);
    expect(drive(9, 1)).toBe(false);
  });

  it('is false where a building stands on the pavement', () => {
    const map = makeMap({ buildings: [{ id: 'shop', pos: [1, 1], size: [1, 1], door: [1, 2] }] }, ROADS);
    expect(driveable(map)(1, 1)).toBe(false);
  });
});
