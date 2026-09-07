// Runtime import, so it carries the extension scripts/validate-episodes.ts
// needs under Node's type stripping (see that file's header).
import { findPath } from './path.ts';
import { BUILDS, FIXTURE_KINDS, HAIR_STYLES, plaqueTile } from './schema.ts';
import type { Episode, GameMap, Look, Route, Submit, Vec2, Wander, World } from './schema';

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

  checkLook(world.player.look, `player "${world.player.id}"`, problems);
  checkSubmit(world.submit, problems);

  // A building's standing sign is the copy its door shows on an ordinary day
  // (DESIGN.md §3). Every building actually standing on a map needs one: the
  // engine's `copy.ui.unpainted` fallback keeps a door from opening an empty
  // box, but it is a stand-in, not copy anyone wrote for that place, and a
  // door the player can walk up to deserves the real thing. A building in the
  // registry that no map places yet is exempt — it is not readable. An empty
  // sign, or an empty page in the middle of one, would open a box with
  // nothing in it.
  const placed = new Set(Object.values(world.maps).flatMap((meta) => meta.buildings.map((b) => b.id)));
  for (const [id, def] of Object.entries(world.buildings)) {
    if (def.sign === undefined) {
      if (placed.has(id)) {
        problems.push(`building "${id}" is placed on a map but has no "sign" — every door needs a standing sign`);
      }
      continue;
    }
    if (!Array.isArray(def.sign) || def.sign.length === 0) {
      problems.push(`building "${id}" has a "sign" that isn't a non-empty array of lines`);
      continue;
    }
    def.sign.forEach((line, index) => {
      if (typeof line !== 'string' || line.trim() === '') {
        problems.push(`building "${id}" sign line ${index} is empty`);
      }
    });
  }

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

    // Townspeople who belong to the village rather than to a story
    // (DESIGN.md §2). They walk, so where they walk is checked the same way a
    // fixture's tile is: on the map, on ground somebody could stand on, and
    // never on a doorstep or a plaque, which are read by standing there.
    const people = map.people ?? [];
    if (people.length > MAX_PEOPLE) {
      problems.push(
        `map "${mapId}" has ${people.length} people — ${MAX_PEOPLE} is as many as a village reads as, not a crowd`
      );
    }
    const seen = new Set<string>();
    for (const person of people) {
      const who = `map "${mapId}" person "${person.id}"`;
      if (typeof person.id !== 'string' || person.id.trim() === '') {
        problems.push(`${who}: every person needs an id`);
      } else if (seen.has(person.id)) {
        problems.push(`${who} is listed twice`);
      }
      seen.add(person.id);
      checkLook(person.look, who, problems);
      checkStand(map, person.pos, `${who}'s "pos"`, problems);
      checkMovement(person, map, who, problems);
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
    checkLook(npc.look, `${where}: npc "${npc.id}"`, problems);
    // A route or a wander is walked over the same ground a world person's is
    // (DESIGN.md §3), so it is checked by the same rules.
    if (npc.route || npc.wander) {
      const map = maps[npc.map];
      if (map) {
        checkStand(map, npc.pos, `${where}: npc "${npc.id}" walks, so its "pos"`, problems);
        checkMovement(npc, map, `${where}: npc "${npc.id}"`, problems);
      }
    }

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
    // `replace` decides whether the building's standing sign still reads after
    // this one (DESIGN.md §3), so it means nothing on a prop, which has no
    // standing sign behind it.
    if (sign.replace !== undefined) {
      if (typeof sign.replace !== 'boolean') {
        problems.push(`${where}: ${context} has a "replace" that isn't a boolean`);
      } else if (!onBuilding) {
        problems.push(`${where}: ${context} sets "replace", which only building signs have`);
      }
    }
  });

  return problems;
}

/** Two or three strollers make a street; a dozen makes a crowd scene. */
const MAX_PEOPLE = 6;

/**
 * Every tile somebody walking may stand on. Deliberately stricter than the
 * player's own walkability: a doorstep and a plaque tile are read by standing
 * exactly there, so a townsperson parked on one would take a building's door
 * away, and a road out of the village is the player's to take, not theirs.
 */
export function moverWalkable(map: GameMap): (x: number, y: number) => boolean {
  const taken = new Set<string>();
  for (const placement of map.buildings) {
    taken.add(`${placement.door[0]},${placement.door[1]}`);
    const plaque = plaqueTile(placement);
    if (plaque) taken.add(`${plaque[0]},${plaque[1]}`);
  }
  for (const fixture of map.fixtures ?? []) taken.add(`${fixture.pos[0]},${fixture.pos[1]}`);
  const exits = map.exits;
  return (x, y) => {
    if (isSolid(map, x, y)) return false;
    if (taken.has(`${x},${y}`)) return false;
    return !exits.some((exit) => x >= exit.at[0] && x < exit.at[0] + exit.at[2] && y >= exit.at[1] && y < exit.at[1] + exit.at[3]);
  };
}

/** A tile somebody may be placed on, or walk to, with the reason if not. */
function checkStand(map: GameMap, pos: Vec2 | undefined, context: string, problems: string[]): boolean {
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => Number.isInteger(n))) {
    problems.push(`${context} is not a tile like [12, 4]`);
    return false;
  }
  const [x, y] = pos;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    problems.push(`${context} is outside the map`);
    return false;
  }
  if (!moverWalkable(map)(x, y)) {
    problems.push(`${context} at ${x},${y} is somewhere nobody can stand — a wall, a doorstep, a plaque, a fixture or a way out of town`);
    return false;
  }
  return true;
}

/**
 * A `route` or a `wander` (DESIGN.md §2/§3). Exactly one of the two, every
 * waypoint somewhere a person could stand, every waypoint actually walkable to
 * from the tile before it, and a wander with somewhere to wander to. A route
 * that cannot be walked would leave somebody standing still for ever, which
 * looks like a bug and reads like one.
 */
function checkMovement(
  who: { pos: Vec2; route?: Route; wander?: Wander },
  map: GameMap,
  context: string,
  problems: string[]
): void {
  const { route, wander } = who;
  if (route && wander) {
    problems.push(`${context} has both a "route" and a "wander" — a person walks one or the other`);
    return;
  }
  const walkable = moverWalkable(map);

  if (route) {
    if (!Array.isArray(route.path) || route.path.length < 2) {
      problems.push(`${context} has a "route" with fewer than two waypoints`);
      return;
    }
    if (route.loop !== undefined && typeof route.loop !== 'boolean') {
      problems.push(`${context} has a route "loop" that isn't a boolean`);
    }
    if (route.pause !== undefined && (typeof route.pause !== 'number' || !(route.pause >= 0))) {
      problems.push(`${context} has a route "pause" that isn't a number of seconds`);
    }
    if (route.speed !== undefined && (typeof route.speed !== 'number' || !(route.speed > 0))) {
      problems.push(`${context} has a route "speed" that isn't tiles per second`);
    }
    let ok = true;
    route.path.forEach((point, index) => {
      if (!checkStand(map, point, `${context} route waypoint ${index}`, problems)) ok = false;
    });
    if (!ok) return;
    // Each leg in turn, starting where the person is placed and ending back at
    // the first waypoint when the route loops.
    const legs: Vec2[] = [who.pos, ...route.path];
    if (route.loop !== false) legs.push(route.path[0]);
    for (let i = 1; i < legs.length; i++) {
      const from = legs[i - 1];
      const to = legs[i];
      if (from[0] === to[0] && from[1] === to[1]) continue;
      const found = findPath(from, (x, y) => x === to[0] && y === to[1], walkable);
      if (!found) {
        problems.push(`${context} cannot walk from ${from.join(',')} to ${to.join(',')} — no way through`);
      }
    }
    return;
  }

  if (wander) {
    if (typeof wander.radius !== 'number' || !(wander.radius >= 1)) {
      problems.push(`${context} has a "wander" radius below 1 — there would be nowhere to go`);
      return;
    }
    if (wander.pause !== undefined && (typeof wander.pause !== 'number' || !(wander.pause >= 0))) {
      problems.push(`${context} has a wander "pause" that isn't a number of seconds`);
    }
    // A wanderer stays inside the radius the whole way round, so that is what
    // "reachable" means here too (engine/mover.ts `roam`).
    const inside = (x: number, y: number) =>
      walkable(x, y) && Math.hypot(x - who.pos[0], y - who.pos[1]) <= wander.radius;
    const span = Math.ceil(wander.radius);
    let spots = 0;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (Math.hypot(dx, dy) > wander.radius) continue;
        const x = who.pos[0] + dx;
        const y = who.pos[1] + dy;
        if (!inside(x, y)) continue;
        if (findPath(who.pos, (gx, gy) => gx === x && gy === y, inside)) spots++;
      }
    }
    if (!spots) {
      problems.push(`${context} has a "wander" with no tile within ${wander.radius} of ${who.pos.join(',')} to walk to`);
    }
  }
}

/**
 * `submit.art` — where the Studio sends a painter to finish a drawing
 * (DESIGN.md §4). Optional entirely; a world without it keeps the Studio's
 * email route. `form` and `fields` are checked because a mistyped one would
 * fail in a way nobody could see: the field ids only get exercised by a real
 * prefilled link, so a typo here would quietly send the town's name into the
 * wrong box on Google's page rather than failing anywhere obvious. `page`, if
 * given, is checked the same way `form` is; a pack that leaves it out gets it
 * derived from `form` instead (studio.ts).
 */
function checkSubmit(submit: Submit | undefined, problems: string[]): void {
  if (submit === undefined) return;
  if (typeof submit !== 'object' || Array.isArray(submit)) {
    problems.push('world has a "submit" that is not an object');
    return;
  }
  const art = submit.art;
  if (art === undefined) return;
  if (typeof art !== 'object' || Array.isArray(art)) {
    problems.push('world has a "submit.art" that is not an object');
    return;
  }
  if (typeof art.form !== 'string' || !art.form.startsWith('https://')) {
    problems.push('world "submit.art" needs a "form" URL beginning https://');
  }
  if (art.page !== undefined && (typeof art.page !== 'string' || !art.page.startsWith('https://'))) {
    problems.push('world "submit.art" has a "page" that is not a URL beginning https://');
  }
  const fields = art.fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    problems.push('world "submit.art" needs a "fields" object naming the form\'s field ids');
    return;
  }
  for (const name of ['building', 'world', 'credit', 'code'] as const) {
    const value = fields[name];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`world "submit.art" has no field id for "${name}"`);
    }
  }
  if (fields.notes !== undefined && (typeof fields.notes !== 'string' || fields.notes.trim() === '')) {
    problems.push('world "submit.art" has a "notes" field id that is empty');
  }
}

/** Colour fields accept the two hex spellings a world pack ever writes. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LOOK_FIELDS = ['hair', 'hairColor', 'skin', 'shirt', 'build'] as const;

/**
 * A placeholder person's `look` (DESIGN.md §4). Everything in it is optional,
 * so the check is only that what *is* there is something the engine can draw:
 * a hair style and a build from the vocabulary, colours that are colours, and
 * no field the engine has never heard of — a misspelt one would otherwise
 * silently leave that character looking like everybody else.
 */
function checkLook(look: Look | undefined, context: string, problems: string[]): void {
  if (look === undefined) return;
  if (typeof look !== 'object' || Array.isArray(look)) {
    problems.push(`${context} has a "look" that isn't an object`);
    return;
  }
  for (const field of Object.keys(look)) {
    if (!(LOOK_FIELDS as readonly string[]).includes(field)) {
      problems.push(`${context} look has unknown field "${field}" — expected one of ${LOOK_FIELDS.join(', ')}`);
    }
  }
  if (look.hair !== undefined && !(HAIR_STYLES as readonly string[]).includes(look.hair)) {
    problems.push(`${context} look has unknown hair "${look.hair}" — expected one of ${HAIR_STYLES.join(', ')}`);
  }
  if (look.build !== undefined && !(BUILDS as readonly string[]).includes(look.build)) {
    problems.push(`${context} look has unknown build "${look.build}" — expected one of ${BUILDS.join(', ')}`);
  }
  for (const field of ['hairColor', 'skin', 'shirt'] as const) {
    const value = look[field];
    if (value !== undefined && (typeof value !== 'string' || !HEX.test(value))) {
      problems.push(`${context} look has a "${field}" that isn't a hex colour like "#a06c3f"`);
    }
  }
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
