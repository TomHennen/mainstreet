// Runtime import, so it carries the extension scripts/validate-episodes.ts
// needs under Node's type stripping (see that file's header).
import { rectsOverlap } from './edges.ts';
import { findPath } from './path.ts';
import { canCoOccur, combinations, overlapsIn, patchFor, withOverlays } from './overlay.ts';
import {
  BUILDS,
  FACINGS,
  FIXTURE_KINDS,
  HAIR_STYLES,
  MAX_WAIT,
  plaqueTile,
  signBoardTile,
  SCENE_PLAYER,
  SCENE_VEHICLE,
  sceneFlags,
  VEHICLE_KINDS
} from './schema.ts';
import type {
  Episode,
  EpisodeScene,
  GameMap,
  LightSpec,
  Look,
  MapOverlay,
  Route,
  SceneStep,
  Submit,
  Vec2,
  Vehicle,
  Wander,
  World
} from './schema';

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
        // Once the door only opens, the sign board beside it is where the
        // player actually reads the place's standing sign — so it needs the
        // same "can stand here" guarantees the door and the plaque get.
        const board = signBoardTile(placement);
        if (board) {
          const [bx, by] = board;
          if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) {
            problems.push(`building "${placement.id}" has its sign board outside the map`);
          } else if (isSolid(map, bx, by)) {
            problems.push(`building "${placement.id}" has its sign board on a solid tile`);
          }
          if (bx === placement.door[0] && by === placement.door[1]) {
            problems.push(`building "${placement.id}" has its sign board on its own door tile`);
          }
          if (plaque && bx === plaque[0] && by === plaque[1]) {
            problems.push(`building "${placement.id}" has its sign board on its own plaque tile`);
          }
        }
      } else if (placement.signAt) {
        problems.push(`building "${placement.id}" has a "signAt" but no interior — its door already reads the sign`);
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

      // The carry verbs (DESIGN.md §2). A fixture hands a token over or spends
      // one, never both, and whichever it does it has to have the words for
      // both outcomes: what it says when the log changes hands, and what it
      // says when it cannot.
      const token = (name: 'give' | 'take', value: unknown) => {
        if (value === undefined) return false;
        if (typeof value !== 'string' || !value.trim()) {
          problems.push(`${where}: "${name}" is not a name for the thing being carried`);
        }
        return true;
      };
      const gives = token('give', fixture.give);
      const takes = token('take', fixture.take);
      if (gives && takes) {
        problems.push(`${where} both gives and takes — a fixture does one or the other`);
      }
      const words = (name: 'lines' | 'otherwise', value: unknown) => {
        if (value === undefined) {
          problems.push(`${where} carries a "${fixture.give ? 'give' : 'take'}" but no "${name}" to say`);
          return;
        }
        if (!Array.isArray(value) || !value.length || value.some((line) => typeof line !== 'string' || !line.trim())) {
          problems.push(`${where}: "${name}" has nothing to read on it`);
        }
      };
      if (gives || takes) {
        words('lines', fixture.lines);
        words('otherwise', fixture.otherwise);
      } else if (fixture.lines !== undefined) {
        words('lines', fixture.lines);
      }
      if (fixture.glow !== undefined && (typeof fixture.glow !== 'number' || !(fixture.glow > 0))) {
        problems.push(`${where}: "glow" is how many seconds it burns for, so it has to be more than none`);
      }
      if (fixture.glow !== undefined && !takes) {
        problems.push(`${where}: "glow" is what a fixture does when it takes something, and this one takes nothing`);
      }
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

    // A sign that belongs to the map rather than to a story (DESIGN.md §2).
    // It is read from beside it, so it needs somewhere to be read from — the
    // tile itself where that is walkable, and otherwise a neighbour.
    for (const sign of map.signs ?? []) {
      const where = `map "${mapId}" sign at ${sign.pos.join(',')}`;
      const [sx, sy] = sign.pos;
      if (sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) {
        problems.push(`${where} is outside the map`);
        continue;
      }
      if (!sign.lines?.length || sign.lines.some((line) => typeof line !== 'string' || !line.trim())) {
        problems.push(`${where} has nothing to read on it`);
      }
      const reachable = [
        [sx, sy],
        [sx - 1, sy],
        [sx + 1, sy],
        [sx, sy - 1],
        [sx, sy + 1]
      ].some(([x, y]) => !isSolid(map, x, y));
      if (!reachable) problems.push(`${where} has nowhere beside it to read it from`);
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
      // "Stand-able" is per-tile only — solid, a doorstep, a plaque, an exit
      // (moverWalkable) — never whether the tile connects to the door on
      // foot, so somebody posted behind a counter in a staff strip sealed off
      // from the room (unreachable on foot, same as Hannah's spot behind
      // Stewart's counter) still validates fine: they are talked to across
      // it, at an interior's talking reach (engine/scenes/map.ts), never
      // walked up to.
      checkStand(map, person.pos, `${who}'s "pos"`, problems);
      checkMovement(person, map, who, problems);
      if (person.lines !== undefined) {
        if (!Array.isArray(person.lines) || person.lines.length === 0) {
          problems.push(`${who} has "lines" that isn't a non-empty array`);
        } else {
          person.lines.forEach((line, index) => {
            if (typeof line !== 'string' || line.trim() === '') {
              problems.push(`${who} lines[${index}] is empty`);
            }
          });
        }
      }
    }

    // Ambient traffic (DESIGN.md §2). Cars keep to the paved routes, which is
    // the one thing about them that has to be checked: a path over a side
    // street or a lawn would put a car somewhere no car belongs.
    const vehicles = map.vehicles ?? [];
    if (vehicles.length > MAX_VEHICLES) {
      problems.push(
        `map "${mapId}" has ${vehicles.length} vehicles — ${MAX_VEHICLES} is as much traffic as a village reads as`
      );
    }
    const seenVehicles = new Set<string>();
    for (const vehicle of vehicles) {
      const which = `map "${mapId}" vehicle "${vehicle.id}"`;
      if (typeof vehicle.id !== 'string' || vehicle.id.trim() === '') {
        problems.push(`${which}: every vehicle needs an id`);
      } else if (seenVehicles.has(vehicle.id)) {
        problems.push(`${which} is listed twice`);
      }
      seenVehicles.add(vehicle.id);
      checkVehicle(vehicle, map, which, problems);
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

    // Road ends (DESIGN.md §2): a rectangle shaped like an exit's, but it
    // says something instead of leading somewhere. It has to sit inside the
    // map, and it must never share a tile with an actual way out — a road
    // cannot both leave town and dead-end in the same place.
    for (const edge of map.edges ?? []) {
      const where = `map "${mapId}" edge "${edge.id}"`;
      const [ex, ey, ew, eh] = edge.at;
      if (ex < 0 || ey < 0 || ex + ew > map.width || ey + eh > map.height) {
        problems.push(`${where} is outside the map`);
      }
      for (const exit of map.exits) {
        if (rectsOverlap(exit.at, edge.at)) {
          problems.push(`${where} overlaps exit "${exit.id}"`);
        }
      }
      if (!Array.isArray(edge.lines) || edge.lines.length === 0) {
        problems.push(`${where} has no "lines"`);
      } else {
        edge.lines.forEach((line, index) => {
          if (typeof line !== 'string' || line.trim() === '') {
            problems.push(`${where} line ${index} is empty`);
          }
        });
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
  // A `once` scene's `scene:<id>` flag is declared for the episode rather than
  // by it (DESIGN.md §3), so it counts as declared here too.
  const declared = new Set([...episode.flags, ...sceneFlags(episode)]);
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

  const checkLines = (lines: string[] | undefined, context: string) => {
    if (lines === undefined) return;
    lines.forEach((line, index) => {
      if (typeof line !== 'string' || line.length === 0) {
        problems.push(`${where}: ${context} line ${index} must be a non-empty string`);
      }
    });
  };
  checkLines(episode.intro, '"intro"');
  checkLines(episode.smallTalk, '"smallTalk"');

  // A world person with no story of their own picks their small talk by
  // hashing their id against the pool (engine/session.ts's smallTalkFor), so
  // the same person always says the same thing — but with fewer lines than
  // there are ambient people, some of them are guaranteed to land on the same
  // line and repeat it, verbatim, to everyone who asks, all week.
  if (episode.smallTalk) {
    const ambientPeople = Object.values(world.maps).reduce((sum, meta) => sum + (meta.people?.length ?? 0), 0);
    if (episode.smallTalk.length < ambientPeople) {
      problems.push(
        `${where}: "smallTalk" has ${episode.smallTalk.length} line${episode.smallTalk.length === 1 ? '' : 's'} ` +
          `for ${ambientPeople} ambient people across the world — too few, and several of them will hash onto the ` +
          `same line and repeat it word for word; add more (at least ${ambientPeople})`
      );
    }
  }

  // The cars this week brings with it (DESIGN.md §3). They are the map's own
  // vehicles in every respect but one — they stand only while this episode
  // plays — so they are checked by exactly the same rules, against the map
  // they name.
  const episodeVehicles = episode.vehicles ?? [];
  const seenVehicles = new Set<string>();
  for (const vehicle of episodeVehicles) {
    const which = `${where}: vehicle "${vehicle.id ?? '(unnamed)'}"`;
    if (typeof vehicle.id !== 'string' || vehicle.id.trim() === '') {
      problems.push(`${where}: every vehicle needs an id`);
      continue;
    }
    if (seenVehicles.has(vehicle.id)) problems.push(`${which} is listed twice`);
    seenVehicles.add(vehicle.id);
    if (!world.maps[vehicle.map]) {
      problems.push(`${which} is on unknown map "${vehicle.map}"`);
      continue;
    }
    // One id per map, or "vehicle:<id>" in a scene would name two cars.
    if ((world.maps[vehicle.map].vehicles ?? []).some((one) => one.id === vehicle.id)) {
      problems.push(`${which} has the same id as a car already on map "${vehicle.map}"`);
    }
    const map = maps[vehicle.map];
    if (!map) continue; // the missing grid is already reported by validateWorld
    checkVehicle(vehicle, map, which, problems);
  }

  checkOverlays(episode, world, maps, declared, problems);
  checkScenes(episode, world, maps, declared, problems);

  return problems;
}

// --- scenes (DESIGN.md §3) ---------------------------------------------------

/** The action fields a step may carry. Exactly one of them, always. */
const STEP_ACTIONS = ['move', 'say', 'toast', 'wait', 'camera', 'set', 'light', 'end'] as const;
const LIGHT_MODES = ['off', 'dim', 'party'] as const;

/**
 * An episode's scenes: that the steps are steps the engine can play, that
 * everybody they name is somebody on that map, and that every tile they send
 * anyone to is a tile that person could stand on. A scene that cannot stage
 * itself is a week of story the player watches nothing happen in, so it is
 * caught here rather than at play.
 */
function checkScenes(
  episode: Episode,
  world: World,
  maps: Record<string, GameMap>,
  declared: Set<string>,
  problems: string[]
): void {
  const where = `episode "${episode.id}"`;
  const seen = new Set<string>();

  for (const scene of episode.scenes ?? []) {
    const at = `${where}: scene "${scene.id ?? '(unnamed)'}"`;
    if (typeof scene.id !== 'string' || scene.id.trim() === '') {
      problems.push(`${where}: every scene needs an id`);
      continue;
    }
    if (seen.has(scene.id)) problems.push(`${at} is listed twice`);
    seen.add(scene.id);
    if (scene.once !== undefined && typeof scene.once !== 'boolean') {
      problems.push(`${at} has a "once" that isn't a boolean`);
    }

    // The trigger, and the map the scene is staged on — which is what every
    // tile in it is measured against.
    const on = scene.on;
    if (!on || typeof on !== 'object') {
      problems.push(`${at} needs an "on" of { flag } or { enter }`);
      continue;
    }
    if (Boolean(on.flag) === Boolean(on.enter)) {
      problems.push(`${at} needs exactly one of "on.flag" or "on.enter"`);
    }
    if (on.flag && !declared.has(on.flag)) {
      problems.push(`${at} is triggered by undeclared flag "${on.flag}"`);
    }
    if (on.requires && !on.enter) {
      problems.push(`${at} has "on.requires", which only an "on.enter" scene has`);
    }
    for (const name of on.requires ?? []) {
      if (!declared.has(name)) problems.push(`${at} requires undeclared flag "${name}"`);
    }

    const mapId = on.enter ?? sceneMap(episode, scene);
    if (on.enter && !world.maps[on.enter]) {
      problems.push(`${at} is entered on unknown map "${on.enter}"`);
    }
    const map = mapId ? maps[mapId] : undefined;

    if (!Array.isArray(scene.steps) || scene.steps.length === 0) {
      problems.push(`${at} has no steps`);
      continue;
    }
    scene.steps.forEach((step, index) => {
      checkStep(step, `${at} step ${index}`, { episode, world, map, mapId, declared, problems });
    });
  }
}

/**
 * Where a scene is staged. `on.enter` says so outright; a scene triggered by a
 * flag is staged wherever the people it moves are, which is the only place its
 * tiles could mean anything.
 */
function sceneMap(episode: Episode, scene: EpisodeScene): string | undefined {
  for (const step of scene.steps ?? []) {
    const who = step.move?.who;
    if (!who || who === SCENE_PLAYER) continue;
    if (who.startsWith(SCENE_VEHICLE)) {
      // A car the episode brought with it says which map it is on; a
      // village's own is found by whoever else the scene moves.
      const id = who.slice(SCENE_VEHICLE.length);
      const vehicle = (episode.vehicles ?? []).find((one) => one.id === id);
      if (vehicle) return vehicle.map;
      continue;
    }
    const npc = episode.npcs.find((one) => one.id === who);
    if (npc) return npc.map;
  }
  return undefined;
}

interface StepContext {
  episode: Episode;
  world: World;
  map: GameMap | undefined;
  mapId: string | undefined;
  declared: Set<string>;
  problems: string[];
}

function checkStep(step: SceneStep, at: string, ctx: StepContext): void {
  const { episode, world, map, mapId, declared, problems } = ctx;
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    problems.push(`${at} is not a step object`);
    return;
  }
  const actions = STEP_ACTIONS.filter((name) => step[name] !== undefined);
  if (actions.length !== 1) {
    problems.push(
      actions.length
        ? `${at} does ${actions.length} things at once (${actions.join(', ')}) — a step does exactly one`
        : `${at} does nothing — expected one of ${STEP_ACTIONS.join(', ')}`
    );
    return;
  }

  if (step.move) {
    const move = step.move;
    const who = move.who;
    if (typeof who !== 'string' || !who) {
      problems.push(`${at} moves nobody — "who" is a person's id, "player", or "vehicle:<id>"`);
      return;
    }
    if (who !== SCENE_PLAYER) {
      if (who.startsWith(SCENE_VEHICLE)) {
        // Vehicles are a map's own, like its townspeople. A world with none
        // simply has nothing for this to name (CLAUDE.md hard rule 3).
        const id = who.slice(SCENE_VEHICLE.length);
        const vehicles = mapId ? vehiclesOn(world, episode, mapId) : [];
        if (!vehicles.includes(id)) {
          problems.push(`${at} moves "${who}", which is not a vehicle on map "${mapId ?? '?'}"`);
        }
      } else {
        const npc = episode.npcs.find((one) => one.id === who);
        if (!npc) problems.push(`${at} moves "${who}", who is not in this episode`);
        else if (mapId && npc.map !== mapId) {
          problems.push(`${at} moves "${who}", who is on map "${npc.map}" and not on "${mapId}"`);
        }
      }
    }
    if ((move.to === undefined) === (move.path === undefined)) {
      problems.push(`${at} needs exactly one of "to" or "path"`);
      return;
    }
    if (move.speed !== undefined && (typeof move.speed !== 'number' || !(move.speed > 0))) {
      problems.push(`${at} has a "speed" that isn't tiles per second`);
    }
    const tiles = move.path ?? [move.to as Vec2];
    if (move.path && (!Array.isArray(move.path) || move.path.length === 0)) {
      problems.push(`${at} has an empty "path"`);
      return;
    }
    if (!map) return;
    // The player may stand on a doorstep or a plaque tile; nobody else may,
    // because those are read by standing exactly there (moverWalkable). A car
    // stands on none of them: it keeps to the paved routes, all the way out of
    // town if that is where the scene sends it, so it is measured against
    // `driveable` instead (DESIGN.md §2).
    // A map with no paved tiles at all — an interior — has nowhere a car
    // could go by that rule, so there anywhere it would fit will do, exactly
    // as `checkVehicle` reads a map with no roads on it (hard rule 3).
    const drives = who.startsWith(SCENE_VEHICLE);
    const paved = drives && anyDrivable(map);
    const canStand =
      drives && paved
        ? driveable(map)
        : drives || who === SCENE_PLAYER
          ? (x: number, y: number) => !isSolid(map, x, y)
          : moverWalkable(map);
    let ok = true;
    tiles.forEach((tile, index) => {
      const label = move.path ? `${at} path ${index}` : `${at} target`;
      if (!Array.isArray(tile) || tile.length !== 2 || !tile.every((n) => Number.isInteger(n))) {
        problems.push(`${label} is not a tile like [12, 4]`);
        ok = false;
        return;
      }
      if (tile[0] < 0 || tile[1] < 0 || tile[0] >= map.width || tile[1] >= map.height) {
        problems.push(`${label} at ${tile.join(',')} is outside the map`);
        ok = false;
        return;
      }
      if (!canStand(tile[0], tile[1])) {
        problems.push(
          drives && paved
            ? `${label} at ${tile.join(',')} is not a tile a vehicle can drive on — cars keep to the paved routes`
            : `${label} at ${tile.join(',')} is somewhere "${who}" cannot stand`
        );
        ok = false;
      }
    });
    // And that there is paved road between the legs, starting from wherever
    // the episode parked the car: a scene that cannot drive its truck out of
    // the lot is a week of story where nothing happens (as `checkVehicle`).
    if (ok && drives && paved) {
      const parked = (episode.vehicles ?? []).find(
        (vehicle) => vehicle.id === who.slice(SCENE_VEHICLE.length) && vehicle.map === mapId
      );
      const drive = driveable(map);
      const legs = [...(parked?.pos ? [parked.pos] : []), ...(tiles as Vec2[])];
      for (let i = 1; i < legs.length; i++) {
        const from = legs[i - 1];
        const to = legs[i];
        if (from[0] === to[0] && from[1] === to[1]) continue;
        if (!findPath(from, (x, y) => x === to[0] && y === to[1], drive)) {
          problems.push(`${at} cannot drive from ${from.join(',')} to ${to.join(',')} — no paved way through`);
        }
      }
    }
    return;
  }

  if (step.say) {
    const say = step.say;
    if (say.who !== undefined && !episode.npcs.some((one) => one.id === say.who)) {
      problems.push(`${at} has "${say.who}" speaking, who is not in this episode`);
    }
    if (!Array.isArray(say.lines) || say.lines.length === 0) {
      problems.push(`${at} says nothing — "lines" is a non-empty array`);
      return;
    }
    say.lines.forEach((line, index) => {
      if (typeof line !== 'string' || line.trim() === '') problems.push(`${at} line ${index} is empty`);
    });
    return;
  }

  if (step.toast !== undefined) {
    if (typeof step.toast !== 'string' || step.toast.trim() === '') problems.push(`${at} has an empty toast`);
    return;
  }

  if (step.wait !== undefined) {
    if (typeof step.wait !== 'number' || !(step.wait > 0)) {
      problems.push(`${at} has a "wait" that isn't a number of seconds`);
    } else if (step.wait > MAX_WAIT) {
      problems.push(`${at} waits ${step.wait}s — ${MAX_WAIT}s is as long as a beat should ever hold`);
    }
    return;
  }

  if (step.camera) {
    const to = step.camera.to;
    if (to === SCENE_PLAYER) return;
    if (!Array.isArray(to) || to.length !== 2 || !to.every((n) => Number.isInteger(n))) {
      problems.push(`${at} looks at neither a tile like [12, 4] nor "player"`);
      return;
    }
    if (step.camera.speed !== undefined && (typeof step.camera.speed !== 'number' || !(step.camera.speed > 0))) {
      problems.push(`${at} has a camera "speed" that isn't tiles per second`);
    }
    if (map && (to[0] < 0 || to[1] < 0 || to[0] >= map.width || to[1] >= map.height)) {
      problems.push(`${at} looks at ${to.join(',')}, which is outside the map`);
    }
    return;
  }

  if (step.set !== undefined) {
    if (typeof step.set !== 'string' || !declared.has(step.set)) {
      problems.push(`${at} sets undeclared flag "${String(step.set)}"`);
    }
    return;
  }

  if (step.light) checkLight(step.light, at, map, problems);
}

function checkLight(light: LightSpec, at: string, map: GameMap | undefined, problems: string[]): void {
  if (typeof light !== 'object' || Array.isArray(light)) {
    problems.push(`${at} has a "light" that isn't an object`);
    return;
  }
  if (!(LIGHT_MODES as readonly string[]).includes(light.mode)) {
    problems.push(`${at} has light mode "${String(light.mode)}" — expected one of ${LIGHT_MODES.join(', ')}`);
  }
  if (light.keep !== undefined && typeof light.keep !== 'boolean') {
    problems.push(`${at} has a light "keep" that isn't a boolean`);
  }
  if (light.period !== undefined && (typeof light.period !== 'number' || !(light.period > 0))) {
    problems.push(`${at} has a light "period" that isn't a number of seconds`);
  }
  for (const colour of light.colours ?? []) {
    if (typeof colour !== 'string' || !HEX.test(colour)) {
      problems.push(`${at} has a light colour "${String(colour)}" that isn't a hex colour like "#d9a441"`);
    }
  }
  (light.at ?? []).forEach((tile, index) => {
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every((n) => Number.isInteger(n))) {
      problems.push(`${at} light ${index} is not a tile like [12, 4]`);
      return;
    }
    if (map && (tile[0] < 0 || tile[1] < 0 || tile[0] >= map.width || tile[1] >= map.height)) {
      problems.push(`${at} hangs a light at ${tile.join(',')}, outside the map`);
    }
  });
  if (light.mode !== 'party' && (light.at?.length || light.colours?.length)) {
    problems.push(`${at} names lights or colours on a "${light.mode}" step, which has neither`);
  }
}

/**
 * Every car a scene on this map could name: the map's own, and the running
 * episode's (DESIGN.md §3). Read defensively — they arrive with their own
 * issues, and a world or an episode without any simply has none for a scene
 * to name.
 */
function vehiclesOn(world: World, episode: Episode, mapId: string): string[] {
  const meta = world.maps[mapId] as { vehicles?: { id?: string }[] } | undefined;
  const own = (episode.vehicles ?? []).filter((vehicle) => vehicle?.map === mapId);
  return [...(meta?.vehicles ?? []), ...own].map((vehicle) => vehicle?.id ?? '').filter(Boolean);
}

// --- map overlays (DESIGN.md §3) ---------------------------------------------

/**
 * The overlays an episode paints onto a village's one canonical map. What
 * matters here is that they cannot strand anybody: an episode is free to put a
 * marquee on the green, and not free to put it across the only way to the post
 * office door. Every combination of overlays that could be on together is
 * checked, because "each one is fine on its own" is not the same thing.
 */
function checkOverlays(
  episode: Episode,
  world: World,
  maps: Record<string, GameMap>,
  declared: Set<string>,
  problems: string[]
): void {
  const where = `episode "${episode.id}"`;
  const overlays = episode.overlays ?? [];
  if (!overlays.length) return;

  const seen = new Set<string>();
  for (const overlay of overlays) {
    const at = `${where}: overlay "${overlay.id ?? '(unnamed)'}"`;
    if (typeof overlay.id !== 'string' || overlay.id.trim() === '') {
      problems.push(`${where}: every overlay needs an id`);
      continue;
    }
    if (seen.has(overlay.id)) problems.push(`${at} is listed twice`);
    seen.add(overlay.id);

    for (const name of overlay.requires ?? []) {
      if (!declared.has(name)) problems.push(`${at} requires undeclared flag "${name}"`);
    }
    for (const name of overlay.unless ?? []) {
      if (!declared.has(name)) problems.push(`${at} has an "unless" on undeclared flag "${name}"`);
    }
    if (!canCoOccur([overlay])) {
      problems.push(`${at} requires and rules out the same flag, so it can never be on`);
    }

    const map = maps[overlay.map];
    if (!world.maps[overlay.map]) {
      problems.push(`${at} patches unknown map "${overlay.map}"`);
      continue;
    }
    if (!map) continue; // the missing grid is already reported by validateWorld

    if (!Array.isArray(overlay.tiles) || (!overlay.tiles.length && !overlay.fixtures?.length && !overlay.props?.length)) {
      problems.push(`${at} paints nothing`);
      continue;
    }
    for (const paint of overlay.tiles) {
      if (!Array.isArray(paint?.pos) || paint.pos.length !== 2 || !paint.pos.every((n) => Number.isInteger(n))) {
        problems.push(`${at} has a tile that is not at a position like [12, 4]`);
        continue;
      }
      const [x, y] = paint.pos;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
        problems.push(`${at} paints ${x},${y}, which is outside map "${overlay.map}"`);
      }
    }
    for (const bad of patchFor(map, [overlay]).unknown) {
      problems.push(`${at} paints tile ${JSON.stringify(bad.tile)} at ${bad.pos.join(',')}, which no tileset "${overlay.map}" uses has`);
    }
    for (const prop of overlay.props ?? []) {
      if (!Array.isArray(prop?.pos) || prop.pos.length !== 2 || !prop.pos.every((n) => Number.isInteger(n))) {
        problems.push(`${at} has a prop that is not at a position like [12, 4]`);
        continue;
      }
      if (!Array.isArray(prop.lines) || !prop.lines.length || prop.lines.some((line) => typeof line !== 'string' || !line.trim())) {
        problems.push(`${at} has a prop at ${prop.pos.join(',')} with nothing to read`);
      }
    }
    for (const fixture of overlay.fixtures ?? []) {
      if (!FIXTURE_KINDS.includes(fixture?.kind)) {
        problems.push(`${at} brings an unknown fixture kind "${String(fixture?.kind)}"`);
      }
    }
  }

  // Every combination that could be on at once, the plain map included: a door
  // reachable under each overlay on its own can still be walled in by two.
  const byMap = new Map<string, MapOverlay[]>();
  for (const overlay of overlays) {
    if (!maps[overlay.map]) continue;
    byMap.set(overlay.map, [...(byMap.get(overlay.map) ?? []), overlay]);
  }
  for (const [mapId, list] of byMap) {
    for (const set of combinations(list)) {
      if (!set.length) continue;
      const named = set.map((overlay) => `"${overlay.id}"`).join(' + ');
      for (const problem of unreachableWith(world, maps, mapId, set)) {
        problems.push(`${where}: with ${named} on, ${problem}`);
      }
    }
  }
}

/**
 * Everything on a map that has to stay walkable up to: every door, every
 * plaque, the tile beside every fixture, and every way off the map. Measured
 * from where the player can arrive — the world's start, and every tile
 * anything spawns them onto — because that is where they will be standing.
 */
function unreachableWith(
  world: World,
  maps: Record<string, GameMap>,
  mapId: string,
  overlays: MapOverlay[]
): string[] {
  const base = maps[mapId];
  const map = withOverlays(base, overlays);
  const out: string[] = [];

  const arrivals: Vec2[] = [];
  if (world.start.map === mapId) arrivals.push([world.start.pos[0], world.start.pos[1]]);
  for (const meta of Object.values(world.maps)) {
    for (const exit of meta.exits) {
      if (exit.to === mapId) arrivals.push([exit.spawn[0], exit.spawn[1]]);
    }
    for (const placement of meta.buildings) {
      if (placement.interior === mapId && placement.enter) arrivals.push([placement.enter[0], placement.enter[1]]);
    }
  }
  if (!arrivals.length) return out;

  // The player's own walkability: solid ground and the fixtures standing on it.
  const blocked = new Set((map.fixtures ?? []).map((fixture) => `${fixture.pos[0]},${fixture.pos[1]}`));
  const walkable = (x: number, y: number) => !isSolid(map, x, y) && !blocked.has(`${x},${y}`);

  const reachable = new Set<string>();
  for (const from of arrivals) {
    if (!walkable(from[0], from[1])) {
      out.push(`the player arrives at ${from.join(',')} on ground nobody can stand on`);
      continue;
    }
    // One flood per arrival, collected by walking everywhere it can reach.
    const queue: Vec2[] = [from];
    reachable.add(`${from[0]},${from[1]}`);
    while (queue.length) {
      const [cx, cy] = queue.shift() as Vec2;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (reachable.has(key) || !walkable(nx, ny)) continue;
        reachable.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  const canReach = (tile: Vec2) => reachable.has(`${tile[0]},${tile[1]}`);
  const canReachBeside = (tile: Vec2) =>
    [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => canReach([tile[0] + dx, tile[1] + dy]));

  const meta = world.maps[mapId];
  for (const placement of meta.buildings) {
    if (!canReach(placement.door)) out.push(`building "${placement.id}"'s door at ${placement.door.join(',')} cannot be reached`);
    const plaque = plaqueTile(placement);
    if (plaque && !canReach(plaque)) out.push(`building "${placement.id}"'s plaque at ${plaque.join(',')} cannot be reached`);
    const board = signBoardTile(placement);
    if (board && !canReach(board)) out.push(`building "${placement.id}"'s sign board at ${board.join(',')} cannot be reached`);
  }
  for (const fixture of map.fixtures ?? []) {
    if (!canReachBeside(fixture.pos)) out.push(`the ${fixture.kind} at ${fixture.pos.join(',')} cannot be walked up to`);
  }
  for (const exit of meta.exits) {
    let found = false;
    for (let y = exit.at[1]; y < exit.at[1] + exit.at[3] && !found; y++) {
      for (let x = exit.at[0]; x < exit.at[0] + exit.at[2] && !found; x++) {
        if (canReach([x, y])) found = true;
      }
    }
    if (!found) out.push(`the way out at "${exit.id}" cannot be reached`);
  }
  return out;
}

/**
 * Tiles two overlays that could be on together both paint. Not a problem —
 * layering is allowed, and the later one wins — but it has to be somebody's
 * decision, so `validate-episodes` prints it (DESIGN.md §3).
 */
export function overlayNotes(episode: Episode, maps: Record<string, GameMap>): string[] {
  const notes: string[] = [];
  const byMap = new Map<string, MapOverlay[]>();
  for (const overlay of episode.overlays ?? []) {
    if (!maps[overlay.map]) continue;
    byMap.set(overlay.map, [...(byMap.get(overlay.map) ?? []), overlay]);
  }
  for (const [mapId, list] of byMap) {
    for (const set of combinations(list)) {
      if (set.length < 2) continue;
      for (const overlap of overlapsIn(set)) {
        if (overlap.ids.length < 2) continue;
        notes.push(
          `episode "${episode.id}": on "${mapId}", ${overlap.ids.map((id) => `"${id}"`).join(' and ')} ` +
            `both paint ${overlap.pos.join(',')} — the last one listed is what shows`
        );
      }
    }
  }
  return [...new Set(notes)];
}

/** Two or three strollers make a street; a dozen makes a crowd scene. */
const MAX_PEOPLE = 6;

/** One or two cars make a village look lived-in; more makes it a highway. */
const MAX_VEHICLES = 3;

/**
 * Every tile somebody walking may stand on. Deliberately stricter than the
 * player's own walkability: a doorstep, a plaque tile and a sign board tile
 * are read by standing exactly there, so a townsperson parked on one would
 * take a building's door — or its sign — away, and a road out of the village
 * is the player's to take, not theirs.
 */
export function moverWalkable(map: GameMap): (x: number, y: number) => boolean {
  const taken = new Set<string>();
  for (const placement of map.buildings) {
    taken.add(`${placement.door[0]},${placement.door[1]}`);
    const plaque = plaqueTile(placement);
    if (plaque) taken.add(`${plaque[0]},${plaque[1]}`);
    const board = signBoardTile(placement);
    if (board) taken.add(`${board[0]},${board[1]}`);
  }
  for (const fixture of map.fixtures ?? []) taken.add(`${fixture.pos[0]},${fixture.pos[1]}`);
  const exits = map.exits;
  return (x, y) => {
    if (isSolid(map, x, y)) return false;
    if (taken.has(`${x},${y}`)) return false;
    return !exits.some((exit) => x >= exit.at[0] && x < exit.at[0] + exit.at[2] && y >= exit.at[1] && y < exit.at[1] + exit.at[3]);
  };
}

/**
 * Every tile a vehicle may drive on: a tile whose tileset entry carries
 * `drive` and that nothing solid stands on (engine/tiled.ts). It is the
 * paved-routes-only rule, expressed once, and it is deliberately blind to
 * what a world calls its surfaces — a village marks the tiles its cars belong
 * on and the engine never learns which road that is (hard rule 1).
 *
 * Doorsteps, plaques and exits are *not* excluded the way `moverWalkable`
 * excludes them: nobody reads anything from the middle of a state route, and a
 * road out of town is a road a car may use.
 */
export function driveable(map: GameMap): (x: number, y: number) => boolean {
  return (x, y) => {
    if (isSolid(map, x, y)) return false;
    const index = y * map.width + x;
    return map.layers.some((layer) => layer.cells[index]?.drive === true);
  };
}

/**
 * One ambient vehicle (DESIGN.md §2): a kind the engine can draw, a colour it
 * can paint it in, and either a path whose every tile — waypoints and the
 * tiles the engine fills in between them — is drivable, or no path at all,
 * which is a car parked where somebody left it.
 *
 * A loop closes by road too, so a car that sets off can always get back round.
 * A parked car has only to be somewhere a car could plausibly have been left:
 * a drivable tile, which covers both the road and a lot's marked stalls. On a
 * map with no drivable tiles anywhere — an interior, say — that rule would
 * make every tile wrong, so there it falls back to "anywhere solid nothing
 * stands", which is the kindest reading of a map with no roads on it.
 */
function checkVehicle(vehicle: Vehicle, map: GameMap, context: string, problems: string[]): void {
  if (!(VEHICLE_KINDS as readonly string[]).includes(vehicle.kind)) {
    problems.push(`${context} has unknown kind "${vehicle.kind}" — expected one of ${VEHICLE_KINDS.join(', ')}`);
  }
  if (typeof vehicle.colour !== 'string' || !HEX.test(vehicle.colour)) {
    problems.push(`${context} has a "colour" that isn't a hex colour like "#9babb2"`);
  }
  if (vehicle.facing !== undefined && !(FACINGS as readonly string[]).includes(vehicle.facing)) {
    problems.push(`${context} has an unknown "facing" — expected one of ${FACINGS.join(', ')}`);
  }
  if (vehicle.loop !== undefined && typeof vehicle.loop !== 'boolean') {
    problems.push(`${context} has a "loop" that isn't a boolean`);
  }
  if (vehicle.speed !== undefined && (typeof vehicle.speed !== 'number' || !(vehicle.speed > 0))) {
    problems.push(`${context} has a "speed" that isn't tiles per second`);
  }
  if (vehicle.pause !== undefined && (typeof vehicle.pause !== 'number' || !(vehicle.pause >= 0))) {
    problems.push(`${context} has a "pause" that isn't a number of seconds`);
  }

  const drive = driveable(map);
  const path = vehicle.path;
  const parked = path === undefined;

  if (parked) {
    if (vehicle.pos === undefined) {
      problems.push(`${context} has neither a "path" to drive nor a "pos" to be parked on`);
      return;
    }
    // A map with no paved tiles at all has nowhere a car could be parked by
    // the usual rule, so anywhere it would fit will do (hard rule 3).
    const paved = anyDrivable(map);
    checkPark(map, vehicle.pos, `${context} "pos"`, paved ? drive : (x, y) => !isSolid(map, x, y), paved, problems);
    return;
  }

  if (!Array.isArray(path) || path.length < 2) {
    problems.push(`${context} has a "path" with fewer than two waypoints`);
    return;
  }
  let ok = true;
  if (vehicle.pos !== undefined && !checkPark(map, vehicle.pos, `${context} "pos"`, drive, true, problems)) ok = false;
  path.forEach((point, index) => {
    if (!checkPark(map, point, `${context} waypoint ${index}`, drive, true, problems)) ok = false;
  });
  if (!ok) return;

  // Each leg in turn, from the tile the car starts on and ending back at the
  // first waypoint when the path loops.
  const legs: Vec2[] = [vehicle.pos ?? path[0], ...path];
  if (vehicle.loop !== false) legs.push(path[0]);
  for (let i = 1; i < legs.length; i++) {
    const from = legs[i - 1];
    const to = legs[i];
    if (from[0] === to[0] && from[1] === to[1]) continue;
    if (!findPath(from, (x, y) => x === to[0] && y === to[1], drive)) {
      problems.push(`${context} cannot drive from ${from.join(',')} to ${to.join(',')} — no paved way through`);
    }
  }
}

/** Whether this map has any paved tile on it at all. */
function anyDrivable(map: GameMap): boolean {
  const drive = driveable(map);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (drive(x, y)) return true;
  }
  return false;
}

/** A tile a vehicle may sit on or drive over, with the reason if not. */
function checkPark(
  map: GameMap,
  pos: Vec2 | undefined,
  context: string,
  allowed: (x: number, y: number) => boolean,
  paved: boolean,
  problems: string[]
): boolean {
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => Number.isInteger(n))) {
    problems.push(`${context} is not a tile like [12, 4]`);
    return false;
  }
  const [x, y] = pos;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    problems.push(`${context} is outside the map`);
    return false;
  }
  if (!allowed(x, y)) {
    problems.push(
      paved
        ? `${context} at ${x},${y} is not a tile a vehicle can drive on — cars keep to the paved routes`
        : `${context} at ${x},${y} is somewhere no vehicle could be left — a wall, or inside a building`
    );
    return false;
  }
  return true;
}

/** A tile that is at least on the map and shaped like one, with the reason if not. */
function checkTile(map: GameMap, pos: Vec2 | undefined, context: string, problems: string[]): boolean {
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => Number.isInteger(n))) {
    problems.push(`${context} is not a tile like [12, 4]`);
    return false;
  }
  const [x, y] = pos;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    problems.push(`${context} is outside the map`);
    return false;
  }
  return true;
}

/** A tile somebody may be placed on, or walk to, with the reason if not. */
function checkStand(map: GameMap, pos: Vec2 | undefined, context: string, problems: string[]): boolean {
  if (!checkTile(map, pos, context, problems)) return false;
  const [x, y] = pos as Vec2;
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
  for (const name of ['credit', 'code'] as const) {
    const value = fields[name];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`world "submit.art" has no field id for "${name}"`);
    }
  }
  for (const name of ['building', 'world', 'notes'] as const) {
    const value = fields[name];
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      problems.push(`world "submit.art" has a "${name}" field id that is empty`);
    }
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
