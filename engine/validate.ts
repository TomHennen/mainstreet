import type { Episode, GameMap, World } from './schema';

/**
 * Load-time validation. This is the M0 stand-in for `scripts/validate-episodes`
 * (DESIGN.md §3): same rules, run in the browser so a broken world pack shows a
 * readable list of problems instead of a blank canvas.
 */
export function validateWorld(world: World): string[] {
  const problems: string[] = [];
  const mapIds = Object.keys(world.maps);

  if (!mapIds.length) problems.push('world has no maps');

  for (const [mapId, map] of Object.entries(world.maps)) {
    const height = map.tiles.length;
    const width = height ? map.tiles[0].length : 0;

    if (!height || !width) {
      problems.push(`map "${mapId}" has no tiles`);
      continue;
    }
    for (let y = 0; y < height; y++) {
      if (map.tiles[y].length !== width) {
        problems.push(`map "${mapId}" row ${y} is ${map.tiles[y].length} wide, expected ${width}`);
      }
      for (const ch of map.tiles[y]) {
        if (!map.legend[ch]) problems.push(`map "${mapId}" uses tile "${ch}" which is not in its legend`);
      }
    }

    for (const placement of map.buildings) {
      if (!world.buildings[placement.id]) {
        problems.push(`map "${mapId}" places unknown building "${placement.id}"`);
      }
      if (isSolid(map, placement.door[0], placement.door[1])) {
        problems.push(`building "${placement.id}" has its door on a solid tile`);
      }
      if (placement.interior) {
        if (!world.maps[placement.interior]) {
          problems.push(`building "${placement.id}" points at unknown interior "${placement.interior}"`);
        } else if (!placement.enter) {
          problems.push(`building "${placement.id}" has an interior but no "enter" spawn`);
        }
      }
    }

    for (const exit of map.exits) {
      const dest = world.maps[exit.to];
      if (!dest) {
        problems.push(`exit "${exit.id}" leads to unknown map "${exit.to}"`);
        continue;
      }
      if (isSolid(dest, exit.spawn[0], exit.spawn[1])) {
        problems.push(`exit "${exit.id}" spawns on a solid tile in "${exit.to}"`);
      }
    }
  }

  const start = world.start;
  if (!world.maps[start.map]) {
    problems.push(`start map "${start.map}" does not exist`);
  } else if (isSolid(world.maps[start.map], start.pos[0], start.pos[1])) {
    problems.push('start position is on a solid tile');
  }

  return problems;
}

export function validateEpisode(episode: Episode, world: World): string[] {
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
    const map = world.maps[mapId];
    if (!map) {
      problems.push(`${where}: ${context} is on unknown map "${mapId}"`);
      return;
    }
    const [x, y] = pos;
    if (y < 0 || y >= map.tiles.length || x < 0 || x >= map.tiles[0].length) {
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
 * than at play.
 */
export function isSolid(map: GameMap, x: number, y: number): boolean {
  if (y < 0 || y >= map.tiles.length) return true;
  const row = map.tiles[y];
  if (x < 0 || x >= row.length) return true;
  if (map.legend[row[x]]?.solid === true) return true;
  return map.buildings.some(
    (b) => x >= b.pos[0] && x < b.pos[0] + b.size[0] && y >= b.pos[1] && y < b.pos[1] + b.size[1]
  );
}
