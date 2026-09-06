/**
 * Validates every world pack's painted art against the conventions in
 * DESIGN.md §4 and the credits schema in DESIGN.md §2 — the two things
 * `engine/loader.ts` trusts by convention rather than checking at runtime.
 * Run with `npm run validate-assets`.
 *
 * Checked, per world:
 *  - `palette.png` exists (or the file world.json's `palette` field names)
 *    and is a valid PNG — every other PNG's opaque pixels must draw only
 *    from its colours.
 *  - `assets/buildings/<id>.png`: id is a building in world.json; width is
 *    the building's footprint width × 16; height is a multiple of 16.
 *  - `assets/chars/<id>.png`: id is the player or an episode NPC; 48×128
 *    (3 walk frames × 4 directions of 16×32).
 *  - `assets/portraits/<id>.png`: same id rule; 96×96.
 *  - `assets/tiles/<name>.png`: matches the `imagewidth`/`imageheight` its
 *    `assets/tiles/<name>.json` tileset declares.
 *  - No fully-opaque pixel anywhere is off-palette; no pixel has partial
 *    alpha (fully transparent is fine, DESIGN.md §4/CLAUDE.md hard rule 3).
 *  - Every file under `assets/` matches one of the conventions above (aside
 *    from `README.txt` and a tileset's own `.json`) — nothing unexpected
 *    silently ships.
 *  - `credits.json`, if present: every credited id exists and is actually
 *    painted (DESIGN.md §2: "painted ones carry an art credit").
 *
 * Point it at a scratch worlds/ directory the same way validate-episodes
 * does, with an argument or MAINSTREET_WORLDS_DIR:
 *
 *   node scripts/validate-assets.ts path/to/worlds
 *   MAINSTREET_WORLDS_DIR=path/to/worlds node scripts/validate-assets.ts
 *
 * Runs under Node's built-in TypeScript type stripping, same as
 * validate-episodes.ts — see that file's header for why imports carry an
 * explicit ".ts"/".ts" extension.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { decodePng } from './png.ts';
import { parseTileset } from '../engine/tiled.ts';
import type { Credits, Episode, World } from '../engine/schema.ts';

const worldsRoot = process.argv[2] ?? process.env.MAINSTREET_WORLDS_DIR ?? 'worlds';

const problems: string[] = [];
function fail(worldId: string, file: string, message: string): void {
  problems.push(`✗ ${worldId}: ${file}: ${message}`);
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'missing file';
  }
  return error instanceof Error ? error.message : String(error);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Every file under `root`, as paths relative to it, forward-slashed. */
function relFiles(root: string): string[] {
  const abs: string[] = [];
  (function collect(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else abs.push(full);
    }
  })(root);
  return abs.map((f) => relative(root, f).split('\\').join('/'));
}

type Rgb = string; // "r,g,b"
const key = (r: number, g: number, b: number): Rgb => `${r},${g},${b}`;

/**
 * Every opaque pixel must be a palette colour; no pixel may have partial
 * alpha. Reports at most one problem per file, with the first offending
 * pixel, so a botched export doesn't flood the output.
 */
function checkPixels(worldId: string, file: string, png: { width: number; height: number; rgba: Uint8Array }, palette: Set<Rgb>): void {
  const { width, rgba } = png;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    const x = (i / 4) % width;
    const y = Math.floor(i / 4 / width);
    if (a !== 255) {
      fail(worldId, file, `pixel (${x},${y}) has partial alpha (${a}) — only fully opaque or fully transparent pixels are allowed`);
      return;
    }
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    if (!palette.has(key(r, g, b))) {
      fail(worldId, file, `pixel (${x},${y}) is #${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}, which is not in palette.png`);
      return;
    }
  }
}

function loadPng(worldId: string, file: string) {
  try {
    return decodePng(readFileSync(file));
  } catch (error) {
    fail(worldId, file, describeError(error));
    return null;
  }
}

function validateWorldAssets(dir: string, worldId: string): void {
  const world = readJson<World>(join(dir, 'world.json'));
  const episodes = world.episodes.map((id) => readJson<Episode>(join(dir, 'episodes', `${id}.json`)));
  const buildingIds = new Set(Object.keys(world.buildings));
  const charIds = new Set([world.player.id, ...episodes.flatMap((ep) => ep.npcs.map((npc) => npc.id))]);

  // A building's facade width is checked against its footprint, which lives
  // in world.json's per-map placements, not in the building registry itself.
  const footprint = new Map<string, [number, number]>();
  for (const map of Object.values(world.maps)) {
    for (const placement of map.buildings) {
      if (!footprint.has(placement.id)) footprint.set(placement.id, placement.size);
    }
  }

  const paletteFile = join(dir, world.palette ?? 'palette.png');
  let palette: Set<Rgb> | null = null;
  try {
    const png = decodePng(readFileSync(paletteFile));
    palette = new Set<Rgb>();
    for (let i = 0; i < png.rgba.length; i += 4) {
      palette.add(key(png.rgba[i], png.rgba[i + 1], png.rgba[i + 2]));
    }
  } catch (error) {
    fail(worldId, paletteFile, describeError(error));
  }

  const assetsDir = join(dir, 'assets');
  const files = relFiles(assetsDir);

  // Every tileset definition under assets/tiles/, so a tileset PNG can be
  // matched to the JSON that names it (DESIGN.md §2).
  const tilesetsByImage = new Map<string, { name: string; imagewidth: number; imageheight: number }>();
  for (const file of files) {
    if (dirname(file) !== 'tiles' || !file.endsWith('.json')) continue;
    const full = join(assetsDir, file);
    try {
      const tileset = parseTileset(readJson<unknown>(full), full);
      tilesetsByImage.set(tileset.image, tileset);
    } catch (error) {
      fail(worldId, full, describeError(error));
    }
  }

  const paintedBuildings = new Set<string>();
  const paintedChars = new Set<string>();
  const paintedPortraits = new Set<string>();
  const paintedTilesets = new Set<string>();

  for (const file of files) {
    const full = join(assetsDir, file);
    const base = basename(file);
    const top = file.split('/')[0];

    if (base.startsWith('.')) continue; // OS junk (.DS_Store &c.), not ours to police
    if (base.toLowerCase() === 'readme.txt') continue;
    if (top === 'tiles' && file.endsWith('.json')) continue; // already handled above

    if (!file.endsWith('.png')) {
      fail(worldId, full, 'unexpected file under assets/ (expected a .png, README.txt, or a tiles/*.json tileset)');
      continue;
    }

    if (top === 'buildings') {
      const id = base.slice(0, -4);
      if (!buildingIds.has(id)) {
        fail(worldId, full, `no building "${id}" in world.json`);
        continue;
      }
      const png = loadPng(worldId, full);
      if (!png) continue;
      const size = footprint.get(id);
      if (!size) {
        fail(worldId, full, `building "${id}" is not placed on any map, so its footprint width is unknown`);
        continue;
      }
      const expectedWidth = size[0] * 16;
      if (png.width !== expectedWidth) {
        fail(worldId, full, `width is ${png.width}px, expected ${expectedWidth}px (footprint is ${size[0]} tiles wide)`);
        continue;
      }
      if (png.height % 16 !== 0) {
        fail(worldId, full, `height is ${png.height}px, which is not a multiple of 16`);
        continue;
      }
      if (palette) checkPixels(worldId, full, png, palette);
      paintedBuildings.add(id);
    } else if (top === 'chars') {
      const id = base.slice(0, -4);
      if (!charIds.has(id)) {
        fail(worldId, full, `"${id}" is not the player or an episode NPC`);
        continue;
      }
      const png = loadPng(worldId, full);
      if (!png) continue;
      if (png.width !== 48 || png.height !== 128) {
        fail(worldId, full, `is ${png.width}×${png.height}px, expected 48×128 (3 frames × 4 directions of 16×32)`);
        continue;
      }
      if (palette) checkPixels(worldId, full, png, palette);
      paintedChars.add(id);
    } else if (top === 'portraits') {
      const id = base.slice(0, -4);
      if (!charIds.has(id)) {
        fail(worldId, full, `"${id}" is not the player or an episode NPC`);
        continue;
      }
      const png = loadPng(worldId, full);
      if (!png) continue;
      if (png.width !== 96 || png.height !== 96) {
        fail(worldId, full, `is ${png.width}×${png.height}px, expected 96×96`);
        continue;
      }
      if (palette) checkPixels(worldId, full, png, palette);
      paintedPortraits.add(id);
    } else if (top === 'tiles') {
      const tileset = tilesetsByImage.get(base);
      if (!tileset) {
        fail(worldId, full, `no tiles/*.json tileset names "${base}" as its image`);
        continue;
      }
      const png = loadPng(worldId, full);
      if (!png) continue;
      if (png.width !== tileset.imagewidth || png.height !== tileset.imageheight) {
        fail(
          worldId,
          full,
          `is ${png.width}×${png.height}px, but tileset "${tileset.name}" declares ${tileset.imagewidth}×${tileset.imageheight}`
        );
        continue;
      }
      if (palette) checkPixels(worldId, full, png, palette);
      paintedTilesets.add(tileset.name);
    } else {
      fail(worldId, full, `unexpected file under assets/ — "${top}/" is not a known asset folder`);
    }
  }

  // credits.json (DESIGN.md §2/§4): optional, graceful fallback when absent.
  const creditsFile = join(dir, 'credits.json');
  let credits: Credits | undefined;
  try {
    credits = readJson<Credits>(creditsFile);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      fail(worldId, creditsFile, describeError(error));
    }
  }
  if (credits) {
    const tilesetNames = new Set([...tilesetsByImage.values()].map((t) => t.name));
    const sections: [keyof Credits, Set<string>, Set<string>, string][] = [
      ['buildings', buildingIds, paintedBuildings, 'assets/buildings'],
      ['chars', charIds, paintedChars, 'assets/chars'],
      ['portraits', charIds, paintedPortraits, 'assets/portraits'],
      ['tiles', tilesetNames, paintedTilesets, 'assets/tiles']
    ];
    for (const [section, ids, painted, path] of sections) {
      for (const [id, text] of Object.entries(credits[section] ?? {})) {
        if (!ids.has(id)) {
          fail(worldId, creditsFile, `credits.${section}.${id} — no such id`);
          continue;
        }
        if (!painted.has(id)) {
          fail(worldId, creditsFile, `credits.${section}.${id} — ${path}/${id}.png does not exist yet, nothing to credit`);
          continue;
        }
        if (typeof text !== 'string' || !text.trim()) {
          fail(worldId, creditsFile, `credits.${section}.${id} must be a non-empty string`);
        }
      }
    }
  }

  if (!problems.some((p) => p.startsWith(`✗ ${worldId}:`))) {
    const paintedCount = paintedBuildings.size + paintedChars.size + paintedPortraits.size + paintedTilesets.size;
    console.log(`✓ ${worldId} (${paintedCount} painted asset${paintedCount === 1 ? '' : 's'})`);
  }
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
  try {
    validateWorldAssets(join(worldsRoot, worldId), worldId);
  } catch (error) {
    fail(worldId, join(worldsRoot, worldId), describeError(error));
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log(`${worldIds.length} world pack${worldIds.length === 1 ? '' : 's'} OK.`);
