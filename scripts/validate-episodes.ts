/**
 * Loads every world pack under worlds/<id>/ and runs the exact same
 * validation the engine runs at boot (engine/validate.ts) — see DESIGN.md §3.
 * The rules themselves live only in engine/validate.ts; this script does not
 * duplicate them.
 *
 * Run with `npm run validate-episodes`. Point it at a different worlds
 * directory (e.g. a scratch fixture) with either an argument or the
 * MAINSTREET_WORLDS_DIR env var — useful for testing this script itself
 * without touching the real worlds/ directory:
 *
 *   node scripts/validate-episodes.ts path/to/worlds
 *   MAINSTREET_WORLDS_DIR=path/to/worlds node scripts/validate-episodes.ts
 *
 * Runs directly under Node's built-in TypeScript type stripping (Node 22.6+;
 * unflagged on the Node version this repo targets) — no `tsx`/`ts-node`
 * dependency needed. That requires relative imports of engine modules to
 * carry an explicit ".ts" extension, which Vite also accepts (see
 * tsconfig.json's `allowImportingTsExtensions`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseTiledMap, parseTileset, tilesetSources } from '../engine/tiled.ts';
import type { TilesetDef } from '../engine/tiled.ts';
import { validateEpisode, validateWorld } from '../engine/validate.ts';
import type { Episode, GameMap, World, WorldCopy } from '../engine/schema.ts';

const worldsRoot = process.argv[2] ?? process.env.MAINSTREET_WORLDS_DIR ?? 'worlds';

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'missing file';
  }
  return error instanceof Error ? error.message : String(error);
}

/** Prints the failing world/file/message and stops the whole run. */
function fail(worldId: string, file: string, message: string): never {
  console.error(`✗ ${worldId}: ${file}: ${message}`);
  process.exit(1);
}

function readJson<T>(worldId: string, file: string): T {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail(worldId, file, describeError(error));
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    fail(worldId, file, `invalid JSON — ${describeError(error)}`);
  }
}

function validateWorldPack(dir: string, worldId: string): void {
  const worldFile = join(dir, 'world.json');
  const copyFile = join(dir, 'copy.json');

  const world = readJson<World>(worldId, worldFile);
  // copy.json is loaded at boot alongside world.json (engine/loader.ts) but
  // carries only UI strings — validate.ts has no rules for it, so presence
  // and JSON validity is all that's checked here.
  readJson<WorldCopy>(worldId, copyFile);

  if (world.id !== worldId) {
    fail(worldId, worldFile, `declares id "${world.id}" but lives in directory "${worldId}"`);
  }

  // The tile grids are Tiled files under maps/, one per map id in world.json
  // (DESIGN.md §2). Parsing them here is what makes the position and solidity
  // rules in engine/validate.ts mean anything.
  const maps: Record<string, GameMap> = {};
  const tilesets = new Map<string, TilesetDef>();
  for (const mapId of Object.keys(world.maps)) {
    const mapFile = join(dir, 'maps', `${mapId}.json`);
    const raw = readJson<unknown>(worldId, mapFile);
    let grid;
    try {
      for (const source of tilesetSources(raw, mapFile)) {
        const tilesetFile = resolve(dirname(mapFile), source);
        if (!tilesets.has(tilesetFile)) {
          tilesets.set(tilesetFile, parseTileset(readJson<unknown>(worldId, tilesetFile), tilesetFile));
        }
      }
      grid = parseTiledMap(raw, (source) => tilesets.get(resolve(dirname(mapFile), source)), mapFile);
    } catch (error) {
      fail(worldId, mapFile, describeError(error));
    }
    maps[mapId] = { ...world.maps[mapId], ...grid };
  }

  for (const problem of validateWorld(world, maps)) {
    fail(worldId, worldFile, problem);
  }

  for (const episodeId of world.episodes) {
    const episodeFile = join(dir, 'episodes', `${episodeId}.json`);
    const episode = readJson<Episode>(worldId, episodeFile);
    for (const problem of validateEpisode(episode, world, maps)) {
      fail(worldId, episodeFile, problem);
    }
  }

  const count = world.episodes.length;
  const mapCount = Object.keys(maps).length;
  console.log(`✓ ${worldId} (${mapCount} map${mapCount === 1 ? '' : 's'}, ${count} episode${count === 1 ? '' : 's'})`);
}

let worldIds: string[];
try {
  worldIds = readdirSync(worldsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  console.error(`could not read worlds directory "${worldsRoot}": ${describeError(error)}`);
  process.exit(1);
}

if (worldIds.length === 0) {
  console.error(`no world packs found under "${worldsRoot}"`);
  process.exit(1);
}

for (const worldId of worldIds) {
  validateWorldPack(join(worldsRoot, worldId), worldId);
}

console.log(`${worldIds.length} world pack${worldIds.length === 1 ? '' : 's'} OK.`);
