/**
 * A readable script of one episode's dialogue, for copy review without
 * playing the game (DESIGN.md §3, standing issue #37).
 *
 * Run with:
 *
 *   node scripts/episode-script.ts <world> <episodeId> [--out <file.md>] [--json]
 *   npm run episode-script -- route10 ep002
 *
 * Prints Markdown to stdout by default (or writes it to `--out <file>`): the
 * episode's intro and declared flags, then every NPC in file order with their
 * map, tile and nearest building, and every one of their dialogue entries in
 * the order the engine actually evaluates them — first match wins, exactly as
 * `engine/session.ts`'s `dialogueFor` reads them — each tagged with a stable
 * anchor (`npc-<id>-<n>`, e.g. "walt 3") so a review comment can point at one
 * unambiguously. Then items, scenes (as one plain-English line per step),
 * small talk, signs and map overlays, and a closing line count.
 *
 * `--json` prints the same structure (`ScriptDoc`, below) as JSON instead —
 * meant for a future artifact page rather than for reading directly. The
 * Markdown is rendered from that same structure (`renderMarkdown`), so the
 * two are always in step.
 *
 * Reads `worlds/<world>/world.json` and `episodes/<episodeId>.json` directly —
 * this is a read-only report, not a validator, so unlike
 * `scripts/validate-episodes.ts` it never touches the Tiled maps at all. Point
 * it at a different worlds directory with `--worlds <dir>` or
 * `MAINSTREET_WORLDS_DIR`, the same as the other scripts.
 *
 * Runs under Node's built-in TypeScript type stripping, like every other
 * script here — see `scripts/validate-episodes.ts`'s own doc comment.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Episode,
  EpisodeItem,
  EpisodeNpc,
  EpisodeScene,
  EpisodeSign,
  MapOverlay,
  MoveStep,
  SceneStep,
  Vec2,
  World
} from '../engine/schema.ts';
import { SCENE_NPC, SCENE_PLAYER, SCENE_VEHICLE } from '../engine/schema.ts';

// --- the doc: what a script is built out of, and what --json prints ---------

export interface DialogueEntryDoc {
  /** Stable anchor for review notes, e.g. "npc-walt-3" ("walt 3"). */
  tag: string;
  requires: string[];
  lines: string[];
  sets: string[];
  gives?: string;
  toasts: string[];
}

export interface NpcDoc {
  id: string;
  name: string;
  map: string;
  mapName: string;
  pos: Vec2;
  /** Nearest building door within 2 tiles, else the map's own name. */
  place: string;
  until?: string;
  dialogue: DialogueEntryDoc[];
}

export interface ItemDoc {
  id: string;
  name?: string;
  blurb?: string;
  /** Ground-pickup lines. Absent for a carried-only item. */
  lines?: string[];
  where: string;
  until?: string;
}

export type ScriptSceneStep =
  | { kind: 'move'; label: string; verb: 'walks' | 'drives'; via: Vec2[] }
  | { kind: 'say'; speaker: string; lines: string[] }
  | { kind: 'toast'; text: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'camera'; to: Vec2 | 'player' | { follow: string } }
  | { kind: 'set'; flag: string }
  | { kind: 'light'; mode: string }
  | { kind: 'player'; action: 'hide' | 'show'; at?: Vec2 }
  | { kind: 'end' };

export interface SceneDoc {
  id: string;
  when: string;
  once: boolean;
  steps: ScriptSceneStep[];
}

export interface SignDoc {
  where: string;
  requires: string[];
  lines: string[];
  replace?: boolean;
}

export interface OverlayDoc {
  id: string;
  map: string;
  mapName: string;
  requires: string[];
  unless: string[];
  tileCount: number;
  props: { pos: Vec2; lines: string[] }[];
  fixtures: { pos: Vec2; kind: string; lines: string[] }[];
}

export interface ScriptDoc {
  worldId: string;
  episodeId: string;
  title: string;
  intro: string[];
  flags: string[];
  npcs: NpcDoc[];
  items: ItemDoc[];
  scenes: SceneDoc[];
  smallTalk: string[];
  signs: SignDoc[];
  overlays: OverlayDoc[];
  lineCount: { total: number; perNpc: Record<string, number> };
}

// --- building the doc from a world pack and an episode -----------------------

const posStr = (pos: Vec2): string => `[${pos[0]},${pos[1]}]`;
const mapNameOf = (world: World, mapId: string): string => world.maps[mapId]?.name ?? mapId;
const buildingNameOf = (world: World, buildingId: string): string => world.buildings[buildingId]?.name ?? buildingId;

/** Nearest building door within 2 tiles (Chebyshev distance), else the map's own name. */
function placeOf(world: World, mapId: string, pos: Vec2): string {
  const map = world.maps[mapId];
  let best: { name: string; dist: number } | undefined;
  for (const building of map?.buildings ?? []) {
    const dist = Math.max(Math.abs(building.door[0] - pos[0]), Math.abs(building.door[1] - pos[1]));
    if (dist <= 2 && (!best || dist < best.dist)) best = { name: buildingNameOf(world, building.id), dist };
  }
  return best?.name ?? mapNameOf(world, mapId);
}

function npcName(id: string, episode: Episode): string {
  return episode.npcs.find((npc) => npc.id === id)?.name ?? id;
}

/** A vehicle has no display name in the schema, so this reads one off its id — "jess-l-wagon" is "the wagon". */
function vehicleLabel(id: string): string {
  const parts = id.split('-');
  return `the ${parts[parts.length - 1]}`;
}

function dialogueDocs(npc: EpisodeNpc): DialogueEntryDoc[] {
  return npc.dialogue.map((entry, i) => {
    const sets: string[] = [];
    const toasts: string[] = [];
    for (const effect of entry.effects ?? []) {
      if (effect.set !== undefined) sets.push(effect.set);
      if (effect.toast !== undefined) toasts.push(effect.toast);
    }
    return { tag: `npc-${npc.id}-${i + 1}`, requires: entry.requires, lines: entry.lines, sets, gives: entry.item, toasts };
  });
}

function npcDoc(npc: EpisodeNpc, world: World): NpcDoc {
  return {
    id: npc.id,
    name: npc.name,
    map: npc.map,
    mapName: mapNameOf(world, npc.map),
    pos: npc.pos,
    place: placeOf(world, npc.map, npc.pos),
    until: npc.until,
    dialogue: dialogueDocs(npc)
  };
}

function itemDoc(item: EpisodeItem, world: World): ItemDoc {
  const where =
    item.map !== undefined && item.pos !== undefined
      ? `${mapNameOf(world, item.map)} tile ${posStr(item.pos)}`
      : 'handed over in dialogue';
  return { id: item.id, name: item.name, blurb: item.blurb, lines: item.lines, where, until: item.until };
}

/**
 * Where a vehicle stands before any scene has moved it — its own `pos`, or
 * the start of its `path` for one that already drives a fixed route. Only
 * vehicles get a tracked "from": a person's dialogue already says where they
 * are, so their moves in a scene are read as "walks to X" and nothing more.
 */
function initialVehiclePositions(episode: Episode): Map<string, Vec2> {
  const known = new Map<string, Vec2>();
  for (const vehicle of episode.vehicles ?? []) {
    const start = vehicle.pos ?? vehicle.path?.[0];
    if (start) known.set(`${SCENE_VEHICLE}${vehicle.id}`, start);
  }
  return known;
}

function moveStepDoc(move: MoveStep, episode: Episode, known: Map<string, Vec2>): ScriptSceneStep {
  const isVehicle = move.who.startsWith(SCENE_VEHICLE);
  const label = move.who === SCENE_PLAYER ? 'the player' : isVehicle ? vehicleLabel(move.who.slice(SCENE_VEHICLE.length)) : npcName(move.who, episode);
  const verb: 'walks' | 'drives' = isVehicle ? 'drives' : 'walks';
  const rest = move.path ?? (move.to ? [move.to] : []);

  let via: Vec2[];
  if (isVehicle) {
    const from = known.get(move.who);
    const sameAsFirst = from && rest[0] && from[0] === rest[0][0] && from[1] === rest[0][1];
    via = from ? (sameAsFirst ? rest : [from, ...rest]) : rest;
    const last = via[via.length - 1];
    if (last) known.set(move.who, last);
  } else {
    via = rest;
  }
  return { kind: 'move', label, verb, via };
}

function sceneStepDoc(step: SceneStep, episode: Episode, known: Map<string, Vec2>): ScriptSceneStep {
  if (step.move) return moveStepDoc(step.move, episode, known);
  if (step.say) return { kind: 'say', speaker: step.say.who ? npcName(step.say.who, episode) : 'the narrator', lines: step.say.lines };
  if (step.toast !== undefined) return { kind: 'toast', text: step.toast };
  if (step.wait !== undefined) return { kind: 'wait', seconds: step.wait };
  if (step.camera) {
    const to = step.camera.to;
    if (typeof to === 'string' && to !== SCENE_PLAYER) {
      return { kind: 'camera', to: { follow: npcName(to.slice(SCENE_NPC.length), episode) } };
    }
    return { kind: 'camera', to };
  }
  if (step.set !== undefined) return { kind: 'set', flag: step.set };
  if (step.light) return { kind: 'light', mode: step.light.mode };
  if (step.player) return step.player.hide ? { kind: 'player', action: 'hide' } : { kind: 'player', action: 'show', at: step.player.show?.at };
  return { kind: 'end' };
}

function sceneDoc(scene: EpisodeScene, episode: Episode, world: World, known: Map<string, Vec2>): SceneDoc {
  const when = scene.on.flag
    ? `flag "${scene.on.flag}" is set`
    : `entering ${mapNameOf(world, scene.on.enter ?? '')}${scene.on.requires?.length ? ` (requires ${scene.on.requires.join(' + ')})` : ''}`;
  return { id: scene.id, when, once: scene.once ?? true, steps: scene.steps.map((step) => sceneStepDoc(step, episode, known)) };
}

function signDoc(sign: EpisodeSign, world: World): SignDoc {
  const where = sign.building
    ? buildingNameOf(world, sign.building)
    : sign.map !== undefined && sign.pos !== undefined
      ? `${mapNameOf(world, sign.map)} tile ${posStr(sign.pos)}`
      : 'unknown';
  return { where, requires: sign.requires, lines: sign.lines, replace: sign.replace };
}

function overlayDoc(overlay: MapOverlay, world: World): OverlayDoc {
  return {
    id: overlay.id,
    map: overlay.map,
    mapName: mapNameOf(world, overlay.map),
    requires: overlay.requires,
    unless: overlay.unless ?? [],
    tileCount: overlay.tiles.length,
    props: (overlay.props ?? []).map((prop) => ({ pos: prop.pos, lines: prop.lines })),
    fixtures: (overlay.fixtures ?? []).map((fixture) => ({ pos: fixture.pos, kind: fixture.kind, lines: fixture.lines ?? [] }))
  };
}

export function buildScript(worldId: string, world: World, episode: Episode): ScriptDoc {
  const npcs = episode.npcs.map((npc) => npcDoc(npc, world));
  const items = (episode.items ?? []).map((item) => itemDoc(item, world));
  const known = initialVehiclePositions(episode);
  const scenes = (episode.scenes ?? []).map((scene) => sceneDoc(scene, episode, world, known));
  const signs = (episode.signs ?? []).map((sign) => signDoc(sign, world));
  const overlays = (episode.overlays ?? []).map((overlay) => overlayDoc(overlay, world));

  const perNpc: Record<string, number> = {};
  for (const npc of npcs) perNpc[npc.id] = npc.dialogue.reduce((sum, entry) => sum + entry.lines.length, 0);

  const doc: ScriptDoc = {
    worldId,
    episodeId: episode.id,
    title: episode.title,
    intro: episode.intro ?? [],
    flags: episode.flags,
    npcs,
    items,
    scenes,
    smallTalk: episode.smallTalk ?? [],
    signs,
    overlays,
    lineCount: { total: 0, perNpc }
  };
  doc.lineCount.total = allLines(doc).length;
  return doc;
}

/** Every line of copy a player could actually read, in the order this doc lists them — used both to check the Markdown says each one exactly once, and by anything else that wants the episode's full word count. */
export function allLines(doc: ScriptDoc): string[] {
  const out: string[] = [];
  out.push(...doc.intro);
  for (const npc of doc.npcs) for (const entry of npc.dialogue) out.push(...entry.lines);
  for (const item of doc.items) out.push(...(item.lines ?? []));
  for (const scene of doc.scenes) for (const step of scene.steps) if (step.kind === 'say') out.push(...step.lines);
  out.push(...doc.smallTalk);
  for (const sign of doc.signs) out.push(...sign.lines);
  for (const overlay of doc.overlays) for (const prop of overlay.props) out.push(...prop.lines);
  return out;
}

// --- rendering the doc as Markdown -------------------------------------------

const quote = (line: string): string => `> ${line}`;
const when = (requires: string[]): string => (requires.length ? requires.join(' + ') : '(always)');

function renderStep(step: ScriptSceneStep): string {
  switch (step.kind) {
    case 'move':
      return step.via.length <= 1
        ? `${step.label} ${step.verb} to ${step.via[0] ? posStr(step.via[0]) : '?'}`
        : `${step.label} ${step.verb} ${step.via.map(posStr).join(' → ')}`;
    case 'say':
      return `${step.speaker} says: ${step.lines.map((line) => `"${line}"`).join(' / ')}`;
    case 'toast':
      return `toast: "${step.text}"`;
    case 'wait':
      return `wait ${step.seconds} s`;
    case 'camera':
      return `camera → ${step.to === 'player' ? 'player' : 'follow' in step.to ? `follows ${step.to.follow}` : posStr(step.to)}`;
    case 'set':
      return `set ${step.flag}`;
    case 'light':
      return `lights → ${step.mode}`;
    case 'player':
      return step.action === 'hide' ? 'player hidden' : `player shown${step.at ? ` at ${posStr(step.at)}` : ''}`;
    case 'end':
      return 'scene ends here';
  }
}

export function renderMarkdown(doc: ScriptDoc): string {
  const out: string[] = [];
  out.push(`# ${doc.episodeId} — ${doc.title}`, '');
  if (doc.intro.length) {
    out.push('Intro:');
    out.push(...doc.intro.map(quote), '');
  }
  out.push(`Flags: ${doc.flags.join(', ')}`, '');

  for (const npc of doc.npcs) {
    out.push(`## ${npc.name} (${npc.id})`);
    const spot = `${npc.mapName} ${posStr(npc.pos)}`;
    out.push(npc.place === npc.mapName ? spot : `${spot} — at ${npc.place}`);
    if (npc.until) out.push(`*Gone once: ${npc.until}.*`);
    out.push('');
    for (const entry of npc.dialogue) {
      out.push(`<a id="${entry.tag}"></a>`, `### when: ${when(entry.requires)}`, '');
      out.push(...entry.lines.map(quote));
      const footer: string[] = [];
      if (entry.sets.length) footer.push(`→ sets: ${entry.sets.join(', ')}`);
      if (entry.gives) footer.push(`→ gives: ${entry.gives}`);
      footer.push(...entry.toasts.map((toast) => `→ toast: "${toast}"`));
      if (footer.length) out.push('', ...footer);
      out.push('');
    }
  }

  out.push('## Items');
  if (!doc.items.length) out.push('_None._');
  out.push('');
  for (const item of doc.items) {
    out.push(`### ${item.id}${item.name ? ` — ${item.name}` : ''}`);
    out.push(`Where: ${item.where}`);
    if (item.until) out.push(`Until: ${item.until}`);
    if (item.lines?.length) out.push('Pickup lines:', ...item.lines.map(quote));
    if (item.blurb) out.push(`Blurb: ${item.blurb}`);
    out.push('');
  }

  out.push('## Scenes');
  if (!doc.scenes.length) out.push('_None._');
  out.push('');
  for (const scene of doc.scenes) {
    out.push(`### ${scene.id}`);
    out.push(`on: ${scene.when}${scene.once === false ? ' (replays every time)' : ''}`, '');
    out.push(...scene.steps.map((step) => `- ${renderStep(step)}`), '');
  }

  out.push('## Small talk');
  out.push(doc.smallTalk.length ? '' : '_None._');
  out.push(...doc.smallTalk.map((line) => `- ${line}`), '');

  out.push('## Signs & overlays');
  if (!doc.signs.length && !doc.overlays.length) out.push('_None._');
  out.push('');
  for (const sign of doc.signs) {
    out.push(`### Sign: ${sign.where}`);
    out.push(`when: ${when(sign.requires)}${sign.replace ? ' (replaces the standing sign)' : ''}`);
    out.push(...sign.lines.map(quote), '');
  }
  for (const overlay of doc.overlays) {
    const conditions = [overlay.requires.length ? overlay.requires.join(' + ') : '', overlay.unless.length ? `unless ${overlay.unless.join(' + ')}` : '']
      .filter(Boolean)
      .join(', ');
    out.push(`### Overlay: ${overlay.id}`);
    out.push(`map: ${overlay.mapName} — when: ${conditions || '(always)'}`);
    out.push(`- paints ${overlay.tileCount} tile${overlay.tileCount === 1 ? '' : 's'}`);
    for (const prop of overlay.props) {
      out.push(`- prop at ${posStr(prop.pos)}:`);
      out.push(...prop.lines.map((line) => `  ${quote(line)}`));
    }
    for (const fixture of overlay.fixtures) {
      out.push(`- fixture (${fixture.kind}) at ${posStr(fixture.pos)}${fixture.lines.length ? ':' : ''}`);
      out.push(...fixture.lines.map((line) => `  ${quote(line)}`));
    }
    out.push('');
  }

  out.push('## Line count');
  out.push(`Total: ${doc.lineCount.total} lines`);
  out.push(...doc.npcs.map((npc) => `- ${npc.name}: ${doc.lineCount.perNpc[npc.id]}`));

  return `${out.join('\n')}\n`;
}

// --- the script ---------------------------------------------------------------

function usage(): never {
  console.error('usage: node scripts/episode-script.ts <world> <episodeId> [--out <file.md>] [--json] [--worlds <dir>]');
  process.exit(2);
}

function main(argv: string[]): void {
  const positional: string[] = [];
  let outFile: string | undefined;
  let json = false;
  let worldsArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') outFile = argv[++i];
    else if (a === '--json') json = true;
    else if (a === '--worlds') worldsArg = argv[++i];
    else if (a.startsWith('--')) i++;
    else positional.push(a);
  }
  const [worldId, episodeId] = positional;
  if (!worldId || !episodeId) usage();

  const worldsRoot = worldsArg ?? process.env.MAINSTREET_WORLDS_DIR ?? 'worlds';
  const pack = join(worldsRoot, worldId);

  let world: World;
  let episode: Episode;
  try {
    world = JSON.parse(readFileSync(join(pack, 'world.json'), 'utf8')) as World;
    episode = JSON.parse(readFileSync(join(pack, 'episodes', `${episodeId}.json`), 'utf8')) as Episode;
  } catch (error) {
    console.error(`✗ ${worldId}/${episodeId}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const doc = buildScript(worldId, world, episode);
  const output = json ? `${JSON.stringify(doc, null, 2)}\n` : renderMarkdown(doc);

  if (outFile) writeFileSync(outFile, output);
  else process.stdout.write(output);
}

// Only when run as a script, so the test can import the pure parts.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/episode-script.ts')) main(process.argv.slice(2));
