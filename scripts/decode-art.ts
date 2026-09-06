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
 *     file if it doesn't exist yet, keeping its keys sorted.
 *  5. Runs the same checks scripts/validate-assets.ts runs, against the same
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
import type { Credits, World } from '../engine/schema.ts';

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
  /** Run validate-assets.ts afterwards as a sanity check. Defaults to true. */
  validate?: boolean;
}

export interface DecodeArtResult {
  drawing: Drawing;
  pngPath: string;
  creditsPath: string;
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
  credits.buildings = sortObject({ ...(credits.buildings ?? {}), [drawing.building]: credit });
  writeFileSync(creditsPath, `${JSON.stringify(sortObject(credits as Record<string, unknown>), null, 2)}\n`);

  const validateOutput = options.validate === false ? '' : runValidateAssets(worldsDir);

  return { drawing, pngPath, creditsPath, validateOutput };
}

// --- CLI ---------------------------------------------------------------

interface CliArgs {
  positional?: string;
  credit?: string;
  force: boolean;
  stdin: boolean;
  worldsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--credit') {
      args.credit = argv[++i];
    } else if (arg.startsWith('--credit=')) {
      args.credit = arg.slice('--credit='.length);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--worlds-dir') {
      args.worldsDir = argv[++i];
    } else if (arg.startsWith('--worlds-dir=')) {
      args.worldsDir = arg.slice('--worlds-dir='.length);
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
    const result = decodeArt({ code, credit: args.credit, worldsDir, force: args.force });

    console.log(`Wrote ${relative(REPO_ROOT, result.pngPath)}`);
    console.log(`Updated ${relative(REPO_ROOT, result.creditsPath)}`);
    if (result.validateOutput) console.log(result.validateOutput);
    console.log('\nNext step: open a PR with those two files.');
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
