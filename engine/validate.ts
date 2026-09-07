// Runtime import, so it carries the extension scripts/validate-episodes.ts
// needs under Node's type stripping (see that file's header).
import { FIXTURE_KINDS, plaqueTile } from './schema.ts';
import type { Episode, GameMap, World } from './schema';

/**
 * Load-time validation of a world pack (DESIGN.md §3), run both in the browser
 * at boot — so a broken pack shows a readable list of problems instead of a
 * blank canvas — and by `scripts/validate-episodes`.
 *
 * The tile grids live in Tiled files rather than in world.json, so both
 * functions take the loaded maps alongside the world. They stay pure: whoever
 * read the files (engine/loader.ts, or the script) hands them in. A map file
 * that is malformed throws while it is being parsed (engine/tiled.ts); a map
 * that is missing altogether shows up here.
 */
export function validateWorld(world: World, maps: Record<string, GameMap>): string[] {
  const problems: string[] = [];
  const mapIds = Object.keys(world.maps);

  if (!mapIds.length) problems.push('world has no maps');

  for (const mapId of mapIds) {
    const map = maps[mapId];
    if (!map) {
      problems.push(`map "${mapId}" has no tile grid — expected maps/${mapId}.json`);
      continue;
    }

    for (const placement of map.buildings) {
      if (!world.buildings[placement.id]) {
        problems.push(`map "${mapId}" places unknown building "${placement.id}"`);
      }
      if (isSolid(map, placement.door[0], placement.door[1])) {
        problems.push(`building "${placement.id}" has its door on a solid tile`);
      }
      if (placement.label !== undefined && typeof placement.label !== 'boolean') {
        problems.push(`building "${placement.id}" has a "label" that isn't a boolean`);
      }
      // The plaque is read from its own tile, so the player has to be able to
      // stand on it — and it cannot double up with the door.
      const plaque = plaqueTile(placement);
      if (plaque) {
        const [px, py] = plaque;
        if (px < 0 || py < 0 || px >= map.width || py >= map.height) {
          problems.push(`building "${placement.id}" has its plaque outside the map`);
        } else if (isSolid(map, px, py)) {
          problems.push(`building "${placement.id}" has its plaque on a solid tile`);
        }
        if (px === placement.door[0] && py === placement.door[1]) {
          problems.push(`building "${placement.id}" has its plaque on its own door tile`);
        }
      }
      if (placement.interior) {
        if (!world.maps[placement.interior]) {
          problems.push(`building "${placement.id}" points at unknown interior "${placement.interior}"`);
        } else if (!placement.enter) {
          problems.push(`building "${placement.id}" has an interior but no "enter" spawn`);
        }
      }
    }

    // A fixture is a solid thing standing on a tile of its own, so the tile has
    // to be one the player could otherwise have stood on, and it must not take
    // the place of a door or a plaque — both of which are read by standing on
    // or at that very tile.
    for (const fixture of map.fixtures ?? []) {
      const where = `map "${mapId}" fixture "${fixture.kind}" at ${fixture.pos.join(',')}`;
      if (!FIXTURE_KINDS.includes(fixture.kind)) {
        problems.push(`${where}: unknown fixture kind — expected one of ${FIXTURE_KINDS.join(', ')}`);
      }
      const [fx, fy] = fixture.pos;
      if (fx < 0 || fy < 0 || fx >= map.width || fy >= map.height) {
        problems.push(`${where} is outside the map`);
        continue;
      }
      if (isSolid(map, fx, fy)) problems.push(`${where} is on a solid tile`);
      for (const placement of map.buildings) {
        if (fx === placement.door[0] && fy === placement.door[1]) {
          problems.push(`${where} is on building "${placement.id}"'s door tile`);
        }
        const plaque = plaqueTile(placement);
        if (plaque && fx === plaque[0] && fy === plaque[1]) {
          problems.push(`${where} is on building "${placement.id}"'s plaque tile`);
        }
      }
      if (world.start.map === mapId && fx === world.start.pos[0] && fy === world.start.pos[1]) {
        problems.push(`${where} is on the world's start tile`);
      }
      for (const exit of Object.values(world.maps).flatMap((meta) => meta.exits)) {
        if (exit.to === mapId && fx === exit.spawn[0] && fy === exit.spawn[1]) {
          problems.push(`${where} is on the tile exit "${exit.id}" spawns onto`);
        }
      }
    }

    for (const exit of map.exits) {
      if (!world.maps[exit.to]) {
        problems.push(`exit "${exit.id}" leads to unknown map "${exit.to}"`);
        continue;
      }
      const dest = maps[exit.to];
      // A destination with no grid is already reported against that map.
      if (dest && isSolid(dest, exit.spawn[0], exit.spawn[1])) {
        problems.push(`exit "${exit.id}" spawns on a solid tile in "${exit.to}"`);
      }
    }
  }

  const start = world.start;
  if (!world.maps[start.map]) {
    problems.push(`start map "${start.map}" does not exist`);
  } else if (maps[start.map] && isSolid(maps[start.map], start.pos[0], start.pos[1])) {
    problems.push('start position is on a solid tile');
  }

  return problems;
}

export function validateEpisode(episode: Episode, world: World, maps: Record<string, GameMap>): string[] {
  const problems: string[] = [];
  const declared = new Set(episode.flags);
  const where = `episode "${episode.id}"`;

  const checkFlags = (names: string[] | undefined, context: string) => {
    for (const name of names ?? []) {
      if (!declared.has(name)) problems.push(`${where}: ${context} uses undeclared flag "${name}"`);
    }
  };
  const checkEffects = (effects: { set?: string }[] | undefined, context: string) => {
    for (const effect of effects ?? []) {
      if (effect.set && !declared.has(effect.set)) {
        problems.push(`${where}: ${context} sets undeclared flag "${effect.set}"`);
      }
    }
  };
  const checkPos = (mapId: string, pos: [number, number], context: string) => {
    if (!world.maps[mapId]) {
      problems.push(`${where}: ${context} is on unknown map "${mapId}"`);
      return;
    }
    const map = maps[mapId];
    if (!map) return; // the missing grid is already reported by validateWorld
    const [x, y] = pos;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      problems.push(`${where}: ${context} is outside map "${mapId}"`);
    }
  };

  for (const npc of episode.npcs) {
    checkPos(npc.map, npc.pos, `npc "${npc.id}"`);

    let catchAllAt = -1;
    npc.dialogue.forEach((entry, index) => {
      checkFlags(entry.requires, `npc "${npc.id}" dialogue ${index}`);
      checkEffects(entry.effects, `npc "${npc.id}" dialogue ${index}`);
      // First match wins, so anything after an unconditional entry is dead.
      if (catchAllAt >= 0) {
        problems.push(
          `${where}: npc "${npc.id}" dialogue ${index} is unreachable — entry ${catchAllAt} matches everything`
        );
      } else if (!entry.requires || entry.requires.length === 0) {
        catchAllAt = index;
      }
    });
    if (catchAllAt < 0) {
      problems.push(`${where}: npc "${npc.id}" has no unconditional fallback line`);
    }
  }

  for (const item of episode.items ?? []) {
    checkPos(item.map, item.pos, `item "${item.id}"`);
    checkFlags(item.requires, `item "${item.id}"`);
    checkEffects(item.effects, `item "${item.id}"`);
    if (!item.effects.some((effect) => effect.set)) {
      // Without a flag to set, the item can never be marked as taken.
      problems.push(`${where}: item "${item.id}" has no effect that sets a flag`);
    }
  }

  episode.signs?.forEach((sign, index) => {
    const context = sign.building ? `sign for "${sign.building}"` : `sign ${index}`;
    checkFlags(sign.requires, context);
    // A sign is read at a building's door or at a prop tile, never both.
    const onBuilding = sign.building !== undefined;
    const onProp = sign.map !== undefined || sign.pos !== undefined;
    if (onBuilding === onProp) {
      problems.push(`${where}: ${context} needs exactly one of "building" or "map" + "pos"`);
    } else if (onBuilding) {
      if (!world.buildings[sign.building as string]) {
        problems.push(`${where}: sign refers to unknown building "${sign.building}"`);
      }
    } else if (sign.map === undefined || sign.pos === undefined) {
      problems.push(`${where}: prop sign needs both "map" and "pos"`);
    } else {
      checkPos(sign.map, sign.pos, context);
    }
  });

  return problems;
}

/**
 * The single definition of "you cannot stand here", shared by the collision
 * loop and the validator so a door placed inside a wall fails at load rather
 * than at play. A cell is solid if any layer's tile there is solid, or if a
 * building footprint covers it.
 *
 * Fixtures and NPCs are deliberately not in here: both stand *on* a walkable
 * tile, and the validator has to be able to ask what that tile is like.
 * MapScene blocks the player on them separately.
 */
export function isSolid(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const index = y * map.width + x;
  if (map.layers.some((layer) => layer.cells[index]?.solid === true)) return true;
  return map.buildings.some(
    (b) => x >= b.pos[0] && x < b.pos[0] + b.size[0] && y >= b.pos[1] && y < b.pos[1] + b.size[1]
  );
}
