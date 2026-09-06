import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSolid, validateEpisode, validateWorld } from './validate';
import type { Episode, GameMap, TileDef, World } from './schema';

// --- small fixture builders --------------------------------------------------
// Kept deliberately minimal — just enough to satisfy the schema — so each test
// only sets the one thing it's actually exercising.

const GRASS: TileDef = { name: 'Grass', style: 'flat', colors: ['#0f0'] };
const WALL: TileDef = { name: 'Wall', style: 'flat', colors: ['#000'], solid: true };

function makeMap(overrides: Partial<GameMap> = {}): GameMap {
  return {
    name: 'Town',
    kind: 'village',
    legend: { '.': GRASS, '#': WALL },
    tiles: ['....', '....', '....', '....'],
    buildings: [],
    labels: [],
    exits: [],
    ...overrides
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
    expect(validateWorld(makeWorld())).toEqual([]);
  });

  it('flags a world with no maps', () => {
    const problems = validateWorld(makeWorld({ maps: {} }));
    expect(problems).toContainEqual(expect.stringContaining('world has no maps'));
  });

  it('flags a map with no tiles', () => {
    const world = makeWorld({ maps: { town: makeMap({ tiles: [] }) } });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('map "town" has no tiles');
  });

  it('flags a row whose width does not match the first row', () => {
    const world = makeWorld({ maps: { town: makeMap({ tiles: ['....', '...', '....', '....'] }) } });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toMatch(/map "town" row 1 is 3 wide, expected 4/);
  });

  it('flags a tile character missing from the legend', () => {
    const world = makeWorld({ maps: { town: makeMap({ tiles: ['.X..', '....', '....', '....'] }) } });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('uses tile "X" which is not in its legend');
  });

  it('flags a building placement referencing an unknown building id', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          buildings: [{ id: 'ghost-shop', pos: [0, 0], size: [1, 1], door: [1, 1] }]
        })
      }
    });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('places unknown building "ghost-shop"');
  });

  it('flags a building whose door sits on a solid tile', () => {
    // The door (1,1) sits on a "#" tile that is outside the building's own
    // footprint (3,3), so this exercises the legend-solid check specifically,
    // not "the door is inside its own building".
    const world = makeWorld({
      maps: {
        town: makeMap({
          tiles: ['....', '.##.', '....', '....'],
          buildings: [{ id: 'shop', pos: [3, 3], size: [1, 1], door: [1, 1] }]
        })
      }
    });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('building "shop" has its door on a solid tile');
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
    const problems = validateWorld(world);
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
    const problems = validateWorld(world);
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
    expect(validateWorld(world)).toEqual([]);
  });

  it('flags an exit leading to an unknown map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          exits: [{ id: 'town-nowhere', at: [0, 0, 1, 1], to: 'nowhere', spawn: [0, 0], facing: 'down', style: 'road' }]
        })
      }
    });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('exit "town-nowhere" leads to unknown map "nowhere"');
  });

  it('flags an exit whose spawn point is solid in the destination map', () => {
    const world = makeWorld({
      maps: {
        town: makeMap({
          exits: [{ id: 'town-away', at: [0, 0, 1, 1], to: 'away', spawn: [1, 1], facing: 'down', style: 'road' }]
        }),
        away: makeMap({ tiles: ['....', '.##.', '....', '....'] })
      }
    });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('exit "town-away" spawns on a solid tile in "away"');
  });

  it('flags a start map that does not exist', () => {
    const world = makeWorld({ start: { map: 'nowhere', pos: [0, 0], facing: 'down' } });
    const problems = validateWorld(world);
    expect(problems.join('\n')).toContain('start map "nowhere" does not exist');
  });

  it('flags a start position on a solid tile', () => {
    const world = makeWorld({
      start: { map: 'town', pos: [1, 1], facing: 'down' },
      maps: { town: makeMap({ tiles: ['....', '.#..', '....', '....'] }) }
    });
    const problems = validateWorld(world);
    expect(problems).toContainEqual(expect.stringContaining('start position is on a solid tile'));
  });
});

describe('isSolid', () => {
  const map = makeMap({
    tiles: ['....', '.#..', '....', '....'],
    buildings: [{ id: 'shop', pos: [2, 2], size: [2, 2], door: [2, 3] }]
  });

  it('is true for a legend tile marked solid', () => {
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
    expect(validateEpisode(makeEpisode(), world)).toEqual([]);
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
    const problems = validateEpisode(episode, world);
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
    const problems = validateEpisode(episode, world);
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
    const problems = validateEpisode(episode, world);
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
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" has no unconditional fallback line');
  });

  it('flags an npc placed on an unknown map', () => {
    const episode = makeEpisode({
      npcs: [{ id: 'npc1', name: 'NPC', map: 'nowhere', pos: [1, 1], dialogue: [{ requires: [], lines: ['a'] }] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" is on unknown map "nowhere"');
  });

  it('flags an npc position outside its map', () => {
    const episode = makeEpisode({
      npcs: [{ id: 'npc1', name: 'NPC', map: 'town', pos: [99, 99], dialogue: [{ requires: [], lines: ['a'] }] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('npc "npc1" is outside map "town"');
  });

  it('flags an item position outside its map', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [-1, 0], requires: [], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" is outside map "town"');
  });

  it('flags an item that requires an undeclared flag', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: ['ghostFlag'], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" uses undeclared flag "ghostFlag"');
  });

  it('flags an item effect that sets an undeclared flag', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ set: 'ghostFlag' }], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" sets undeclared flag "ghostFlag"');
  });

  it('flags an item with no effect that sets a flag (it could never be marked taken)', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: [], effects: [{ toast: 'got it' }], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('item "pen" has no effect that sets a flag');
  });

  it('accepts a well-formed item', () => {
    const episode = makeEpisode({
      items: [{ id: 'pen', map: 'town', pos: [0, 0], requires: ['metNpc'], effects: [{ set: 'done' }], lines: ['a'] }]
    });
    expect(validateEpisode(episode, world)).toEqual([]);
  });

  it('flags a sign that requires an undeclared flag', () => {
    const episode = makeEpisode({
      signs: [{ building: 'shop', requires: ['ghostFlag'], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('uses undeclared flag "ghostFlag"');
  });

  it('flags a sign with neither "building" nor "map"+"pos"', () => {
    const episode = makeEpisode({ signs: [{ requires: [], lines: ['a'] }] });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('needs exactly one of "building" or "map" + "pos"');
  });

  it('flags a sign with both "building" and "map"', () => {
    const episode = makeEpisode({
      signs: [{ building: 'shop', map: 'town', pos: [0, 0], requires: [], lines: ['a'] }]
    });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('needs exactly one of "building" or "map" + "pos"');
  });

  it('flags a prop sign that has "pos" but no "map"', () => {
    const episode = makeEpisode({ signs: [{ pos: [0, 0], requires: [], lines: ['a'] }] });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('prop sign needs both "map" and "pos"');
  });

  it('flags a prop sign that has "map" but no "pos"', () => {
    const episode = makeEpisode({ signs: [{ map: 'town', requires: [], lines: ['a'] }] });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('prop sign needs both "map" and "pos"');
  });

  it('flags a building sign referring to an unknown building', () => {
    const episode = makeEpisode({ signs: [{ building: 'ghost-shop', requires: [], lines: ['a'] }] });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('sign refers to unknown building "ghost-shop"');
  });

  it('flags a prop sign whose position is outside its map', () => {
    const episode = makeEpisode({ signs: [{ map: 'town', pos: [99, 99], requires: [], lines: ['a'] }] });
    const problems = validateEpisode(episode, world);
    expect(problems.join('\n')).toContain('is outside map "town"');
  });

  it('accepts a well-formed building sign and a well-formed prop sign', () => {
    const episode = makeEpisode({
      signs: [
        { building: 'shop', requires: [], lines: ['a'] },
        { map: 'town', pos: [0, 0], requires: [], lines: ['b'] }
      ]
    });
    expect(validateEpisode(episode, world)).toEqual([]);
  });
});

describe('worlds/route10 validates cleanly', () => {
  const root = new URL('../worlds/route10/', import.meta.url);

  it('has no problems from validateWorld', () => {
    const world = JSON.parse(readFileSync(new URL('world.json', root), 'utf8')) as World;
    expect(validateWorld(world)).toEqual([]);
  });

  it('has no problems from validateEpisode, for every episode listed in world.json', () => {
    const world = JSON.parse(readFileSync(new URL('world.json', root), 'utf8')) as World;
    for (const episodeId of world.episodes) {
      const episode = JSON.parse(
        readFileSync(new URL(`episodes/${episodeId}.json`, root), 'utf8')
      ) as Episode;
      expect(validateEpisode(episode, world)).toEqual([]);
    }
  });
});
