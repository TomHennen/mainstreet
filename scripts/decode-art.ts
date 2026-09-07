/**
 * Turns a Studio MSA1 code (or an emailed one) into a building facade PNG and
 * a credits.json entry, ready to open as a PR. This is the manual half of
 * "how art gets in the game" (CONTRIBUTING.md): a contributor's email arrives
 * with a text code in the body, and this script does the rest.
 *
 * Usage:
 *
 *   npm run decode-art -- <code-or-file> --credit "Their Name"
 *   npm run decode-art -- --stdin --credit "Their Name"
 *   npm run decode-art -- <code-or-file> --credit "Their Name" --force
 *   npm run decode-art -- <code-or-file> --credit "Their Name" --force --replace-credit
 *   npm run decode-art -- <code-or-file> --credit "Their Name" --door 2 --plaque 3
 *
 * `<code-or-file>` is either the MSA1 code itself, or a path to a text file
 * (e.g. a saved email) — the first line starting with "MSA1|" is pulled out
 * of it, the same way a person would if they were reading the email by eye.
 * `--stdin` reads that same kind of text from standard input instead.
 *
 * What it does, in order:
 *  1. Decodes the code with studio/codec.ts (the same decoder the Studio
 *     itself uses) — a bad code fails here with a plain-English CodeError.
 *  2. Checks the world and building named in the code exist, and that the
 *     drawing's size matches the building's footprint (DESIGN.md §4): width
 *     is exactly the footprint width × 16, height is a multiple of 16 and at
 *     least the footprint height × 16.
 *  3. Turns the drawing's palette indices into real colours via the world's
 *     palette.png (index 255 is transparent — see studio/codec.ts) and
 *     writes worlds/<world>/assets/buildings/<building>.png. Refuses to
 *     overwrite an existing file unless --force is given.
 *  4. Adds or updates the credit in worlds/<world>/credits.json, creating the
 *     file if it doesn't exist yet, keeping its keys sorted. A first painting
 *     writes the one name given. Repainting an already-credited building with
 *     --force *appends* --credit's name to the list (a touch-up thanks
 *     everyone who worked on it, in order) unless that name is on the list
 *     already, or --replace-credit says to replace the list instead of
 *     growing it. Either way the credit as it now reads is printed, so it is
 *     obvious at a glance whether it grew or was replaced.
 *  5. Moves the building's door and plaque in world.json, if the artist said
 *     where they wanted them: a Studio code can carry the two columns (see
 *     studio/codec.ts), and `--door <col>` / `--plaque <col>` say the same
 *     thing for a drawing that arrived as an attached PNG. Columns are counted
 *     from 0 at the building's left edge, so the left-most column is 0 and
 *     "third column along" is 2. Every placement of that building is moved,
 *     and the whole world is run past engine/validate.ts first — a door or a
 *     plaque that would land on a solid tile is refused rather than written.
 *  6. Runs the same checks scripts/validate-assets.ts runs, against the same
 *     world, so a mistake here is caught before it reaches a PR.
 *
 * Point it at a scratch worlds/ directory the same way validate-assets.ts
 * does, with --worlds-dir or MAINSTREET_WORLDS_DIR — this is how the tests
 * exercise it without touching the real worlds/ directory:
 *
 *   npm run decode-art -- --worlds-dir path/to/worlds code.txt --credit "Name"
 *
 * Runs under Node's built-in TypeScript type stripping, same as
 * validate-assets.ts — see that file's header for why imports carry an
 * explicit ".ts" extension.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeError, decode, MAGIC, TRANSPARENT } from '../studio/codec.ts';
import type { Drawing } from '../studio/codec.ts';
import { decodePng, encodePng } from './png.ts';
import { parseTiledMap, parseTileset, tilesetSources } from '../engine/tiled.ts';
import type { TilesetDef } from '../engine/tiled.ts';
import { validateWorld } from '../engine/validate.ts';
import { joinCredits } from '../engine/session.ts';
import type { Credits, GameMap, World } from '../engine/schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** A problem with the request itself (world/building/size/overwrite), as opposed to a bad code (CodeError). */
export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}

export interface DecodeArtOptions {
  /** The MSA1 code, or raw text (an email body) it can be pulled out of. */
  code: string;
  /** Who to credit for the painting. */
  credit: string;
  /** worlds/ directory to operate on. Defaults to the real one. */
  worldsDir?: string;
  /** Overwrite an existing PNG. Defaults to false. */
  force?: boolean;
  /**
   * When `force` repaints a building that already has a credit, replace that
   * credit with just this one name instead of appending to it. Defaults to
   * false (append). Ignored on a building's first painting, or repainted by
   * whoever is already the only credited name — see decodeArt's docstring.
   */
  replaceCredit?: boolean;
  /** Run validate-assets.ts afterwards as a sanity check. Defaults to true. */
  validate?: boolean;
  /**
   * Tile column for the door, counting from 0 at the building's left edge, for
   * a drawing that came as an attached PNG. A code that carries its own
   * columns says the same thing; the two have to agree.
   */
  door?: number;
  /** The same for the plaque. */
  plaque?: number;
}

export interface DecodeArtResult {
  drawing: Drawing;
  pngPath: string;
  creditsPath: string;
  /** world.json, when the door or the plaque moved; null when nothing changed there. */
  worldPath: string | null;
  /** The columns the drawing asked for, for saying so out loud. */
  columns: { door: number | null; plaque: number | null } | null;
  /**
   * The building's credit as it now reads, joined the way the plaque reads
   * it — "Jordan R." or "Tom, Lana and Alice" — worth printing so an append
   * or a replace is visible immediately.
   */
  creditText: string;
  /** Output of the validate-assets check, if it ran. */
  validateOutput: string;
}

/** Pulls a code out of arbitrary text: the first line starting with "MSA1|", or the whole trimmed text if none is found. */
export function extractCode(text: string): string {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${MAGIC}|`)) return trimmed;
  }
  return text.trim();
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return sorted;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'missing file';
  }
  return error instanceof Error ? error.message : String(error);
}

/** Runs scripts/validate-assets.ts against `worldsDir` and returns its stdout+stderr. Throws IntakeError if it fails. */
function runValidateAssets(worldsDir: string): string {
  const scriptPath = join(REPO_ROOT, 'scripts', 'validate-assets.ts');
  const result = spawnSync(process.execPath, [scriptPath, worldsDir], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    throw new IntakeError(`The new art didn't pass validate-assets:\n${output}`);
  }
  return output;
}

/**
 * Every map's tile grid, read the way scripts/validate-episodes.ts reads them.
 * The grids live in Tiled files rather than in world.json, and engine/validate.ts
 * needs them to know whether a door has somewhere to stand.
 */
function loadMaps(worldDir: string, world: World): Record<string, GameMap> {
  const maps: Record<string, GameMap> = {};
  const tilesets = new Map<string, TilesetDef>();
  const read = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new IntakeError(`Could not read ${relative(REPO_ROOT, file)}: ${describeError(error)}`);
    }
  };

  for (const mapId of Object.keys(world.maps)) {
    const mapFile = join(worldDir, 'maps', `${mapId}.json`);
    const raw = read(mapFile);
    try {
      for (const source of tilesetSources(raw, mapFile)) {
        const tilesetFile = resolve(dirname(mapFile), source);
        if (!tilesets.has(tilesetFile)) tilesets.set(tilesetFile, parseTileset(read(tilesetFile), tilesetFile));
      }
      const grid = parseTiledMap(raw, (source) => tilesets.get(resolve(dirname(mapFile), source)), mapFile);
      maps[mapId] = { ...world.maps[mapId], ...grid };
    } catch (error) {
      if (error instanceof IntakeError) throw error;
      throw new IntakeError(`Could not read ${relative(REPO_ROOT, mapFile)}: ${describeError(error)}`);
    }
  }
  return maps;
}

/**
 * The columns the artist asked for, from the code and from the flags together.
 * Either source may say it; if both do, they have to agree, because guessing
 * which one the person meant is exactly the wrong thing to do here.
 */
function askedColumns(drawing: Drawing, options: DecodeArtOptions): { door?: number; plaque?: number } {
  const settle = (name: 'door' | 'plaque'): number | undefined => {
    const fromCode = drawing[name];
    const fromFlag = options[name];
    if (fromFlag === undefined) return fromCode;
    if (!Number.isInteger(fromFlag) || fromFlag < 0) {
      throw new IntakeError(`--${name} takes a tile column counting from 0 at the building's left edge, not "${fromFlag}".`);
    }
    if (fromCode !== undefined && fromCode !== fromFlag) {
      throw new IntakeError(
        `The code already says the ${name} goes in column ${fromCode}, and --${name} says ${fromFlag}. ` +
          `Leave the flag off to go with the code, or check with them which one they meant.`
      );
    }
    return fromFlag;
  };
  const door = settle('door');
  const plaque = settle('plaque');
  if (door !== undefined && door === plaque) {
    throw new IntakeError(`The door and the plaque are both asking for column ${door}, and they need one each.`);
  }
  return { door, plaque };
}

/**
 * Moves the door and the plaque of every placement of this building, in place.
 * Both sit on the row below the footprint, which is where the doors have always
 * been. Returns true if anything actually changed.
 */
function placeColumns(world: World, buildingId: string, name: string, asked: { door?: number; plaque?: number }): boolean {
  if (asked.door === undefined && asked.plaque === undefined) return false;
  let changed = false;

  for (const map of Object.values(world.maps)) {
    for (const placement of map.buildings) {
      if (placement.id !== buildingId) continue;
      const columns = placement.size[0];
      const front = placement.pos[1] + placement.size[1];

      for (const [which, col] of Object.entries(asked) as ['door' | 'plaque', number | undefined][]) {
        if (col === undefined) continue;
        if (col >= columns) {
          throw new IntakeError(
            `The ${which} is asking for column ${col}, and ${name} has columns 0 to ${columns - 1} ` +
              `(counting from 0 at its left edge).`
          );
        }
        const tile: [number, number] = [placement.pos[0] + col, front];
        const was = which === 'door' ? placement.door : placement.plaque;
        if (!Array.isArray(was) || was[0] !== tile[0] || was[1] !== tile[1]) changed = true;
        if (which === 'door') placement.door = tile;
        else placement.plaque = tile;
      }
    }
  }
  return changed;
}

/** Decodes a code, writes the facade PNG and credits.json, and validates the result. Throws CodeError or IntakeError on any problem. */
export function decodeArt(options: DecodeArtOptions): DecodeArtResult {
  const worldsDir = resolve(options.worldsDir ?? join(REPO_ROOT, 'worlds'));
  const credit = options.credit?.trim();
  if (!credit) {
    throw new IntakeError('Every drawing needs a name to credit — run again with --credit "Their Name".');
  }

  const drawing = decode(options.code); // throws CodeError on a bad code

  const worldDir = join(worldsDir, drawing.world);
  const worldFile = join(worldDir, 'world.json');
  if (!existsSync(worldFile)) {
    throw new IntakeError(
      `There's no world called "${drawing.world}" here — check the code came from the right Studio link.`
    );
  }
  let world: World;
  try {
    world = JSON.parse(readFileSync(worldFile, 'utf8')) as World;
  } catch (error) {
    throw new IntakeError(`Could not read ${worldFile}: ${describeError(error)}`);
  }

  const building = world.buildings[drawing.building];
  if (!building) {
    throw new IntakeError(`"${drawing.world}" doesn't have a building called "${drawing.building}".`);
  }

  // A building's footprint lives in world.json's per-map placements, not the
  // building registry itself — same as scripts/validate-assets.ts.
  let footprint: [number, number] | undefined;
  for (const map of Object.values(world.maps)) {
    const placement = map.buildings.find((b) => b.id === drawing.building);
    if (placement) {
      footprint = placement.size;
      break;
    }
  }
  if (!footprint) {
    throw new IntakeError(`"${drawing.building}" isn't placed on any map yet, so there's no footprint to check its size against.`);
  }

  const expectedWidth = footprint[0] * 16;
  const minHeight = footprint[1] * 16;
  if (drawing.width !== expectedWidth) {
    throw new IntakeError(
      `This drawing is ${drawing.width}px wide, but ${building.name} needs to be exactly ${expectedWidth}px wide ` +
        `(its footprint is ${footprint[0]} tiles across).`
    );
  }
  if (drawing.height % 16 !== 0) {
    throw new IntakeError(`This drawing is ${drawing.height}px tall, which isn't a multiple of 16.`);
  }
  if (drawing.height < minHeight) {
    throw new IntakeError(
      `This drawing is only ${drawing.height}px tall; ${building.name} needs at least ${minHeight}px ` +
        `(its footprint is ${footprint[1]} tiles high) to cover its footprint. Extra rows above that are fine, for a roof or sign.`
    );
  }

  const pngPath = join(worldDir, 'assets', 'buildings', `${drawing.building}.png`);
  if (existsSync(pngPath) && !options.force) {
    throw new IntakeError(`${relative(REPO_ROOT, pngPath)} already exists — pass --force to replace it.`);
  }

  // Where the artist put the door and the plaque. This is settled — and the
  // whole world checked with it — before anything at all is written, so a
  // drawing whose door would land in a wall leaves the pack exactly as it was.
  const asked = askedColumns(drawing, options);
  const moved = placeColumns(world, drawing.building, building.name, asked);
  if (moved) {
    const problems = validateWorld(world, loadMaps(worldDir, world));
    if (problems.length) {
      const mine = problems.filter((problem) => problem.includes(`"${drawing.building}"`));
      throw new IntakeError(
        mine.length
          ? `That would put ${building.name}'s door or plaque somewhere the game can't use, so nothing has ` +
            `been written:\n  ${mine.join('\n  ')}\n` +
            `Columns count from 0 at the building's left edge, so a column either way usually does it — and it ` +
            `is worth telling them kindly which one worked, so their next drawing lands first time.`
          : `Moving ${building.name}'s door left this world with something else to sort out first, so nothing ` +
            `has been written:\n  ${problems.join('\n  ')}`
      );
    }
  }
  const columns =
    asked.door === undefined && asked.plaque === undefined
      ? null
      : { door: asked.door ?? null, plaque: asked.plaque ?? null };

  const paletteFile = join(worldDir, world.palette ?? 'palette.png');
  if (!existsSync(paletteFile)) {
    throw new IntakeError(`This world has no ${relative(REPO_ROOT, paletteFile)} to paint the drawing's colours from.`);
  }
  let palette: ReturnType<typeof decodePng>;
  try {
    palette = decodePng(readFileSync(paletteFile));
  } catch (error) {
    throw new IntakeError(`Could not read ${paletteFile}: ${describeError(error)}`);
  }
  const paletteSize = palette.width * palette.height;

  const rgba = new Uint8Array(drawing.width * drawing.height * 4);
  for (let i = 0; i < drawing.pixels.length; i++) {
    const value = drawing.pixels[i];
    if (value === TRANSPARENT) continue; // rgba starts zero-filled, already transparent
    if (value >= paletteSize) {
      throw new IntakeError(
        `This drawing uses palette colour ${value}, but this world's palette only has ${paletteSize} colours (0-${paletteSize - 1}).`
      );
    }
    const p = value * 4;
    const o = i * 4;
    rgba[o] = palette.rgba[p];
    rgba[o + 1] = palette.rgba[p + 1];
    rgba[o + 2] = palette.rgba[p + 2];
    rgba[o + 3] = 255;
  }

  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, encodePng(drawing.width, drawing.height, rgba));

  const creditsPath = join(worldDir, 'credits.json');
  let credits: Credits = {};
  if (existsSync(creditsPath)) {
    try {
      credits = JSON.parse(readFileSync(creditsPath, 'utf8')) as Credits;
    } catch (error) {
      throw new IntakeError(`Could not read ${creditsPath}: ${describeError(error)}`);
    }
  }
  // A first painting simply names its painter. Repainting an already-
  // credited building with --force names everyone who worked on it, in
  // order — this credit joins the list rather than replacing it, unless the
  // name is on the list already (nothing to add) or --replace-credit says to
  // start the list over with just this one name.
  const priorCredit = credits.buildings?.[drawing.building];
  const priorNames = priorCredit === undefined ? [] : Array.isArray(priorCredit) ? priorCredit : [priorCredit];
  const names =
    options.force && priorNames.length > 0 && !options.replaceCredit
      ? priorNames.includes(credit)
        ? priorNames
        : [...priorNames, credit]
      : [credit];
  const creditText = joinCredits(names);
  credits.buildings = sortObject({ ...(credits.buildings ?? {}), [drawing.building]: names.length === 1 ? names[0] : names });
  writeFileSync(creditsPath, `${JSON.stringify(sortObject(credits as Record<string, unknown>), null, 2)}\n`);

  // world.json is pretty-printed with two spaces and a trailing newline; this
  // writes it back the same way, so the diff is only the tiles that moved.
  if (moved) writeFileSync(worldFile, `${JSON.stringify(world, null, 2)}\n`);

  const validateOutput = options.validate === false ? '' : runValidateAssets(worldsDir);

  return { drawing, pngPath, creditsPath, worldPath: moved ? worldFile : null, columns, creditText, validateOutput };
}

// --- CLI ---------------------------------------------------------------

interface CliArgs {
  positional?: string;
  credit?: string;
  force: boolean;
  replaceCredit: boolean;
  stdin: boolean;
  worldsDir?: string;
  door?: number;
  plaque?: number;
}

/** A `--door`/`--plaque` column: a whole number, counting from 0 at the building's left edge. */
function readColumn(flag: string, value: string | undefined): number {
  const column = Number(value);
  if (value === undefined || !/^\d+$/.test(value.trim()) || !Number.isInteger(column)) {
    throw new IntakeError(
      `${flag} takes a tile column — a whole number counting from 0 at the building's left edge, ` +
        `so the left-most column is 0 — and it was given "${value ?? ''}".`
    );
  }
  return column;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, replaceCredit: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--credit') {
      args.credit = argv[++i];
    } else if (arg.startsWith('--credit=')) {
      args.credit = arg.slice('--credit='.length);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--replace-credit') {
      args.replaceCredit = true;
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--worlds-dir') {
      args.worldsDir = argv[++i];
    } else if (arg.startsWith('--worlds-dir=')) {
      args.worldsDir = arg.slice('--worlds-dir='.length);
    } else if (arg === '--door' || arg === '--plaque') {
      args[arg.slice(2) as 'door' | 'plaque'] = readColumn(arg, argv[++i]);
    } else if (arg.startsWith('--door=') || arg.startsWith('--plaque=')) {
      const [flag, value] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      args[flag.slice(2) as 'door' | 'plaque'] = readColumn(flag, value);
    } else if (!args.positional && !arg.startsWith('--')) {
      args.positional = arg;
    } else {
      throw new IntakeError(`I don't understand the option "${arg}".`);
    }
  }
  return args;
}

function resolveCode(args: CliArgs): string {
  let text: string;
  if (args.stdin) {
    text = readFileSync(0, 'utf8');
  } else if (args.positional && existsSync(args.positional) && statSync(args.positional).isFile()) {
    text = readFileSync(args.positional, 'utf8');
  } else if (args.positional) {
    text = args.positional;
  } else {
    throw new IntakeError('Give me a code, a path to the saved email, or --stdin.');
  }
  return extractCode(text);
}

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!args.credit || !args.credit.trim()) {
    console.error('Every drawing needs a name to credit — run again with --credit "Their Name".');
    process.exit(1);
  }

  try {
    const code = resolveCode(args);
    const worldsDir = args.worldsDir ?? process.env.MAINSTREET_WORLDS_DIR ?? join(REPO_ROOT, 'worlds');
    const result = decodeArt({
      code,
      credit: args.credit,
      worldsDir,
      force: args.force,
      replaceCredit: args.replaceCredit,
      door: args.door,
      plaque: args.plaque
    });

    console.log(`Wrote ${relative(REPO_ROOT, result.pngPath)}`);
    console.log(`Updated ${relative(REPO_ROOT, result.creditsPath)} — credit now reads "${result.creditText}"`);
    if (result.columns) {
      const said = [
        result.columns.door === null ? '' : `door in column ${result.columns.door}`,
        result.columns.plaque === null ? '' : `plaque in column ${result.columns.plaque}`
      ]
        .filter(Boolean)
        .join(', ');
      console.log(
        result.worldPath
          ? `Updated ${relative(REPO_ROOT, result.worldPath)} — ${said} (counting from 0 at the building's left edge)`
          : `world.json already has the ${said}, so it is unchanged.`
      );
    }
    if (result.validateOutput) console.log(result.validateOutput);
    console.log(`\nNext step: open a PR with ${result.worldPath ? 'those three files' : 'those two files'}.`);
  } catch (error) {
    if (error instanceof CodeError || error instanceof IntakeError) {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    process.exit(1);
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
