#!/usr/bin/env node
/**
 * Headless end-to-end playtest.
 *
 * Boots the dev server's build in Chromium, walks the player through the whole
 * of an episode, screenshots every milestone, and exits non-zero with a
 * readable message on the first thing that goes wrong. It reads the world pack
 * from disk to path-find, and reads engine state from `window.__mainstreet`
 * (published only when `import.meta.env.DEV`, see engine/debug.ts).
 *
 * The harness is written against `ep000` (route10's test fixture, kept off
 * the shipped `world.episodes` list but still on disk) — Earl, Hannah, the
 * pen, the shelf sign, the painted sign check. It plays that episode via
 * `?episode=` (DESIGN.md §3, engine/scenes/boot.ts) regardless of what
 * world.json actually ships, so it keeps exercising ep000 even as new
 * episodes are added. Override with PLAYTEST_EPISODE if ever needed.
 *
 * One section runs with no parameters at all, on the title screen the game
 * really opens on (DESIGN.md §2): it starts the *shipped* episode from the
 * list, sets a flag, reloads, and carries on where the save left off.
 *
 * Usage:  npx playwright install chromium   # once
 *         npm run playtest
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The codec is deliberately DOM- and Node-free (studio/codec.ts's own header),
// so the harness can build a worst-case drawing the same way scripts/decode-
// art.ts reads a real one — no browser needed to make a code this big.
import { encode } from '../studio/codec.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PLAYTEST_URL ?? 'http://localhost:5173/';
const OUT = process.env.PLAYTEST_OUT ?? resolve(ROOT, 'playtest-out');
const SHOTS = OUT;
const LOG = resolve(OUT, 'playtest.log');
const TILE_EPS = 0.06; // stop this far early: one frame is ~0.11 tiles at 102px/s

const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

// --- world data --------------------------------------------------------------

function worldId() {
  const env = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const m = env.match(/^\s*VITE_WORLD\s*=\s*(\S+)/m);
  if (!m) throw new Error('.env has no VITE_WORLD');
  return m[1];
}

const WORLD_ID = worldId();
const PACK = resolve(ROOT, 'worlds', WORLD_ID);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const WORLD = readJson(resolve(PACK, 'world.json'));
const COPY = readJson(resolve(PACK, 'copy.json'));

// The harness plays a fixed episode by id, via `?episode=` (DESIGN.md §3), so
// it keeps exercising the episode it is written against — ep000, by default
// — whether or not world.json ships it. See the file header.
const PLAYTEST_EPISODE = process.env.PLAYTEST_EPISODE ?? 'ep000';
const EPISODE = readJson(resolve(PACK, 'episodes', `${PLAYTEST_EPISODE}.json`));
/** Every page load of the game itself (never the Studio) plays PLAYTEST_EPISODE. */
const GAME_URL = `${BASE}?episode=${encodeURIComponent(PLAYTEST_EPISODE)}`;

/**
 * The tile grids are Tiled files (DESIGN.md §2). This reads them the way the
 * engine does — every visible tile layer, gids masked of their flip flags,
 * `solid` off the tileset's per-tile properties — deliberately as a second
 * implementation, so a harness that walks where the engine will not walk is a
 * failure rather than a shared bug. Each map metadata block in world.json
 * gains `width`, `height` and a solidity grid here.
 */
const GID_MASK = 0x1fffffff;
for (const [mapId, map] of Object.entries(WORLD.maps)) {
  const file = resolve(PACK, 'maps', `${mapId}.json`);
  const tiled = readJson(file);
  const solidGid = new Set();
  // Which local tile ids are solid, per tileset: an overlay names a tile that
  // way rather than by gid (DESIGN.md §3), so both spellings are kept.
  map.id = mapId;
  map.tilesetSolid = new Map();
  for (const ref of tiled.tilesets) {
    const tileset = readJson(resolve(dirname(file), ref.source));
    const ids = new Set();
    for (const tile of tileset.tiles ?? []) {
      if (tile.properties?.some((p) => p.name === 'solid' && p.value === true)) {
        solidGid.add(ref.firstgid + tile.id);
        ids.add(tile.id);
      }
    }
    map.tilesetSolid.set(tileset.name, ids);
  }
  map.width = tiled.width;
  map.height = tiled.height;
  map.solid = new Array(tiled.width * tiled.height).fill(false);
  for (const layer of tiled.layers) {
    if (layer.type !== 'tilelayer' || layer.visible === false) continue;
    layer.data.forEach((gid, i) => {
      if (solidGid.has(gid & GID_MASK)) map.solid[i] = true;
    });
  }
}

/**
 * Tiles a flag-gated overlay has painted solid right now, as "map,x,y"
 * (DESIGN.md §3). Empty unless a section has said which overlays are on: the
 * harness's own second implementation of `withOverlays`, kept deliberately
 * separate from the engine's like isSolid() below.
 */
const overlaySolid = new Set();

function overlayTileSolid(map, ref) {
  if (typeof ref === 'number') return [...map.tilesetSolid.values()].some((ids) => ids.has(ref));
  const at = String(ref).lastIndexOf(':');
  if (at <= 0) return false;
  return Boolean(map.tilesetSolid.get(String(ref).slice(0, at))?.has(Number(String(ref).slice(at + 1))));
}

/** Recomputes `overlaySolid` for an episode against the flags that are set. */
function noteOverlays(episode, flags) {
  overlaySolid.clear();
  for (const overlay of episode.overlays ?? []) {
    if (!(overlay.requires ?? []).every((f) => flags[f])) continue;
    if ((overlay.unless ?? []).some((f) => flags[f])) continue;
    const map = WORLD.maps[overlay.map];
    if (!map) continue;
    for (const paint of overlay.tiles ?? []) {
      if (overlayTileSolid(map, paint.tile)) overlaySolid.add(`${overlay.map},${paint.pos[0]},${paint.pos[1]}`);
    }
  }
}

/** Mirrors engine/validate.ts isSolid(), plus whatever an overlay has painted. */
function isSolid(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  if (map.solid[y * map.width + x]) return true;
  if (overlaySolid.has(`${map.id},${x},${y}`)) return true;
  return map.buildings.some(
    (b) => x >= b.pos[0] && x < b.pos[0] + b.size[0] && y >= b.pos[1] && y < b.pos[1] + b.size[1]
  );
}

/**
 * The tile a building's plaque is read from — a second implementation of
 * engine/schema.ts's `plaqueTile`, deliberately, like isSolid() above.
 * Default: right of the door, or left of it when the door is already in the
 * building's right-most column. `"plaque": false` means the building has none.
 */
function plaqueOf(placement) {
  if (placement.plaque === false) return null;
  if (placement.plaque) return placement.plaque;
  const rightMost = placement.pos[0] + placement.size[0] - 1;
  return [placement.door[0] + (placement.door[0] >= rightMost ? -1 : 1), placement.door[1]];
}

/**
 * What a door reads, mirroring engine/session.ts's `signLinesFor` the way
 * isSolid() and plaqueOf() mirror their engine counterparts: the episode's
 * first matching sign for the building, then the building's standing sign in
 * world.json underneath it — unless that episode sign sets `replace`, which
 * takes the door for the story alone (DESIGN.md §3). The harness plays from a
 * clean save, so "matching" here means the signs with no `requires`.
 */
function signLinesOf(buildingId) {
  const standing = WORLD.buildings[buildingId]?.sign ?? [];
  const sign = (EPISODE.signs ?? []).find((s) => s.building === buildingId && (s.requires ?? []).length === 0);
  if (!sign) return [...standing];
  return sign.replace ? [...sign.lines] : [...sign.lines, ...standing];
}

/**
 * Where everybody actually is, as of the last snapshot read. Townspeople walk
 * (engine/mover.ts), so their placed position in world.json or in the episode
 * is where they *started*, not where they are: the engine publishes the live
 * tiles alongside the player's, and this is the harness's copy of them.
 */
let live = { map: null, people: [] };

function liveAt(mapId, x, y) {
  if (live.map !== mapId) return false;
  return live.people.some((p) => (p.tiles ?? []).some((t) => t[0] === x && t[1] === y));
}

/**
 * NPCs are episode data, so MapScene.solidTile() blocks on them separately.
 * Which episode is playing matters — the title-screen section plays the
 * shipped one rather than the harness's ep000 — so the caller may say. Anybody
 * walking is blocked where they are standing now, on top of that.
 */
function npcAt(mapId, x, y, episode = EPISODE) {
  if (episode.npcs.some((n) => n.map === mapId && n.pos[0] === x && n.pos[1] === y)) return true;
  return liveAt(mapId, x, y);
}

/**
 * Street fixtures stand on a walkable tile and block it, so — like NPCs, and
 * for the same reason — they are not in isSolid() but MapScene.solidTile()
 * stops the player on them (DESIGN.md §2).
 */
function fixtureAt(mapId, x, y) {
  return (WORLD.maps[mapId].fixtures ?? []).some((f) => f.pos[0] === x && f.pos[1] === y);
}

function exitTiles(map) {
  const set = new Set();
  for (const e of map.exits) {
    for (let x = e.at[0]; x < e.at[0] + e.at[2]; x++) {
      for (let y = e.at[1]; y < e.at[1] + e.at[3]; y++) set.add(`${x},${y}`);
    }
  }
  return set;
}

/** BFS over walkable tiles. Exits are avoided unless one is the goal. */
function findPath(mapId, from, to, episode = EPISODE) {
  const map = WORLD.maps[mapId];
  const avoid = exitTiles(map);
  avoid.delete(`${to[0]},${to[1]}`);
  const key = (p) => `${p[0]},${p[1]}`;
  const start = key(from);
  const goal = key(to);
  if (start === goal) return [from];
  const prev = new Map([[start, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cur[0] + dx;
      const ny = cur[1] + dy;
      const k = `${nx},${ny}`;
      if (prev.has(k)) continue;
      if (isSolid(map, nx, ny) || npcAt(mapId, nx, ny, episode) || fixtureAt(mapId, nx, ny)) continue;
      if (avoid.has(k) && k !== goal) continue;
      prev.set(k, cur);
      if (k === goal) {
        const path = [];
        let node = [nx, ny];
        while (node) {
          path.unshift(node);
          node = prev.get(key(node));
        }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

// --- harness plumbing --------------------------------------------------------

let shotIndex = 0;
const problems = [];
const consoleLines = [];
const pageErrors = [];

class Failure extends Error {}

/**
 * The last thing the run said out loud. The watchdog reads it, so that a run
 * that wedges says where it got to instead of just stopping.
 */
let lastSaid = 'starting up';

/** Everything the run prints also lands in playtest-out/playtest.log. */
function log(line = '') {
  if (line.trim()) lastSaid = line.trim();
  console.log(line);
  try {
    appendFileSync(LOG, line + '\n');
  } catch {
    /* the log is a convenience, never a reason to fail a run */
  }
}

function logErr(line = '') {
  console.error(line);
  try {
    appendFileSync(LOG, line + '\n');
  } catch {
    /* ignore */
  }
}

function fail(milestone, detail) {
  throw new Failure(`[${milestone}] ${detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A wait with a ceiling on it. Two things in here have no timeout of their
 * own and can therefore wait for ever: `page.evaluate()` and a CDP `send()`.
 * The touch dispatches are the sharp edge — Chromium only answers
 * `Input.dispatchTouchEvent` once the renderer has acknowledged the event, and
 * a touchmove that starts a scroll is not acknowledged until a frame has been
 * painted, which a busy machine can put off indefinitely. Everything that
 * could hang goes through here, so a stuck run fails with a sentence rather
 * than sitting there.
 */
function within(ms, label, work) {
  let timer;
  const capped = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Failure(`[timeout] ${label} did not answer inside ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, capped]).finally(() => clearTimeout(timer));
}

/** page.evaluate() with a ceiling on it. */
const evalIn = (page, label, fn, arg, ms = 20000) => within(ms, label, page.evaluate(fn, arg));

/**
 * The camera rides along with the player, so a tile is only briefly at any one
 * place on the canvas: at zoom 2 the view slides a whole tile every ~160ms of
 * walking. Everything a tap needs — the camera's view and the canvas box — is
 * therefore read in one round trip, and the aim is the exact centre of the
 * tile, which leaves half a tile of slack for whatever the machine spends
 * getting the touch back down the wire.
 */
async function pointOfTile(page, tile, milestone = 'tap-walk') {
  const p = await page.evaluate(([tx, ty]) => {
    const s = window.__mainstreet;
    const canvas = document.querySelector('#stage canvas');
    if (!s?.view || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const v = s.view;
    return {
      x: r.left + ((tx * v.tile + v.tile / 2 - v.x) / v.width) * r.width,
      y: r.top + ((ty * v.tile + v.tile / 2 - v.y) / v.height) * r.height,
      box: { x: r.left, y: r.top, width: r.width, height: r.height }
    };
  }, tile);
  if (!p) fail(milestone, 'the page has no camera view to tap into');
  if (p.x < p.box.x || p.y < p.box.y || p.x > p.box.x + p.box.width || p.y > p.box.y + p.box.height) {
    fail(milestone, `tile ${tile} is off screen (${JSON.stringify(p)})`);
  }
  return p;
}

/**
 * A click on a tile. Mouse and finger come down the one pointer path
 * (CLAUDE.md hard rule 4, engine/input.ts), so this is the same tap the touch
 * pages make — it is only aimed with a mouse, on a page that has no touch.
 */
async function clickTile(page, tile, milestone) {
  const p = await pointOfTile(page, tile, milestone);
  await page.mouse.click(p.x, p.y);
}

async function shot(page, slug, options = {}) {
  shotIndex += 1;
  const name = `${String(shotIndex).padStart(2, '0')}-${slug}.png`;
  const file = resolve(SHOTS, name);
  await page.screenshot({ path: file, ...options });
  log(`    shot  ${name}`);
  return file;
}

const snap = async (page) => {
  const state = await page.evaluate(() => window.__mainstreet ?? null);
  // Every read of the engine's state refreshes where the townspeople are, so
  // the path-finding below never routes the player through somebody.
  if (state) live = { map: state.map, people: state.people ?? [] };
  return state;
};
/** The title screen's list, published the same dev-only way (engine/debug.ts). */
const titleSnap = (page) => page.evaluate(() => window.__mainstreetTitle ?? null);

/**
 * Polls until the snapshot satisfies `predicate`. `nudge` is for the few waits
 * that need the player to keep doing something to get there — walking back out
 * through a door, say — and runs between polls.
 */
async function waitUntil(page, predicate, label, timeout = 20000, nudge = null) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await snap(page);
    if (last && predicate(last)) return last;
    if (nudge) await nudge();
    await sleep(25);
  }
  fail('wait', `timed out waiting for ${label}; state = ${JSON.stringify(last)}`);
}

/** Collision tile: the engine samples the hitbox at +4px and +12px. */
const tileOf = (v) => Math.floor(v + 0.25);
const here = (s) => [tileOf(s.x), tileOf(s.y)];

/**
 * Holds a direction key until the axis crosses `target`. The keyup is fired
 * from inside the page on the very frame the target is reached, so the player
 * never overshoots into the neighbouring tile (which would change what the
 * engine's 8px-inset hitbox collides with).
 */
async function hold(page, dir, axis, target, sign) {
  await page.keyboard.down(KEY[dir]);
  const result = await page.evaluate(
    ({ key, axis, target, sign, eps }) =>
      new Promise((done) => {
        const t0 = performance.now();
        let last = null;
        let moved = t0;
        const stop = (reason) => {
          window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
          done({ reason, state: window.__mainstreet });
        };
        const tick = () => {
          const s = window.__mainstreet;
          if (!s) return stop('no-state');
          if (s.locked || s.dialogueOpen) return stop('interrupted');
          const v = s[axis];
          if (sign > 0 ? v >= target - eps : v <= target + eps) return stop('arrived');
          if (last === null || Math.abs(v - last) > 0.02) {
            last = v;
            moved = performance.now();
          } else if (performance.now() - moved > 500) {
            return stop('stuck');
          }
          if (performance.now() - t0 > 8000) return stop('timeout');
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { key: KEY[dir], axis, target, sign, eps: TILE_EPS }
  );
  await page.keyboard.up(KEY[dir]);
  return result;
}

/**
 * Walks to a tile. `allowInterrupt` is for tiles that are exit triggers: the
 * engine locks input the instant the player steps on one.
 */
async function walkTo(page, milestone, goal, { allowInterrupt = false, episode = EPISODE } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await snap(page);
    if (!s) fail(milestone, 'window.__mainstreet is missing');
    const from = here(s);
    if (from[0] === goal[0] && from[1] === goal[1]) return;
    const path = findPath(s.map, from, goal, episode);
    if (!path) fail(milestone, `no walkable path on "${s.map}" from ${from} to ${goal}`);

    for (let i = 1; i < path.length; i++) {
      // Collapse the path into straight runs so a key is held across a
      // corridor — but only so far: at 102px/s a run longer than this outlives
      // hold()'s own eight-second cap, and a walk the length of a village
      // would be reported as a timeout rather than walked.
      const MAX_RUN = 24;
      const dx = path[i][0] - path[i - 1][0];
      const dy = path[i][1] - path[i - 1][1];
      let j = i;
      while (
        j + 1 < path.length &&
        j - i < MAX_RUN &&
        path[j + 1][0] - path[j][0] === dx &&
        path[j + 1][1] - path[j][1] === dy
      ) {
        j++;
      }
      const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
      const axis = dx !== 0 ? 'x' : 'y';
      const sign = dx !== 0 ? dx : dy;
      const target = axis === 'x' ? path[j][0] : path[j][1];
      const { reason, state } = await hold(page, dir, axis, target, sign);
      if (reason === 'arrived') {
        i = j;
        continue;
      }
      if (reason === 'interrupted') {
        if (allowInterrupt) return;
        fail(milestone, `walk to ${goal} was interrupted at ${JSON.stringify(state)}`);
      }
      if (reason === 'stuck') {
        // Re-path once; a nudge can leave the hitbox straddling two tiles.
        break;
      }
      fail(milestone, `walk to ${goal} ended with "${reason}" at ${JSON.stringify(state)}`);
    }
    const after = await snap(page);
    const at = here(after);
    if (at[0] === goal[0] && at[1] === goal[1]) return;
    if (allowInterrupt && (after.locked || after.map !== s.map)) return;
  }
  const s = await snap(page);
  fail(milestone, `could not reach ${goal}; stopped at ${here(s)} on "${s.map}" (x=${s.x.toFixed(2)}, y=${s.y.toFixed(2)})`);
}

/** Space, spaced out past the 220ms action debounce. */
async function pressA(page) {
  await page.keyboard.press('Space');
  await sleep(320);
}

async function advanceDialogue(page, milestone, lines) {
  for (let i = 0; i < lines + 3; i++) {
    const s = await snap(page);
    if (!s.dialogueOpen) return i;
    await pressA(page);
  }
  fail(milestone, `dialogue did not close after ${lines + 3} advances`);
}

/**
 * Reads an entry to the end, one A press per page, and returns how many pages
 * it had — which is how the harness tells whether the engine appended a page
 * of its own to the world's copy. `onPage(i)` runs while page i is on screen,
 * before the press that leaves it.
 */
async function readDialogue(page, milestone, expected, onPage) {
  for (let i = 0; i < expected + 4; i++) {
    if (!(await snap(page)).dialogueOpen) return i;
    if (onPage) await onPage(i);
    await pressA(page);
  }
  fail(milestone, `dialogue did not close after ${expected + 4} advances`);
}

async function expectDialogue(page, milestone, what) {
  const s = await snap(page);
  if (!s.dialogueOpen) fail(milestone, `expected a dialogue box for ${what}, none opened`);
  return s;
}

/**
 * Plays out whatever scene an episode stages on the map the player is standing
 * on right now — the evening coming on outside a lit room, say (DESIGN.md §3).
 * Which scene that is comes from the episode's own data and the flags that are
 * actually set, so the harness never has to be told one exists.
 *
 * A scene's `say` waits for the box to be read, and the box does not open on
 * the frame the map appears: it opens once the threshold card is down and the
 * scene has had a turn. So this waits for the line the step names, checks it
 * is that line, reads it, and waits for the scene to finish — which is what
 * keeps a walk started afterwards from being interrupted by it.
 */
async function playStagedScene(page, episode, mapId, except) {
  const now = await snap(page);
  const staged = (episode.scenes ?? []).find(
    (sc) =>
      sc.on?.enter === mapId &&
      sc.id !== except &&
      (sc.on.requires ?? []).every((f) => now.flags[f]) &&
      now.flags[`scene:${sc.id}`] !== true
  );
  if (!staged) return null;

  log(`    a scene staged out here too: "${staged.id}"`);
  const say = staged.steps.find((st) => st.say)?.say;
  if (say) {
    const line = await waitUntil(page, (st) => st.dialogueOpen, `"${staged.id}" to say its line`, 25000);
    const speaker = say.who ? episode.npcs.find((n) => n.id === say.who)?.name : COPY.ui.narrator;
    if (line.dialogue?.speaker !== speaker) {
      fail('scene-staged', `"${staged.id}" named "${line.dialogue?.speaker}", expected "${speaker}"`);
    }
    if (line.dialogue?.text !== say.lines[0]) {
      fail('scene-staged', `"${staged.id}" reads "${line.dialogue?.text}", expected "${say.lines[0]}"`);
    }
    log(`    ${speaker} — "${line.dialogue.text}"`);
    await advanceDialogue(page, 'scene-staged', say.lines.length);
  }

  // A `once` scene records itself; one that may run again simply ends.
  const done = await waitUntil(
    page,
    (st) => st.scene === null && (staged.once === false || st.flags[`scene:${staged.id}`] === true),
    `"${staged.id}" to finish`,
    30000
  );
  const lit = staged.steps.find((st) => st.light)?.light;
  if (lit && done.light?.mode !== lit.mode) {
    fail('scene-staged', `"${staged.id}" left the lights "${done.light?.mode}", expected "${lit.mode}"`);
  }
  if (lit) log(`    and it left the lights "${done.light.mode}"${lit.keep ? ', which a map change keeps' : ''}`);
  return staged;
}

function expectFlag(state, milestone, name, want = true) {
  if (state.flags[name] !== want) {
    fail(milestone, `flag "${name}" is ${state.flags[name]}, expected ${want}. flags=${JSON.stringify(state.flags)}`);
  }
}

function attach(page, tag) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    // Unpainted world packs 404 on every asset probe by design (CLAUDE.md #3),
    // and a world pack with no credits.json 404s on that one optional file the
    // same way (DESIGN.md §2/§4: graceful fallback, no file = no credits).
    // The message text has no URL in it, so the location is what identifies it.
    const url = msg.location()?.url ?? '';
    const expected = (s) => /\/worlds\/[^/]+\/assets\//.test(s) || /\/worlds\/[^/]+\/credits\.json/.test(s);
    if (expected(url) || expected(text)) return;
    consoleLines.push(`${tag} ${type}: ${text}${url ? `  (${url})` : ''}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`${tag} pageerror: ${err.message}\n${err.stack ?? ''}`));
  page.on('requestfailed', (req) => {
    if (/\/worlds\/.*\/assets\//.test(req.url()) || /\/worlds\/[^/]+\/credits\.json/.test(req.url())) return;
    // A mailto: with nowhere to go always aborts here, which is precisely the
    // desktop case the studio's send panel exists for — headless Chromium has
    // no mail app any more than a work laptop does. Not a fault.
    if (req.url().startsWith('mailto:')) return;
    consoleLines.push(`${tag} requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
  });
}

// --- CDP touch ---------------------------------------------------------------

async function touchAt(cdp, type, x, y) {
  await within(
    20000,
    `a ${type} at ${Math.round(x)},${Math.round(y)}`,
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
    })
  );
}

async function centerOf(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function tapPoint(cdp, p) {
  await touchAt(cdp, 'touchStart', p.x, p.y);
  await touchAt(cdp, 'touchEnd', p.x, p.y);
}

async function tapEl(cdp, page, selector) {
  await tapPoint(cdp, await centerOf(page, selector));
}

// --- dev server --------------------------------------------------------------

async function ensureServer() {
  const up = async () => {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  };
  if (await up()) return null;
  log('  starting vite …');
  // Vite's own entry point rather than `npx vite`: npx is a wrapper, and
  // killing a wrapper leaves the server it started holding port 5173, which
  // the next run then quietly reuses.
  const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  const child = existsSync(vite)
    ? spawn(process.execPath, [vite, '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: false })
    : spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await up()) return child;
  }
  child.kill();
  throw new Error('vite did not come up on 5173');
}

// --- the watchdog ------------------------------------------------------------

/**
 * A whole run is ~2 minutes and has never been near 8, so a run that is still
 * going at 8 minutes is stuck, not slow. Rather than sit there until CI gives
 * up an hour later with nothing to read, say where it got to and stop. The
 * limit is a minute-count in PLAYTEST_WATCHDOG_MIN for anyone on a very slow
 * machine.
 */
const WATCHDOG_MS = Number(process.env.PLAYTEST_WATCHDOG_MIN ?? 8) * 60_000;
let watchdog = null;
let runningBrowser = null;
let runningServer = null;

function startWatchdog() {
  watchdog = setTimeout(() => {
    logErr(`\nFAILED: still running after ${WATCHDOG_MS / 60000} minutes, which means something is stuck.`);
    logErr(`  the last thing it managed was: ${lastSaid}`);
    logErr(`  screenshots + log: ${OUT}`);
    // Take the browser and the server down by hand: process.exit() would
    // otherwise leave a headless Chromium and a vite behind.
    try {
      runningBrowser?.process()?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      runningServer?.kill();
    } catch {
      /* already gone */
    }
    process.exit(1);
  }, WATCHDOG_MS);
}

// --- the playtest ------------------------------------------------------------

async function main() {
  startWatchdog();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG, `mainstreet playtest — ${new Date().toISOString()}\n  world: ${WORLD_ID}  episode: ${EPISODE.id} \u201c${EPISODE.title}\u201d\n  url: ${GAME_URL}\n\n`);
  const server = await ensureServer();
  runningServer = server;

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  runningBrowser = browser;

  try {
    // PLAYTEST_VIEWPORT=1024x768 checks the desktop layout; default is a
    // tablet-ish column that exercises the stage cap.
    const [vw, vh] = (process.env.PLAYTEST_VIEWPORT ?? '620x900').split('x').map(Number);
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    attach(page, 'desktop');

    // --- the title screen ---------------------------------------------------
    // With no parameters at all the game opens on the title screen (DESIGN.md
    // §2): the world's name, the episodes it ships, and the world's "write to
    // us" link. This section plays the shipped episode through it — start it,
    // set a flag, reload, carry on where it left off — which is the save doing
    // its job (engine/save.ts). Run at phone size, because that is where a
    // list of things to tap has the least room (CLAUDE.md #4).
    {
      log('  the title screen (no ?episode=)');
      const shippedId = WORLD.episodes[0];
      const shipped = readJson(resolve(PACK, 'episodes', `${shippedId}.json`));
      const words = COPY.ui?.title ?? {};
      const SAVE_KEY = `mainstreet.${WORLD_ID}`; // engine/save.ts's key, mirrored deliberately

      const titleCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: false,
        deviceScaleFactor: 1
      });
      const tip = await titleCtx.newPage();
      attach(tip, 'title');
      const tcdp = await titleCtx.newCDPSession(tip);

      const listNow = async (what) => {
        try {
          await tip.waitForFunction(() => window.__mainstreetTitle, null, { timeout: 20000 });
        } catch {
          await shot(tip, 'no-title');
          fail('title', `the title screen never appeared ${what}`);
        }
        return titleSnap(tip);
      };
      const rowFor = (list, id) => list.items.find((item) => item.id === id);
      const tapRow = (row) => tapPoint(tcdp, { x: row.rect.x + row.rect.w / 2, y: row.rect.y + row.rect.h / 2 });

      try {
        await tip.goto(BASE, { waitUntil: 'load' });
        let list = await listNow('on a first visit');

        if (!list.world.includes(WORLD.title.toUpperCase())) {
          fail('title', `the title screen reads "${list.world}", expected the world's name "${WORLD.title}"`);
        }
        let row = rowFor(list, shippedId);
        if (!row) fail('title', `the shipped episode "${shippedId}" is not on the list: ${JSON.stringify(list.items)}`);
        if (!row.label.includes(shipped.title)) {
          fail('title', `the list reads "${row.label}", expected the shipped episode's title "${shipped.title}"`);
        }
        if (words.play && row.action !== words.play) {
          fail('title', `a fresh episode offers "${row.action}", expected "${words.play}"`);
        }
        if (!row.selected) fail('title', 'the cursor is not on the first unfinished episode');
        log(`    "${list.world}" — "${row.label}" [${row.action}]`);

        // Every row on the list is one consistent component (Tom's phone
        // complaint — Ep. 1, Credits, Write to us and Forget everything all
        // looked different): the same width and height, and at least the
        // 44px touch target (CLAUDE.md #4), the "write to us" row included
        // even though its box comes from a real DOM anchor rather than
        // something the canvas drew.
        {
          const w0 = list.items[0].rect.w;
          const h0 = list.items[0].rect.h;
          for (const item of list.items) {
            if (Math.abs(item.rect.w - w0) > 1) {
              fail('title', `the "${item.kind}" row is ${item.rect.w}px wide, expected ${w0}px like the rest`);
            }
            if (Math.abs(item.rect.h - h0) > 1) {
              fail('title', `the "${item.kind}" row is ${item.rect.h}px tall, expected ${h0}px like the rest`);
            }
            if (item.rect.h < 44) {
              fail('title', `the "${item.kind}" row is only ${item.rect.h}px tall, short of the 44px touch target`);
            }
          }
          log(`    every row is the same shape: ${w0}x${h0}`);
        }

        // The world's "write to us" — a real DOM link (DESIGN.md §2), sitting
        // after Credits and before "Forget everything" (the true last item,
        // when the world offers it) rather than always at the very foot.
        const writeLabel = words.write ?? COPY.ui?.suggest?.link;
        if (WORLD.feedback && writeLabel) {
          const writeIndex = list.items.findIndex((item) => item.kind === 'write');
          const after = list.items[writeIndex + 1];
          if (writeIndex < 0 || (after && after.kind !== 'forget')) {
            fail('title', `the "write to us" row is not where it belongs: ${JSON.stringify(list.items.map((i) => i.kind))}`);
          }
          const write = tip.locator('#say-link');
          if (!(await write.isVisible())) fail('title', 'no "write to us" link on the title screen');
          if ((await write.innerText()).trim() !== writeLabel) {
            fail('title', `the link reads "${(await write.innerText()).trim()}", expected "${writeLabel}"`);
          }
          const href = (await write.getAttribute('href')) ?? '';
          if (!href.startsWith('mailto:') && !href.startsWith('http')) {
            fail('title', `the "write to us" link href is "${href}"`);
          }
          const box = await write.boundingBox();
          if (!box || box.width < 44 || box.height < 24) {
            fail('title', `the "write to us" link is not a tappable size: ${JSON.stringify(box)}`);
          }
          // Styled to be the row it sits on (engine/scenes/title.ts,
          // style.css `#say-link.row-link`), not a button floating inside it.
          const writeRow = list.items.find((item) => item.kind === 'write');
          if (writeRow && box && (Math.abs(box.width - writeRow.rect.w) > 1 || Math.abs(box.height - writeRow.rect.h) > 1)) {
            fail(
              'title',
              `the "write to us" link is ${box.width}x${box.height}, expected the row's own ${writeRow.rect.w}x${writeRow.rect.h}`
            );
          }
          log(`    "${writeLabel}" -> ${href.slice(0, 40)}…`);
        }

        // The cursor moves on the d-pad and on the arrow keys, one step per
        // press on either (CLAUDE.md #4).
        if (list.items.length > 1) {
          await tapEl(tcdp, tip, '[data-dpad=down]');
          await sleep(200);
          let moved = await titleSnap(tip);
          if (!moved.items[1].selected) fail('title', '▼ on the d-pad did not move the cursor down a row');
          await tip.keyboard.press('ArrowUp');
          await sleep(200);
          moved = await titleSnap(tip);
          if (!moved.items[0].selected) fail('title', 'the up arrow did not move the cursor back');
          log('    the cursor moves on the d-pad and on the arrow keys');
        }
        await shot(tip, 'title');

        // Tapping an entry starts it, and the HUD says which episode is on.
        await tapRow(rowFor(await titleSnap(tip), shippedId));
        await waitUntil(tip, (s) => s.map === WORLD.start.map, 'the shipped episode to start from the title', 20000);
        const hudEpisode = (await tip.locator('[data-hud="episode"]').innerText()).trim();
        if (!hudEpisode.includes(shipped.title)) {
          fail('title-play', `the HUD reads "${hudEpisode}" after tapping "${shipped.title}"`);
        }
        log(`    tapped it: HUD "${hudEpisode}"`);
        for (let i = 0; i < 6 && (await snap(tip)).dialogueOpen; i++) await pressA(tip);

        // Somebody with something to say who sets a flag by saying it: the
        // shipped episode's opening conversation, found in its data rather
        // than written down here.
        const talker = shipped.npcs.find(
          (n) =>
            n.map === WORLD.start.map &&
            n.dialogue.some((d) => (d.requires ?? []).length === 0 && (d.effects ?? []).some((e) => e.set))
        );
        if (!talker) fail('title-play', `no opening conversation on "${WORLD.start.map}" in ${shippedId} sets a flag`);
        const opener = talker.dialogue.find((d) => (d.requires ?? []).length === 0 && (d.effects ?? []).some((e) => e.set));
        const flag = opener.effects.find((e) => e.set).set;

        await walkTo(tip, 'title-play', [talker.pos[0], talker.pos[1] + 1], { episode: shipped });
        await pressA(tip);
        await expectDialogue(tip, 'title-play', talker.name);
        await advanceDialogue(tip, 'title-play', opener.lines.length);
        expectFlag(await snap(tip), 'title-play', flag);

        const saved = JSON.parse((await tip.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
        const entry = saved?.episodes?.[shippedId];
        if (!entry) fail('title-save', `nothing was saved under "${SAVE_KEY}": ${JSON.stringify(saved)}`);
        if (!entry.flags.includes(flag)) {
          fail('title-save', `the save does not remember "${flag}": ${JSON.stringify(entry)}`);
        }
        log(`    saved: ${JSON.stringify(entry)}`);

        // Come back later: the same list, offering to carry on.
        await tip.reload({ waitUntil: 'load' });
        list = await listNow('after a reload');
        row = rowFor(list, shippedId);
        if (words.continue && row.action !== words.continue) {
          fail('title-continue', `an episode with a save offers "${row.action}", expected "${words.continue}"`);
        }
        await shot(tip, 'title-continue');
        log(`    after a reload: "${row.label}" [${row.action}]`);

        await tapRow(row);
        const back = await waitUntil(tip, (s) => s.map === entry.map && !s.locked, 'the episode to carry on', 20000);
        if (here(back)[0] !== entry.pos[0] || here(back)[1] !== entry.pos[1]) {
          fail('title-continue', `carried on at ${here(back)}, expected the saved tile ${entry.pos}`);
        }
        expectFlag(back, 'title-continue', flag);
        if (back.dialogueOpen) fail('title-continue', 'carrying on replayed the opening card');
        log(`    carried on at ${here(back)} on "${back.map}", with "${flag}" remembered`);

        // And the conversation has moved on with it: the line for somebody who
        // has already been asked, not the one for a stranger.
        const followUp = talker.dialogue.find((d) => (d.requires ?? []).every((r) => back.flags[r]));
        // The dialogue overlay swallows an A press for a beat after it closes
        // — and it counts itself as having just closed the moment it opens the
        // scene — so this waits that beat out, as a thumb would anyway.
        await sleep(320);
        await pressA(tip);
        const said = await expectDialogue(tip, 'title-continue', `${talker.name}, remembering`);
        if (said.dialogue?.text !== followUp.lines[0]) {
          fail('title-continue', `${talker.name} said "${said.dialogue?.text}", expected "${followUp.lines[0]}"`);
        }
        log(`    ${talker.name}: "${followUp.lines[0].slice(0, 46)}…"`);
        await advanceDialogue(tip, 'title-continue', followUp.lines.length);
        await shot(tip, 'title-continued');

        // "Start over" (issue #65): offered beside "Continue" once an episode
        // has progress — a true reset, unlike "play again" below, which
        // forgets nothing about the episode having been played. The follow-up
        // conversation above left the browser mid-episode, on the Map scene,
        // so this starts by going back to the title screen the way a player
        // actually would.
        await tip.reload({ waitUntil: 'load' });
        list = await listNow('back on the title screen, for "Start over"');
        row = rowFor(list, shippedId);
        if (!row.secondary) fail('title-reset', 'an episode with progress offers no secondary action');
        if (words.reset && row.secondary !== words.reset) {
          fail('title-reset', `the secondary action reads "${row.secondary}", expected "${words.reset}"`);
        }
        if (!row.secondaryRect) fail('title-reset', 'the secondary action has no tap target');
        log(`    "${row.action}" and "${row.secondary}" both offered on an episode with progress`);

        // Spaced out past the 220ms action debounce, like pressA() — a tap
        // right on the heels of another one would otherwise be swallowed.
        const tapZone = async (r) => {
          await tapPoint(tcdp, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
          await sleep(320);
        };

        await tapZone(row.secondaryRect);
        list = await listNow('after tapping "Start over"');
        row = rowFor(list, shippedId);
        if (!row.confirming) fail('title-reset', 'tapping "Start over" did not open its confirmation');
        if (words.resetAsk && row.confirmAsk !== words.resetAsk) {
          fail('title-reset', `the confirmation asks "${row.confirmAsk}", expected "${words.resetAsk}"`);
        }
        if (!row.yesRect || !row.keepRect) fail('title-reset', 'the confirmation has no Yes/Keep targets');
        await shot(tip, 'title-reset-confirm');

        // "Keep it" backs out without touching anything.
        await tapZone(row.keepRect);
        list = await listNow('after "Keep it"');
        row = rowFor(list, shippedId);
        if (row.confirming) fail('title-reset', '"Keep it" left the confirmation open');
        if (words.continue && row.action !== words.continue) {
          fail('title-reset', `"Keep it" changed the episode's own action to "${row.action}"`);
        }
        const kept = JSON.parse((await tip.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
        if (!kept?.episodes?.[shippedId]) fail('title-reset', '"Keep it" erased the episode’s progress');
        log('    "Keep it" backs out without losing anything');

        // Now for real.
        await tapZone(row.secondaryRect);
        list = await titleSnap(tip);
        row = rowFor(list, shippedId);
        await tapZone(row.yesRect);
        list = await titleSnap(tip);
        row = rowFor(list, shippedId);
        if (row.done) fail('title-reset', '"Start over" did not clear the done mark');
        if (row.secondary) fail('title-reset', '"Start over" left a secondary action on a fresh episode');
        if (words.play && row.action !== words.play) {
          fail('title-reset', `after "Start over" the episode offers "${row.action}", expected "${words.play}"`);
        }
        const afterReset = JSON.parse((await tip.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
        if (afterReset?.episodes?.[shippedId]) fail('title-reset', '"Start over" left progress behind in the save');
        log('    "Start over", confirmed: back to "Play", nothing left behind');

        await tapRow(row);
        const startedOver = await waitUntil(
          tip,
          (s) => s.map === WORLD.start.map,
          'the episode to start fresh after "Start over"',
          20000
        );
        expectFlag(startedOver, 'title-reset', flag, false);
        if (here(startedOver)[0] !== WORLD.start.pos[0] || here(startedOver)[1] !== WORLD.start.pos[1]) {
          fail('title-reset', `"Start over" started at ${here(startedOver)}, expected the world start ${WORLD.start.pos}`);
        }
        log(`    started fresh at ${here(startedOver)}, on "${startedOver.map}"`);

        // A finished episode wears its done mark and offers to be played
        // again. Finishing this one properly takes the whole story, so the
        // save is marked the way the engine marks it — its `completed` list —
        // and the title is asked what it makes of that.
        await tip.evaluate(
          ({ key, id }) => {
            const save = JSON.parse(localStorage.getItem(key));
            save.completed.push(id);
            localStorage.setItem(key, JSON.stringify(save));
          },
          { key: SAVE_KEY, id: shippedId }
        );
        await tip.reload({ waitUntil: 'load' });
        list = await listNow('with a completed episode');
        row = rowFor(list, shippedId);
        if (!row.done) fail('title-done', `"${shippedId}" is in the completed list and the title screen disagrees`);
        if (words.done && row.doneMark !== words.done) {
          fail('title-done', `the done mark reads "${row.doneMark}", expected "${words.done}"`);
        }
        if (words.again && row.action !== words.again) {
          fail('title-done', `a finished episode offers "${row.action}", expected "${words.again}"`);
        }
        await shot(tip, 'title-done');
        log(`    finished: "${row.doneMark}" / "${row.action}"`);

        // Playing it again starts the story over without forgetting that it
        // has been played (DESIGN.md §2).
        await tapRow(row);
        const fresh = await waitUntil(tip, (s) => s.map === WORLD.start.map, 'the episode to start over', 20000);
        expectFlag(fresh, 'title-again', flag, false);
        if (here(fresh)[0] !== WORLD.start.pos[0] || here(fresh)[1] !== WORLD.start.pos[1]) {
          fail('title-again', `playing again started at ${here(fresh)}, expected the world start ${WORLD.start.pos}`);
        }
        const after = JSON.parse((await tip.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
        if (!after?.completed?.includes(shippedId)) {
          fail('title-again', `playing again forgot that "${shippedId}" was finished: ${JSON.stringify(after)}`);
        }
        log(`    played again from ${here(fresh)}, still on the finished list`);

        // Credits (Tom's addendum to issue #65): a Credits item between the
        // episodes and "write to us" swaps the list for a scrollable one —
        // every painted building's painter, off `credits.json`, plus the two
        // closing lines of copy. "Played again" above left the browser mid-
        // episode, so this starts by going back to the title screen.
        await tip.goto(BASE, { waitUntil: 'load' });
        list = await listNow('back on the title screen, for Credits');
        if (words.credits) {
          const creditsRow = list.items.find((item) => item.kind === 'credits');
          if (!creditsRow) fail('title-credits', 'no Credits item on the list');
          if (list.items[list.items.length - 1].kind === 'credits') {
            fail('title-credits', 'Credits is the last item on the list; it belongs before "write to us"/"forget everything"');
          }
          await tapRow(creditsRow);
          await sleep(320); // past the action debounce
          list = await listNow('with Credits open');
          if (!list.credits) fail('title-credits', 'opening Credits published no credits data');
          if (words.credits && list.credits.heading !== words.credits) {
            fail('title-credits', `the Credits heading reads "${list.credits.heading}", expected "${words.credits}"`);
          }
          const mbc = list.credits.buildings.find((b) => b.label === 'Middle Brook Cafe');
          if (!mbc) fail('title-credits', `no line for Middle Brook Cafe: ${JSON.stringify(list.credits.buildings)}`);
          else if (mbc.credit !== 'Tom and Lana') {
            fail('title-credits', `Middle Brook Cafe's line reads "${mbc.credit}", expected "Tom and Lana"`);
          }
          const hh = list.credits.buildings.find((b) => b.label === 'Heartbreak Hotel');
          if (!hh) fail('title-credits', `no line for Heartbreak Hotel: ${JSON.stringify(list.credits.buildings)}`);
          else if (hh.credit !== 'Tom') fail('title-credits', `Heartbreak Hotel's line reads "${hh.credit}", expected "Tom"`);
          log(`    Credits: "${mbc?.label} — ${mbc?.credit}", "${hh?.label} — ${hh?.credit}"`);
          if (words.palette && list.credits.palette !== words.palette) {
            fail('title-credits', `the palette line reads "${list.credits.palette}", expected "${words.palette}"`);
          }
          if (words.licence && list.credits.licence !== words.licence) {
            fail('title-credits', `the licence line reads "${list.credits.licence}", expected "${words.licence}"`);
          }

          // The Credits screen's own closing rows (issue #65 addendum): About
          // this game, Paint a building and Open source on GitHub, each a
          // real DOM link, and a "Back" row last (Tom's walkthrough: "no
          // obvious way back").
          if (words.about) {
            const about = list.credits.links.find((l) => l.label === words.about);
            if (!about) fail('title-credits', `no "${words.about}" row on Credits: ${JSON.stringify(list.credits.links)}`);
            if (!about.href.startsWith('http')) fail('title-credits', `"${words.about}" href is "${about.href}"`);
            log(`    "${about.label}" -> ${about.href}`);
          }
          if (words.paint) {
            const paint = list.credits.links.find((l) => l.label === words.paint);
            if (!paint) fail('title-credits', `no "${words.paint}" row on Credits: ${JSON.stringify(list.credits.links)}`);
            if (WORLD.contribute && paint.href !== WORLD.contribute) {
              fail('title-credits', `"${words.paint}" href is "${paint.href}", expected world.contribute "${WORLD.contribute}"`);
            }
            log(`    "${paint.label}" -> ${paint.href}`);
          }
          if (words.source) {
            const source = list.credits.links.find((l) => l.label === words.source);
            if (!source) fail('title-credits', `no "${words.source}" row on Credits: ${JSON.stringify(list.credits.links)}`);
            if (!source.href.includes('github.com')) {
              fail('title-credits', `"${words.source}" href is "${source.href}", expected a GitHub URL`);
            }
            log(`    "${source.label}" -> ${source.href}`);
          }
          if (words.back) {
            if (!list.credits.back) fail('title-credits', 'no "Back" row on Credits');
            else if (list.credits.back.label !== words.back) {
              fail('title-credits', `the Back row reads "${list.credits.back.label}", expected "${words.back}"`);
            }
            log(`    "${list.credits.back?.label}" row is on screen`);
          }
          await shot(tip, 'title-credits');

          // A closes Credits from anywhere (there is nothing else for it to
          // do there) — the same thing tapping the visible "Back" row does,
          // so this is that row's own keyboard/A path.
          if (words.back) {
            await pressA(tip);
            list = await listNow('after pressing A on "Back"');
            if (list.credits) fail('title-credits', 'pressing A did not close Credits from "Back"');
            log('    A on "Back" returns to the episode list');

            // "Write to us" takes the shared anchor back once Credits closes.
            if (WORLD.feedback && writeLabel) {
              const restored = tip.locator('#say-link');
              if (!(await restored.isVisible())) fail('title-credits', '"write to us" was not restored after Credits closed');
              const restoredHref = (await restored.getAttribute('href')) ?? '';
              if (!restoredHref.startsWith('mailto:') && !restoredHref.startsWith('http')) {
                fail('title-credits', `"write to us" href is "${restoredHref}" after Credits closed`);
              }
              if ((await restored.innerText()).trim() !== writeLabel) {
                fail(
                  'title-credits',
                  `"write to us" reads "${(await restored.innerText()).trim()}" after Credits closed, expected "${writeLabel}"`
                );
              }
              log('    "write to us" is restored after Credits closes');
            }

            // Back into Credits, so the tap-anywhere-closes check below still
            // has something open to close.
            list = await titleSnap(tip);
            await tapRow(list.items.find((item) => item.kind === 'credits'));
            await sleep(320);
            list = await listNow('with Credits open again, for the tap-anywhere check');
          }

          await tapPoint(tcdp, {
            x: list.credits.backRect.x + list.credits.backRect.w / 2,
            y: list.credits.backRect.y + list.credits.backRect.h / 2
          });
          await sleep(320); // past the action debounce
          list = await listNow('back from Credits');
          if (list.credits) fail('title-credits', 'tapping Credits did not close it');
          log('    a tap goes back to the episode list');
        }

        // "Forget everything" (Tom's addendum to issue #65), tested once: the
        // same one-step confirmation as "Start over", but for the whole save.
        if (words.forget) {
          const forgetRow = list.items.find((item) => item.kind === 'forget');
          if (!forgetRow) fail('title-forget', 'no "Forget everything" item on the list');
          if (list.items[list.items.length - 1].kind !== 'forget') {
            fail('title-forget', `"Forget everything" is not the last item on the list: ${JSON.stringify(list.items.map((i) => i.kind))}`);
          }
          await tapRow(forgetRow);
          await sleep(320); // past the action debounce
          list = await listNow('after tapping "Forget everything"');
          let fr = list.items.find((item) => item.kind === 'forget');
          if (!fr.confirming) fail('title-forget', 'tapping "Forget everything" did not open its confirmation');
          if (words.forgetAsk && fr.confirmAsk !== words.forgetAsk) {
            fail('title-forget', `the confirmation asks "${fr.confirmAsk}", expected "${words.forgetAsk}"`);
          }
          await shot(tip, 'title-forget-confirm');

          await tapZone(fr.yesRect);
          list = await titleSnap(tip);
          const afterForget = JSON.parse((await tip.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
          if (afterForget !== null) fail('title-forget', `"Forget everything" left a save behind: ${JSON.stringify(afterForget)}`);
          const shippedAfterForget = rowFor(list, shippedId);
          if (shippedAfterForget.done) fail('title-forget', 'a finished episode is still done after "Forget everything"');
          if (words.play && shippedAfterForget.action !== words.play) {
            fail(
              'title-forget',
              `after "Forget everything" the episode offers "${shippedAfterForget.action}", expected "${words.play}"`
            );
          }
          log('    "Forget everything", confirmed: the whole save is gone');
        }
      } finally {
        await titleCtx.close();
      }

      // The same screen at the run's desktop viewport, for the record.
      const deskTitleCtx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      const deskTitle = await deskTitleCtx.newPage();
      attach(deskTitle, 'title-desktop');
      try {
        await deskTitle.goto(BASE, { waitUntil: 'load' });
        await deskTitle.waitForFunction(() => window.__mainstreetTitle, null, { timeout: 20000 });
        await shot(deskTitle, 'title-desktop');
      } finally {
        await deskTitleCtx.close();
      }
    }

    // --- boot ---------------------------------------------------------------
    log(`  boot (?episode=${PLAYTEST_EPISODE})`);
    await page.goto(GAME_URL, { waitUntil: 'load' });
    if (await page.locator('#fatal').count()) {
      const text = await page.locator('#fatal').innerText();
      await shot(page, 'fatal');
      fail('boot', `#fatal panel is on screen:\n${text}`);
    }
    if (!(await page.locator('#stage canvas').count())) fail('boot', 'no canvas inside #stage');
    // The HUD is filled in once the world pack, its maps and its tilesets have
    // all been fetched and validated, so this is a wait rather than a sample.
    try {
      await page.waitForFunction(
        () => (document.querySelector('[data-hud="title"]')?.textContent ?? '').trim().length > 0,
        null,
        { timeout: 20000 }
      );
    } catch {
      await shot(page, 'no-hud');
      fail('boot', 'HUD title was never filled in from the world pack');
    }
    const hud = (await page.locator('[data-hud="title"]').innerText()).trim();
    if (!hud || hud === ' ') fail('boot', 'HUD title was never filled in from the world pack');
    log(`    HUD: "${hud}" / "${(await page.locator('[data-hud="episode"]').innerText()).trim()}"`);

    await waitUntil(page, (s) => s.map === WORLD.start.map, 'the start map to be running');
    const booted = await waitUntil(page, (s) => s.dialogueOpen, 'the intro dialogue to open');
    await shot(page, 'boot-intro');
    if (booted.map !== WORLD.start.map) fail('boot', `started on "${booted.map}"`);
    // The opening card is the world's own intro (copy.json, episode-neutral)
    // followed by this episode's own `intro` (DESIGN.md §3) — one card, the
    // world's scene-setting first and then this week's opening line(s).
    const introLines = [...(COPY.intro?.lines ?? []), ...(EPISODE.intro ?? [])];
    const introPages = await readDialogue(page, 'boot', introLines.length, async (i) => {
      const on = (await snap(page)).dialogue;
      if (on?.text !== introLines[i]) {
        fail('boot', `intro page ${i + 1} reads "${on?.text}", expected "${introLines[i]}"`);
      }
    });
    if (introPages !== introLines.length) {
      fail('boot', `intro read ${introPages} page(s) for ${introLines.length} line(s) (world intro + "${PLAYTEST_EPISODE}".intro)`);
    }
    log(`    intro: ${introPages} page(s), ending on "${introLines[introLines.length - 1]}"`);
    await shot(page, 'boot-dismissed');

    // --- Earl ---------------------------------------------------------------
    log('  talk to Earl');
    const earl = EPISODE.npcs.find((n) => n.id === 'earl');
    await walkTo(page, 'earl', [earl.pos[0], earl.pos[1] + 1]);
    await pressA(page);
    await expectDialogue(page, 'earl', 'Earl');
    await shot(page, 'earl-first');
    await advanceDialogue(page, 'earl', 3);
    expectFlag(await snap(page), 'earl', 'metEarl');

    // --- Stewart's ----------------------------------------------------------
    log("  enter Stewart's");
    const stewarts = WORLD.maps.stamford.buildings.find((b) => b.id === 'stewarts');
    await walkTo(page, 'stewarts', stewarts.door);
    await pressA(page);
    await waitUntil(page, (s) => s.map === stewarts.interior && !s.locked, "Stewart's interior");
    await shot(page, 'stewarts-interior');

    log('  talk to Hannah');
    const hannah = EPISODE.npcs.find((n) => n.id === 'hannah');
    // She works behind the register counter, so the customer's tile is two
    // south of her with the counter in between; interior NPC reach is 2.3.
    await walkTo(page, 'hannah', [hannah.pos[0], hannah.pos[1] + 2]);
    await pressA(page);
    await expectDialogue(page, 'hannah', 'Hannah');
    await shot(page, 'hannah');
    await advanceDialogue(page, 'hannah', 2);

    log('  read the shelf');
    const shelf = (EPISODE.signs ?? []).find((s) => s.map === stewarts.interior && s.pos);
    if (!shelf) fail('shelf', 'ep000 has no prop sign inside the interior');
    await walkTo(page, 'shelf', [shelf.pos[0] - 1, shelf.pos[1]]);
    await pressA(page);
    await expectDialogue(page, 'shelf', 'the shelf');
    await shot(page, 'shelf-sign');
    await advanceDialogue(page, 'shelf', shelf.lines.length);

    log("  back out of Stewart's");
    const mat = WORLD.maps[stewarts.interior].exits[0];
    await walkTo(page, 'stewarts-exit', [mat.at[0], mat.at[1]], { allowInterrupt: true });
    await waitUntil(page, (s) => s.map === 'stamford' && !s.locked, 'Main Street again');
    await shot(page, 'back-on-main');

    // --- the rooms behind the other doors ------------------------------------
    // Stewart's was hand-drawn; the rest of route10's interiors come out of
    // `npm run make-room` (DESIGN.md §2). They are ordinary maps, so each one
    // is asked the same three things: does its door let you in where the
    // placement says, is its furniture something you walk round rather than
    // through, and does the way out put you back on the doorstep facing the
    // street. Entered with a tap on the door, which is how the game is meant
    // to be played (CLAUDE.md hard rule 4).
    for (const place of WORLD.maps.stamford.buildings.filter((b) => b.interior && b.enter && b.id !== stewarts.id)) {
      const name = WORLD.buildings[place.id].name;
      const room = WORLD.maps[place.interior];
      const doorstep = [[0, 2], [0, 3], [-2, 0], [2, 0], [0, 1]]
        .map(([dx, dy]) => [place.door[0] + dx, place.door[1] + dy])
        .find(
          (tile) =>
            !isSolid(WORLD.maps.stamford, tile[0], tile[1]) &&
            !WORLD.maps.stamford.buildings.some((b) => {
              const plaque = plaqueOf(b);
              return (
                (b.door[0] === tile[0] && b.door[1] === tile[1]) ||
                (plaque && plaque[0] === tile[0] && plaque[1] === tile[1])
              );
            })
        );
      if (!doorstep) fail(`${place.id}-enter`, `nowhere to stand outside ${name} to tap its door from`);

      log(`  into ${name}, on a tap`);
      await walkTo(page, `${place.id}-enter`, doorstep);
      await clickTile(page, place.door, `${place.id}-enter`);
      const inside = await waitUntil(page, (s) => s.map === place.interior && !s.locked, `${name}'s room`);
      const landed = here(inside);
      if (landed[0] !== place.enter[0] || landed[1] !== place.enter[1]) {
        fail(`${place.id}-enter`, `${name} put the player down on ${landed}, not its "enter" tile ${place.enter}`);
      }
      await shot(page, `${place.id}-interior`);
      log(`    tapped ${place.door} from ${doorstep} -> in at ${landed}, ${room.width}x${room.height} tiles`);

      // Anybody posted behind the counter (DESIGN.md §2): a world person with
      // their own `lines`, standing in a staff strip the player can never walk
      // into, talked to across the counter at an interior's talking reach
      // (2.3 tiles). The approach tile is two tiles the way they are facing,
      // the same offset Hannah is talked to across Stewart's counter with.
      const APPROACH_STEP = { down: [0, 2], up: [0, -2], left: [-2, 0], right: [2, 0] };
      for (const person of room.people ?? []) {
        const who = `${place.id}-${person.id}`;
        const [dx, dy] = APPROACH_STEP[person.facing ?? 'down'];
        log(`  talk to ${person.name ?? person.id} behind the counter in ${name}`);
        await walkTo(page, who, [person.pos[0] + dx, person.pos[1] + dy]);
        await pressA(page);
        await expectDialogue(page, who, person.name ?? person.id);
        await shot(page, who);
        const said = await snap(page);
        const expectedSpeaker = person.name || COPY.ui.passerbyName || '';
        if (said.dialogue?.speaker !== expectedSpeaker) {
          fail(who, `speaker was "${said.dialogue?.speaker}", expected "${expectedSpeaker}"`);
        }
        if (said.dialogue?.text !== person.lines[0]) {
          fail(who, `first line was "${said.dialogue?.text}", expected "${person.lines[0]}"`);
        }
        await advanceDialogue(page, who, person.lines.length);
        log(`    ${expectedSpeaker || '(no name)'}: "${person.lines[0]}"`);
      }

      // The furniture. The room's spec — worlds/<world>/rooms/<map>.json, the
      // very thing `make-room` was handed — says what was put where, so the
      // harness can insist a counter, a bar or a stage really does block its
      // tiles, and that a mat really does not.
      const specFile = resolve(PACK, 'rooms', `${place.interior}.json`);
      if (!existsSync(specFile)) fail(`${place.id}-solid`, `no room spec at ${specFile} to check the furniture against`);
      const blocking = [];
      for (const prop of readJson(specFile).props ?? []) {
        const cells = [...(prop.at ?? [])];
        if (prop.rect) {
          const [rx, ry, rw, rh] = prop.rect;
          for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) cells.push([rx + i, ry + j]);
        }
        for (const [x, y] of cells) {
          const blocks = isSolid(room, x, y);
          if (prop.kind === 'mat' && blocks) {
            fail(`${place.id}-solid`, `the mat at ${x},${y} in ${name} blocks the floor`);
          }
          if (prop.kind !== 'mat' && !blocks) {
            fail(`${place.id}-solid`, `the ${prop.kind} at ${x},${y} in ${name} is not solid — you would walk through it`);
          }
          if (prop.kind === 'counter' || prop.kind === 'bar' || prop.kind === 'stage') blocking.push([prop.kind, x, y]);
        }
      }
      if (!blocking.length) fail(`${place.id}-solid`, `${name}'s room has no counter, bar or stage in it`);
      log(`    ${blocking.length} tile(s) of counter/bar/stage, every one solid in the grid`);

      // And solid underfoot, not only in the grid: walked straight at from two
      // tiles below, the player has to stop at its near edge. The hitbox is
      // inset 4px, so a quarter tile of overlap is as far in as anything solid
      // ever lets them get.
      const push = blocking.find(([, x, y]) => !isSolid(room, x, y + 1) && !isSolid(room, x, y + 2));
      if (!push) fail(`${place.id}-solid`, `nothing in ${name} can be walked into from below`);
      await walkTo(page, `${place.id}-solid`, [push[1], push[2] + 2]);
      await page.keyboard.down(KEY.up);
      await sleep(700);
      await page.keyboard.up(KEY.up);
      await sleep(200);
      const stopped = await snap(page);
      if (stopped.y < push[2] + 0.6) {
        fail(`${place.id}-solid`, `the player walked into the ${push[0]} at ${push[1]},${push[2]}: stopped at y ${stopped.y.toFixed(2)}`);
      }
      log(`    walking at the ${push[0]} on ${[push[1], push[2]]} stopped at y ${stopped.y.toFixed(2)}`);

      log(`  back out of ${name}`);
      const way = room.exits[0];
      if (!way) fail(`${place.id}-exit`, `${place.interior} has no way out`);
      await walkTo(page, `${place.id}-exit`, [way.at[0], way.at[1]], { allowInterrupt: true });
      const out = await waitUntil(page, (s) => s.map === way.to && !s.locked, `${WORLD.maps[way.to].name} again`);
      const back = here(out);
      if (back[0] !== place.door[0] || back[1] !== place.door[1]) {
        fail(`${place.id}-exit`, `leaving ${name} put the player on ${back}, not its door ${place.door}`);
      }
      if (out.facing !== way.facing) {
        fail(`${place.id}-exit`, `leaving ${name} left the player facing "${out.facing}", not "${way.facing}"`);
      }
      log(`    out at ${back}, facing ${out.facing}`);
    }

    // --- Jefferson ----------------------------------------------------------
    log('  travel to Jefferson');
    const toJefferson = WORLD.maps.stamford.exits.find((e) => e.to === 'jefferson');
    await walkTo(page, 'to-jefferson', [toJefferson.at[0], toJefferson.at[1]], { allowInterrupt: true });
    await waitUntil(page, (s) => s.locked, 'the travel card');
    await sleep(420);
    await shot(page, 'travel-card');
    await waitUntil(page, (s) => s.map === 'jefferson' && !s.locked, 'Jefferson');
    await shot(page, 'jefferson');

    log('  find the pen');
    const pen = EPISODE.items[0];
    await walkTo(page, 'pen', [pen.pos[0] - 1, pen.pos[1]]);
    await pressA(page);
    await expectDialogue(page, 'pen', 'the pen');
    await shot(page, 'pen');
    await advanceDialogue(page, 'pen', pen.lines.length);
    expectFlag(await snap(page), 'pen', 'hasPen');
    await shot(page, 'pen-toast');

    // --- the suggestion box --------------------------------------------------
    // The engine's own street fixture: a solid little post box standing on a
    // tile of its own, read from beside it, with a "write to us" link riding
    // alongside every page of the dialogue exactly as "Paint it" does
    // (DESIGN.md §2). No backend and no account anywhere in it — the link is a
    // mailto the player's own mail app opens.
    const box = (WORLD.maps.jefferson.fixtures ?? []).find((f) => f.kind === 'suggestion-box');
    if (box) {
      log('  the suggestion box');
      const suggest = COPY.ui?.suggest;
      if (!suggest?.lines?.length) fail('suggestion-box', 'copy.json has no ui.suggest.lines for the box to say');
      // Read from alongside rather than from below: the box is a low thing on
      // its own tile, and a player standing south of it stands in front of it.
      const jefferson = WORLD.maps.jefferson;
      const taken = jefferson.buildings.flatMap((b) => [b.door, plaqueOf(b)].filter(Boolean));
      const beside = [[-1, 0], [1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [box.pos[0] + dx, box.pos[1] + dy])
        .find(
          (tile) =>
            !isSolid(jefferson, tile[0], tile[1]) && !taken.some((t) => t[0] === tile[0] && t[1] === tile[1])
        );
      if (!beside) fail('suggestion-box', `there is nowhere to stand beside the box at ${box.pos}`);
      await walkTo(page, 'suggestion-box', beside);
      await pressA(page);
      await expectDialogue(page, 'suggestion-box', 'the suggestion box');

      const write = page.locator('#say-link');
      if (!(await write.isVisible())) fail('suggestion-box', 'no link beside the suggestion box');
      const writeHref = (await write.getAttribute('href')) ?? '';
      // A world may point the box at a page (a form) or at the player's own
      // mail app; either way the link must be the one the world configured.
      if (WORLD.feedback?.url) {
        if (writeHref !== WORLD.feedback.url) fail('suggestion-box', `the link href is "${writeHref}", not the world's feedback url`);
      } else {
        if (!writeHref.startsWith('mailto:')) fail('suggestion-box', `the link href is "${writeHref}"`);
        const subject = WORLD.feedback?.subject;
        if (subject && !writeHref.includes(encodeURIComponent(subject))) {
          fail('suggestion-box', `the link carries no "${subject}" subject: "${writeHref}"`);
        }
      }
      const writeBox = await write.boundingBox();
      if (!writeBox || writeBox.width < 44 || writeBox.height < 24) {
        fail('suggestion-box', `the link is not a tappable size: ${JSON.stringify(writeBox)}`);
      }
      await shot(page, 'suggestion-box');

      const boxPages = await readDialogue(page, 'suggestion-box', suggest.lines.length, async (i) => {
        if (!(await write.isVisible())) fail('suggestion-box', `the link went missing on page ${i + 1}`);
      });
      if (boxPages !== suggest.lines.length) {
        fail('suggestion-box', `the box read ${boxPages} page(s) for ${suggest.lines.length} line(s) of copy`);
      }
      if (await write.isVisible()) fail('suggestion-box', 'the link outlived the dialogue');
      log(`    "${suggest.link}" -> ${writeHref.slice(0, 60)}… (held for all ${boxPages} page(s))`);

      // It blocks its tile, so it is walked around rather than through. Walking
      // straight at it from the tile below must stop the player at its near
      // edge — the hitbox is inset 4px, so a quarter tile of overlap is as far
      // in as anything solid ever lets them get.
      const below = [box.pos[0], box.pos[1] + 1];
      if (!isSolid(jefferson, below[0], below[1])) {
        await walkTo(page, 'suggestion-box-solid', below);
        await page.keyboard.down(KEY.up);
        await sleep(700);
        await page.keyboard.up(KEY.up);
        await sleep(200);
        const pushed = await snap(page);
        if (pushed.y < box.pos[1] - 0.4) {
          fail('suggestion-box', `the player walked through the box: stopped at y ${pushed.y.toFixed(2)}`);
        }
        log(`    solid: walking into it from below stopped at y ${pushed.y.toFixed(2)}`);
      }
    } else {
      log('  (this world has no suggestion box — skipping that check)');
    }

    // --- a painted building: thanks on the plaque, story on the sign ---------
    // The painter is thanked on the plaque beside the door and named on the
    // site's front page — never in the sign, where it would interrupt the copy
    // the player is reading (DESIGN.md §2/§4). The plaque also offers
    // "Improve it?" (`ui.improve`, `engine/paint.ts` improveUrl), deep-linked
    // to the Studio for a touch-up; the sign stays the episode's lines and
    // nothing else, with no link at all.
    const painted = WORLD.maps.jefferson.buildings.find(
      (b) => !b.interior && existsSync(resolve(PACK, 'assets', 'buildings', `${b.id}.png`))
    );
    if (painted) {
      const deskLink = page.locator('#say-link');

      log('  read a painted building: its plaque');
      const paintedPlaque = plaqueOf(painted);
      if (!paintedPlaque) fail('painted-plaque', `${painted.id} has no plaque to read`);
      await walkTo(page, 'painted-plaque', paintedPlaque);
      await pressA(page);
      await expectDialogue(page, 'painted-plaque', `${painted.id}'s plaque`);
      if (!(await deskLink.isVisible())) {
        fail('painted-plaque', `no "${COPY.ui.improve}" link showed on painted ${painted.id}'s plaque`);
      }
      const improveLabel = (await deskLink.innerText()).trim();
      if (improveLabel !== COPY.ui.improve) {
        fail('painted-plaque', `the plaque's link reads "${improveLabel}", expected "${COPY.ui.improve}"`);
      }
      const improveHref = (await deskLink.getAttribute('href')) ?? '';
      if (!improveHref.includes(`building=${painted.id}`) || !improveHref.includes('improve=1')) {
        fail('painted-plaque', `the plaque's link href "${improveHref}" is missing building=${painted.id} or improve=1`);
      }
      await shot(page, 'painted-plaque');
      const plaquePages = await readDialogue(page, 'painted-plaque', 1);
      if (plaquePages !== 1) fail('painted-plaque', `${painted.id}'s plaque read ${plaquePages} page(s), expected 1`);
      log(`    ${painted.id}: plaque thanks its painter and offers "${improveLabel}" -> ${improveHref}`);

      log('  read a painted building: its sign');
      const paintedWant = signLinesOf(painted.id);
      const paintedLines = paintedWant.length;
      if (paintedLines === 0) fail('painted-sign', `ep000 gives painted ${painted.id} no sign copy to read`);
      await walkTo(page, 'painted-sign', painted.door);
      await pressA(page);
      await expectDialogue(page, 'painted-sign', painted.id);
      if (await deskLink.isVisible()) fail('painted-sign', `a "Paint it" link showed on painted ${painted.id}`);
      await shot(page, 'painted-sign');
      const read = await readDialogue(page, 'painted-sign', paintedLines, async (i) => {
        const on = (await snap(page)).dialogue;
        if (on?.text !== paintedWant[i]) {
          fail(
            'painted-sign',
            `${painted.id} page ${i + 1} reads "${on?.text}", expected "${paintedWant[i]}"`
          );
        }
      });
      if (read !== paintedLines) {
        fail(
          'painted-sign',
          `${painted.id} read ${read} page(s) for ${paintedLines} sign line(s) — a credit line is still being appended`
        );
      }
      log(`    ${painted.id}: ${paintedLines} page(s), sign copy only`);
    } else {
      log('  (no painted building in Jefferson yet — skipping the painted-sign check)');
    }

    // --- back to Earl -------------------------------------------------------
    log('  return to Stamford');
    const toStamford = WORLD.maps.jefferson.exits.find((e) => e.to === 'stamford');
    await walkTo(page, 'to-stamford', [toStamford.at[0], toStamford.at[1]], { allowInterrupt: true });
    await waitUntil(page, (s) => s.map === 'stamford' && !s.locked, 'Stamford');

    log('  give Earl the pen');
    await walkTo(page, 'earl-done', [earl.pos[0], earl.pos[1] + 1]);
    await pressA(page);
    await expectDialogue(page, 'earl-done', 'Earl (pen found)');
    await shot(page, 'earl-pen');
    await advanceDialogue(page, 'earl-done', 2);
    expectFlag(await snap(page), 'earl-done', 'done');
    await shot(page, 'episode-complete-toast');

    log('  epilogue line');
    await sleep(300);
    await pressA(page);
    await expectDialogue(page, 'epilogue', 'Earl (done)');
    await shot(page, 'earl-epilogue');
    await advanceDialogue(page, 'epilogue', 1);

    // --- Hobart and back ----------------------------------------------------
    log('  Hobart round trip');
    const toHobart = WORLD.maps.stamford.exits.find((e) => e.to === 'hobart');
    await walkTo(page, 'to-hobart', [toHobart.at[0], toHobart.at[1]], { allowInterrupt: true });
    await waitUntil(page, (s) => s.map === 'hobart' && !s.locked, 'Hobart');
    await shot(page, 'hobart');
    const fromHobart = WORLD.maps.hobart.exits.find((e) => e.to === 'stamford');
    await walkTo(page, 'from-hobart', [fromHobart.at[0], fromHobart.at[1]], { allowInterrupt: true });
    await waitUntil(page, (s) => s.map === 'stamford' && !s.locked, 'Stamford again');
    await shot(page, 'stamford-west-end');

    // --- touch pass ---------------------------------------------------------
    log('  touch pass (420x760, hasTouch)');
    const touchCtx = await browser.newContext({
      viewport: { width: 420, height: 760 },
      hasTouch: true,
      isMobile: false,
      deviceScaleFactor: 1
    });
    const tp = await touchCtx.newPage();
    attach(tp, 'touch');
    const cdp = await touchCtx.newCDPSession(tp);
    await tp.goto(GAME_URL, { waitUntil: 'load' });
    await waitUntil(tp, (s) => s.dialogueOpen, 'the intro on the touch page');
    await shot(tp, 'touch-boot');

    // Tapping the game surface advances dialogue and nothing else.
    for (let i = 0; i < 4; i++) {
      const s = await snap(tp);
      if (!s.dialogueOpen) break;
      await tapEl(cdp, tp, '#stage');
      await sleep(320);
    }
    if ((await snap(tp)).dialogueOpen) fail('touch-intro', 'tapping #stage did not dismiss the intro');

    const before = await snap(tp);
    const dpad = await centerOf(tp, '[data-dpad=up]');
    await touchAt(cdp, 'touchStart', dpad.x, dpad.y);
    await sleep(700);
    const during = await snap(tp);
    await touchAt(cdp, 'touchEnd', dpad.x, dpad.y);
    await sleep(150);
    const afterHold = await snap(tp);
    if (!(during.y < before.y - 0.5)) {
      fail('touch-dpad', `holding ▲ did not move the player: y ${before.y.toFixed(2)} -> ${during.y.toFixed(2)}`);
    }
    if (Math.abs(afterHold.y - during.y) > 0.35) {
      fail('touch-dpad', `player kept moving after touchEnd: ${during.y.toFixed(2)} -> ${afterHold.y.toFixed(2)}`);
    }
    log(`    ▲ held: y ${before.y.toFixed(2)} -> ${afterHold.y.toFixed(2)}`);
    await shot(tp, 'touch-dpad');

    await tapEl(cdp, tp, '#btnA');
    await sleep(250);
    await expectDialogue(tp, 'touch-a', 'Earl, via the A button');
    await shot(tp, 'touch-dialogue');

    // Debounce. The box is showing line 0 of an N-line entry. Three taps inside
    // one 220ms window must advance exactly once, so burst + (N-2) spaced taps
    // lands on the last line with the box still open; one extra fire anywhere in
    // the burst would have run off the end and closed it.
    const opener = earl.dialogue.find((d) => !d.requires || d.requires.length === 0);
    const N = opener.lines.length;
    if (N < 3) fail('touch-debounce', `need a 3+ line opening entry to test the debounce, got ${N}`);
    // The point is resolved once, and the six touch messages are pipelined
    // rather than awaited one at a time: a CDP round trip per event is slower
    // than the debounce window we are trying to fit three taps inside. The
    // window is then measured from the pointerdowns the page actually saw.
    const btnA = await centerOf(tp, '#btnA');
    await tp.evaluate(() => {
      window.__taps = [];
      document
        .getElementById('btnA')
        .addEventListener('pointerdown', () => window.__taps.push(performance.now()), true);
    });
    const sends = [];
    for (let i = 0; i < 3; i++) {
      sends.push(touchAt(cdp, 'touchStart', btnA.x, btnA.y), touchAt(cdp, 'touchEnd', btnA.x, btnA.y));
    }
    await Promise.all(sends);
    const taps = await tp.evaluate(() => window.__taps);
    if (taps.length !== 3) fail('touch-debounce', `expected 3 pointerdowns on #btnA, saw ${taps.length}`);
    const burstMs = Math.round(taps[2] - taps[0]);
    if (burstMs >= 220) fail('touch-debounce', `burst spanned ${burstMs}ms — wider than the 220ms debounce`);
    await sleep(320);
    if (!(await snap(tp)).dialogueOpen) {
      fail('touch-debounce', `A multi-fired: 3 taps spanning ${burstMs}ms ran through all ${N} lines at once`);
    }
    for (let i = 0; i < N - 2; i++) {
      await tapPoint(cdp, btnA);
      await sleep(320);
    }
    if (!(await snap(tp)).dialogueOpen) {
      fail(
        'touch-debounce',
        `A double-fired: 3 taps spanning ${burstMs}ms plus ${N - 2} spaced taps consumed more than ${N - 1} of ${N} lines`
      );
    }
    log(`    debounce ok (3 taps spanning ${burstMs}ms advanced exactly once through a ${N}-line entry)`);
    await tapPoint(cdp, btnA);
    await sleep(320);
    const closed = await snap(tp);
    if (closed.dialogueOpen) fail('touch-debounce', 'the last line never closed');
    expectFlag(closed, 'touch-debounce', 'metEarl');
    await shot(tp, 'touch-complete');

    // --- tap to walk --------------------------------------------------------
    // The primary control scheme (CLAUDE.md #4): tap where you want to go and
    // the player walks there; tap somebody and they walk over and say hello.
    // Checked on a phone-sized page, which is where it earns its keep.
    log('  tap to walk (390x844, hasTouch)');
    const walkCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: false,
      deviceScaleFactor: 1
    });
    const wp = await walkCtx.newPage();
    attach(wp, 'tap');
    const wcdp = await walkCtx.newCDPSession(wp);
    await wp.goto(GAME_URL, { waitUntil: 'load' });
    await waitUntil(wp, (s) => s.dialogueOpen, 'the intro on the tap page');
    for (let i = 0; i < 5 && (await snap(wp)).dialogueOpen; i++) {
      await tapEl(wcdp, wp, '#stage');
      await sleep(320);
    }
    if ((await snap(wp)).dialogueOpen) fail('tap-walk', 'the intro never closed on the tap page');

    /**
     * Records the tile each tap actually landed on, from inside the page, at
     * the moment the finger comes up — a second implementation of the engine's
     * screen-to-tile sum, deliberately, like isSolid() above. It is the only
     * honest way to say "the marker went where I tapped" while the ground is
     * moving under the aim, and it reads the same camera frame the engine
     * converts against.
     */
    async function watchTaps(page) {
      await page.evaluate(() => {
        window.__tapTile = null;
        document.getElementById('stage').addEventListener(
          'pointerup',
          (event) => {
            const s = window.__mainstreet;
            const canvas = document.querySelector('#stage canvas');
            if (!s?.view || !canvas) return;
            const r = canvas.getBoundingClientRect();
            const v = s.view;
            const wx = v.x + ((event.clientX - r.left) / r.width) * v.width;
            const wy = v.y + ((event.clientY - r.top) / r.height) * v.height;
            window.__tapTile = [Math.floor(wx / v.tile), Math.floor(wy / v.tile)];
          },
          true
        );
      });
    }

    /** The press and the release go down the wire together: the view moves between them too. */
    async function tapTile(page, cdp, tile) {
      const p = await pointOfTile(page, tile);
      await Promise.all([touchAt(cdp, 'touchStart', p.x, p.y), touchAt(cdp, 'touchEnd', p.x, p.y)]);
    }

    /** Where the last tap landed, and how far the aim drifted while it travelled. */
    async function tapLanding(page, aimedAt) {
      const landed = await page.evaluate(() => window.__tapTile);
      if (!landed) fail('tap-walk', `the page saw no tap for ${aimedAt}`);
      const drift = Math.abs(landed[0] - aimedAt[0]) + Math.abs(landed[1] - aimedAt[1]);
      if (drift) log(`    (the view slid ${drift} tile(s) under the aim: ${aimedAt} -> ${landed})`);
      return landed;
    }

    await watchTaps(wp);

    // Tiles that read as something when tapped, which a plain walk must avoid.
    function readableTiles(mapId) {
      const set = new Set();
      const add = (x, y) => set.add(`${x},${y}`);
      for (const n of EPISODE.npcs.filter((n) => n.map === mapId)) {
        add(n.pos[0], n.pos[1]);
        add(n.pos[0], n.pos[1] - 1);
      }
      // And whoever is walking past right now: people are drawn two tiles
      // tall, so the tile above somebody reads as them too.
      if (live.map === mapId) {
        for (const p of live.people) {
          for (const t of p.tiles ?? []) {
            add(t[0], t[1]);
            add(t[0], t[1] - 1);
          }
        }
      }
      for (const i of (EPISODE.items ?? []).filter((i) => i.map === mapId)) add(i.pos[0], i.pos[1]);
      for (const s of (EPISODE.signs ?? []).filter((s) => s.map === mapId && s.pos)) add(s.pos[0], s.pos[1]);
      for (const b of WORLD.maps[mapId].buildings) {
        add(b.door[0], b.door[1]);
        add(b.door[0], b.door[1] - 1);
        const p = plaqueOf(b);
        if (p) add(p[0], p[1]);
      }
      return set;
    }

    /**
     * A plain tile to tap: on screen, nothing to read on it, and a real walk
     * away. Picked from the map rather than written down, so a map edit moves
     * it instead of breaking the run.
     */
    async function farTile(page, min, max, avoid = null) {
      const s = await snap(page);
      const { x, y, width, height, tile: T } = s.view;
      const map = WORLD.maps[s.map];
      const skip = readableTiles(s.map);
      const exits = exitTiles(map);
      const from = here(s);
      // A building's picture reaches above the ground it stands on — roof,
      // upper storeys, the name plate floating over the lot — and a tap
      // anywhere on it is a tap on that building (MapScene.tapTargetAt). So
      // the ground under an overhang is not plain ground, however walkable it
      // is. The engine publishes the boxes it drew, because only the drawing
      // knows how tall a facade turned out to be.
      const art = s.art ?? [];
      const covered = (tx, ty) =>
        art.some((b) => tx * T < b.x + b.w && b.x < (tx + 1) * T && ty * T < b.y + b.h && b.y < (ty + 1) * T);
      // Open ground: walkable, nothing to read on it, and not a way out of town.
      const plain = (tx, ty) =>
        !skip.has(`${tx},${ty}`) &&
        !exits.has(`${tx},${ty}`) &&
        !covered(tx, ty) &&
        !isSolid(map, tx, ty) &&
        !npcAt(s.map, tx, ty);
      // Two tiles in from the edges of the view, because the view is still
      // sliding while the tap is chosen and sent.
      const x0 = Math.ceil((x + 2 * T) / T);
      const x1 = Math.floor((x + width - 2 * T) / T);
      const y0 = Math.ceil((y + 2 * T) / T);
      const y1 = Math.floor((y + height - 2 * T) / T);
      let best = null;
      let bestLen = 0;
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (avoid && avoid[0] === tx && avoid[1] === ty) continue;
          // The neighbours have to be open ground too, so that a tap which
          // slips a tile on a slow machine still lands on plain grass and the
          // engine still walks exactly where the finger went.
          if (!plain(tx, ty) || !plain(tx - 1, ty) || !plain(tx + 1, ty) || !plain(tx, ty - 1) || !plain(tx, ty + 1)) {
            continue;
          }
          const path = findPath(s.map, from, [tx, ty]);
          if (!path) continue;
          const len = path.length - 1;
          if (len < min || len > max || len <= bestLen) continue;
          best = [tx, ty];
          bestLen = len;
        }
      }
      if (!best) fail('tap-walk', `no open tile ${min}-${max} steps away is on screen (view ${JSON.stringify(s.view)})`);
      return { tile: best, steps: bestLen };
    }

    // A tap on somebody walks over and talks to them, once.
    log('  tap Earl');
    const earlBefore = await snap(wp);
    await tapTile(wp, wcdp, earl.pos);
    const onEarl = await tapLanding(wp, earl.pos);
    if (onEarl[0] !== earl.pos[0] || onEarl[1] !== earl.pos[1]) {
      fail('tap-earl', `the tap aimed at Earl on ${earl.pos} landed on ${onEarl}`);
    }
    await waitUntil(wp, (s) => s.dialogueOpen, 'Earl to be talked to after a tap', 8000);
    const earlAfter = await snap(wp);
    if (Math.abs(earlAfter.y - earlBefore.y) < 0.5) {
      fail('tap-earl', `tapping Earl opened his dialogue without walking there: y stayed at ${earlAfter.y.toFixed(2)}`);
    }
    log(`    walked ${earlBefore.y.toFixed(2)} -> ${earlAfter.y.toFixed(2)} and said hello`);
    await shot(wp, 'tap-earl');
    await advanceDialogue(wp, 'tap-earl', 3);

    // A tap on a plain tile walks there, with the ring on the destination all
    // the way — this is the shot Tom looks at.
    log('  tap a far tile');
    const far = await farTile(wp, 5, 12);
    await tapTile(wp, wcdp, far.tile);
    // Nothing is moving yet, so a tap that misses its tile here is a real miss.
    const onFar = await tapLanding(wp, far.tile);
    if (onFar[0] !== far.tile[0] || onFar[1] !== far.tile[1]) {
      fail('tap-far', `the tap on ${far.tile} landed on ${onFar} with the view standing still`);
    }
    const walking = await waitUntil(wp, (s) => s.walkTo !== null, 'the walk to start', 4000);
    if (walking.walkTo[0] !== far.tile[0] || walking.walkTo[1] !== far.tile[1]) {
      fail('tap-far', `tapped ${far.tile} and the marker went to ${walking.walkTo}`);
    }
    await sleep(260);
    const midway = await snap(wp);
    if (!midway.walkTo) fail('tap-far', `the ${far.steps}-step walk was over before it could be photographed`);
    await shot(wp, 'tap-walking');
    log(`    ${far.steps} steps to ${far.tile}, ring on the destination`);
    await waitUntil(wp, (s) => !s.walkTo, 'the walk to finish', 12000);
    const arrived = await snap(wp);
    if (Math.abs(arrived.x - far.tile[0]) > 0.1 || Math.abs(arrived.y - far.tile[1]) > 0.1) {
      fail('tap-far', `walked to (${arrived.x.toFixed(2)}, ${arrived.y.toFixed(2)}) instead of ${far.tile}`);
    }
    if (arrived.dialogueOpen) fail('tap-far', 'walking to a plain tile opened a dialogue box');
    log(`    arrived at ${here(arrived)}`);
    await shot(wp, 'tap-arrived');

    // A second tap part-way replaces the destination.
    log('  tap again mid-walk to redirect');
    const firstGoal = await farTile(wp, 7, 14);
    await tapTile(wp, wcdp, firstGoal.tile);
    const firstTile = await tapLanding(wp, firstGoal.tile);
    if (firstTile[0] !== firstGoal.tile[0] || firstTile[1] !== firstGoal.tile[1]) {
      fail('tap-redirect', `the first tap on ${firstGoal.tile} landed on ${firstTile} with the view standing still`);
    }
    await waitUntil(wp, (s) => s.walkTo !== null, 'the first walk to start', 4000);
    await sleep(300);
    // This one is aimed at a moving view, so what the marker is checked against
    // is where the finger actually came down, not where it was sent.
    const secondGoal = await farTile(wp, 3, 9, firstTile);
    await tapTile(wp, wcdp, secondGoal.tile);
    const secondTile = await tapLanding(wp, secondGoal.tile);
    if (secondTile[0] === firstTile[0] && secondTile[1] === firstTile[1]) {
      fail('tap-redirect', `the second tap came down on the first destination ${firstTile}: nothing to redirect`);
    }
    const redirected = await waitUntil(
      wp,
      (s) => s.walkTo !== null && (s.walkTo[0] !== firstTile[0] || s.walkTo[1] !== firstTile[1]),
      'the destination to move to the second tap',
      4000
    );
    if (redirected.walkTo[0] !== secondTile[0] || redirected.walkTo[1] !== secondTile[1]) {
      fail('tap-redirect', `the second tap came down on ${secondTile} and the marker went to ${redirected.walkTo}`);
    }
    await waitUntil(wp, (s) => !s.walkTo, 'the redirected walk to finish', 12000);
    const ended = await snap(wp);
    if (Math.abs(ended.x - secondTile[0]) > 0.1 || Math.abs(ended.y - secondTile[1]) > 0.1) {
      fail('tap-redirect', `ended at ${here(ended)} instead of ${secondTile}`);
    }
    log(`    ${firstTile} -> redirected to ${secondTile}`);

    // And the d-pad always wins: one press calls the walk off where it stands.
    log('  d-pad cancels a walk');
    const cancelGoal = await farTile(wp, 6, 14);
    await tapTile(wp, wcdp, cancelGoal.tile);
    const onCancel = await tapLanding(wp, cancelGoal.tile);
    if (onCancel[0] !== cancelGoal.tile[0] || onCancel[1] !== cancelGoal.tile[1]) {
      fail('tap-cancel', `the tap on ${cancelGoal.tile} landed on ${onCancel} with the view standing still`);
    }
    await waitUntil(wp, (s) => s.walkTo !== null, 'the walk to cancel to start', 4000);
    await sleep(220);
    const dpadDown = await centerOf(wp, '[data-dpad=down]');
    await touchAt(wcdp, 'touchStart', dpadDown.x, dpadDown.y);
    await sleep(120);
    await touchAt(wcdp, 'touchEnd', dpadDown.x, dpadDown.y);
    const cancelled = await snap(wp);
    if (cancelled.walkTo) fail('tap-cancel', `the d-pad did not call the walk off: still heading for ${cancelled.walkTo}`);
    await sleep(400);
    const stopped = await snap(wp);
    if (Math.abs(stopped.x - cancelGoal.tile[0]) < 0.1 && Math.abs(stopped.y - cancelGoal.tile[1]) < 0.1) {
      fail('tap-cancel', `the walk carried on to ${cancelGoal.tile} after the d-pad press`);
    }
    if (stopped.walkTo) fail('tap-cancel', 'the walk picked itself back up after the d-pad press');
    log(`    stopped at ${here(stopped)}, short of ${cancelGoal.tile}`);
    await shot(wp, 'tap-cancelled');

    // --- tap targets --------------------------------------------------------
    // Tapping the thing itself is the whole control scheme (CLAUDE.md #4): a
    // shopfront, a door, the little plaque beside it, the box on the sidewalk
    // and the road out of town each walk the player over and do the thing on
    // arrival, with no A press anywhere. Every target below is read out of the
    // world pack rather than written down here.
    log('  tap targets: a facade, a plaque, a door, a fixture');
    const CREDITS = existsSync(resolve(PACK, 'credits.json')) ? readJson(resolve(PACK, 'credits.json')) : {};

    /** What the door of a building says, in the engine's order (DESIGN.md §3). */
    function signTextOf(b) {
      const episodeSign = (EPISODE.signs ?? []).find((s) => s.building === b.id);
      if (episodeSign) return episodeSign.lines[0];
      const own = WORLD.buildings[b.id].sign ?? [];
      if (own.length) return own[0];
      return COPY.ui.unpainted
        .replace('{building}', WORLD.buildings[b.id].name)
        .replace('{contribute}', WORLD.contribute ?? '');
    }

    /** What its plaque says: thanks when it is painted, an invitation when not. */
    function plaqueTextOf(b) {
      const painted = existsSync(resolve(PACK, 'assets', 'buildings', `${b.id}.png`));
      const credit = painted ? CREDITS.buildings?.[b.id] : undefined;
      const template = painted
        ? credit
          ? COPY.ui.plaque.painted
          : COPY.ui.plaque.anonymous
        : COPY.ui.plaque.unpainted;
      return template.replace(/\{building\}/g, WORLD.buildings[b.id].name).replace(/\{credit\}/g, credit ?? '');
    }

    /** A tile the player can stand on, nearest first, from a list of offsets. */
    function standable(mapId, from, offsets) {
      const map = WORLD.maps[mapId];
      const exits = exitTiles(map);
      // A door or a plaque is somewhere to read, not somewhere to stand and
      // watch from: standing on one would make the next tap a no-op.
      const taken = new Set(
        map.buildings.flatMap((b) => {
          const p = plaqueOf(b);
          return [`${b.door[0]},${b.door[1]}`, ...(p ? [`${p[0]},${p[1]}`] : [])];
        })
      );
      for (const [dx, dy] of offsets) {
        const tile = [from[0] + dx, from[1] + dy];
        const k = `${tile[0]},${tile[1]}`;
        if (isSolid(map, tile[0], tile[1]) || npcAt(mapId, tile[0], tile[1]) || fixtureAt(mapId, tile[0], tile[1])) {
          continue;
        }
        if (exits.has(k) || taken.has(k)) continue;
        return tile;
      }
      return null;
    }

    /** Taps a tile and insists the finger came down on it, with the view still. */
    async function tapTarget(milestone, tile, what) {
      await tapTile(wp, wcdp, tile);
      const landed = await tapLanding(wp, tile);
      if (landed[0] !== tile[0] || landed[1] !== tile[1]) {
        fail(milestone, `the tap on ${what} (${tile}) landed on ${landed}`);
      }
    }

    /** After a door or a road: back in the player's hands, nothing on screen. */
    const handsBack = (page, label) => waitUntil(page, (s) => !s.locked && !s.dialogueOpen, label, 15000);

    const shop = WORLD.maps.stamford.buildings.find((b) => b.interior && b.enter);
    if (!shop) fail('tap-targets', 'no Stamford building has an interior to tap into');
    const shopPlaque = plaqueOf(shop);
    if (!shopPlaque) fail('tap-targets', `${shop.id} has no plaque to tap`);
    const shopStand = standable('stamford', shop.door, [[0, 2], [0, 3], [1, 2], [-1, 2], [0, 1]]);
    if (!shopStand) fail('tap-targets', `nowhere to stand in front of ${shop.id}`);
    await walkTo(wp, 'tap-targets', shopStand);

    // The facade: a tile of the picture that is neither the door nor the
    // plaque. Tapping a shopfront walks to the front and reads the sign — it
    // does not walk in, even where there is an interior to walk into.
    const wallColumn = Array.from({ length: shop.size[0] }, (_, i) => shop.pos[0] + i).find(
      (x) => x !== shop.door[0] && x !== shopPlaque[0]
    );
    if (wallColumn === undefined) fail('tap-targets', `${shop.id} is all door and plaque`);
    const wall = [wallColumn, shop.pos[1] + Math.floor(shop.size[1] / 2)];
    await tapTarget('tap-facade', wall, `${shop.id}'s front`);
    const read = await waitUntil(wp, (s) => s.dialogueOpen, `${shop.id}'s sign after a tap on its front`, 12000);
    if (read.map !== 'stamford') fail('tap-facade', `tapping the front of ${shop.id} walked in instead of reading it`);
    if (read.dialogue?.text !== signTextOf(shop)) {
      fail('tap-facade', `the front of ${shop.id} read "${read.dialogue?.text}", expected "${signTextOf(shop)}"`);
    }
    log(`    ${wall} (${shop.id}'s wall) -> its sign, standing at ${here(read)}`);
    await advanceDialogue(wp, 'tap-facade', 3);

    // The plaque, on the tile it is read from and on the little brass one
    // hanging on the wall above it — both are the plaque to a finger.
    for (const [tile, what] of [
      [shopPlaque, 'the plaque tile'],
      [[shopPlaque[0], shopPlaque[1] - 1], 'the plaque on the wall']
    ]) {
      await tapTarget('tap-plaque', tile, what);
      const said = await waitUntil(wp, (s) => s.dialogueOpen, `${shop.id}'s plaque after tapping ${what}`, 12000);
      if (said.dialogue?.text !== plaqueTextOf(shop)) {
        fail('tap-plaque', `${what} read "${said.dialogue?.text}", expected "${plaqueTextOf(shop)}"`);
      }
      log(`    ${tile} (${what}) -> the plaque`);
      if (what === 'the plaque tile') await shot(wp, 'tap-plaque');
      await advanceDialogue(wp, 'tap-plaque', 1);
    }

    // The door of a building with an interior opens it. No A press, no
    // stopping on the doorstep to press anything.
    await tapTarget('tap-door', shop.door, `${shop.id}'s door`);
    await shot(wp, 'tap-door');
    await waitUntil(wp, (s) => s.map === shop.interior, `${shop.id}'s door to open on a tap`, 15000);
    await handsBack(wp, 'the shop to settle');
    log(`    ${shop.door} (${shop.id}'s door) -> inside`);
    await shot(wp, 'tap-entered');

    // And the way out is a tap too.
    const back = WORLD.maps[shop.interior].exits[0];
    if (!back) fail('tap-targets', `${shop.interior} has no way out`);
    await tapTarget('tap-exit', [back.at[0], back.at[1]], 'the way out');
    await waitUntil(wp, (s) => s.map === back.to && !s.locked, 'the way out to be taken on a tap', 15000);
    await handsBack(wp, 'the street to settle');
    log(`    ${[back.at[0], back.at[1]]} (the way out) -> back on the street`);

    // A building with no interior has no door to open, so its door reads the
    // sign like the rest of the front.
    const shopfront = WORLD.maps.stamford.buildings.find(
      (b) => !b.interior && (EPISODE.signs ?? []).some((s) => s.building === b.id)
    );
    if (!shopfront) fail('tap-targets', 'no Stamford building without an interior has a sign this episode');
    const frontStand = standable('stamford', shopfront.door, [[0, 2], [0, 3], [1, 2], [-1, 2], [0, 1]]);
    if (!frontStand) fail('tap-targets', `nowhere to stand in front of ${shopfront.id}`);
    await walkTo(wp, 'tap-targets', frontStand);
    await tapTarget('tap-shut-door', shopfront.door, `${shopfront.id}'s door`);
    const front = await waitUntil(wp, (s) => s.dialogueOpen, `${shopfront.id}'s sign`, 12000);
    if (front.map !== 'stamford') fail('tap-shut-door', `${shopfront.id} has no interior, and the tap left Stamford`);
    if (front.dialogue?.text !== signTextOf(shopfront)) {
      fail('tap-shut-door', `${shopfront.id}'s door read "${front.dialogue?.text}", expected "${signTextOf(shopfront)}"`);
    }
    log(`    ${shopfront.door} (${shopfront.id}'s door, no interior) -> its sign`);
    await advanceDialogue(wp, 'tap-shut-door', 3);

    // The suggestion box, and the road that gets us to it: a fixture blocks
    // its own tile, so tapping one walks up beside it and reads it from there.
    const withBox = Object.entries(WORLD.maps).find(([, m]) => (m.fixtures ?? []).length > 0);
    if (!withBox) {
      log('  (this world has no fixture to tap — skipping that one)');
    } else {
      const [boxMapId, boxMap] = withBox;
      let standingOn = (await snap(wp)).map;
      if (standingOn !== boxMapId) {
        const road = WORLD.maps[standingOn].exits.find((e) => e.to === boxMapId);
        if (!road) fail('tap-road', `no road from "${standingOn}" to "${boxMapId}"`);
        const mouth = [road.at[0] + Math.floor(road.at[2] / 2), road.at[1] + Math.floor(road.at[3] / 2)];
        const kerb = standable(standingOn, mouth, [[0, 1], [0, -1], [-1, 0], [1, 0], [0, 2], [-2, 0]]);
        if (!kerb) fail('tap-road', `nowhere to stand beside the road out at ${mouth}`);
        await walkTo(wp, 'tap-road', kerb);
        await tapTarget('tap-road', mouth, 'the road out of town');
        await waitUntil(wp, (s) => s.map === boxMapId && !s.locked, `the road to ${boxMapId} to be taken`, 20000);
        await handsBack(wp, `${boxMapId} to settle`);
        log(`    ${mouth} (the road out) -> ${boxMapId}`);
        standingOn = boxMapId;
      }
      const fixture = boxMap.fixtures[0];
      const nearBox = standable(boxMapId, fixture.pos, [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1], [1, 1], [-1, 1]]);
      if (!nearBox) fail('tap-fixture', `nowhere to stand near the ${fixture.kind} at ${fixture.pos}`);
      await walkTo(wp, 'tap-fixture', nearBox);
      await tapTarget('tap-fixture', fixture.pos, `the ${fixture.kind}`);
      const box = await waitUntil(wp, (s) => s.dialogueOpen, `the ${fixture.kind} to be read after a tap`, 12000);
      const first = COPY.ui.suggest?.lines?.[0];
      if (!first) fail('tap-fixture', 'copy.json has no ui.suggest.lines for the box to say');
      if (box.dialogue?.text !== first) {
        fail('tap-fixture', `the ${fixture.kind} read "${box.dialogue?.text}", expected "${first}"`);
      }
      if (box.x === fixture.pos[0] && box.y === fixture.pos[1]) {
        fail('tap-fixture', `the player is standing inside the ${fixture.kind} at ${fixture.pos}`);
      }
      log(`    ${fixture.pos} (the ${fixture.kind}) -> read from ${here(box)}`);
      await shot(wp, 'tap-fixture');
      await advanceDialogue(wp, 'tap-fixture', COPY.ui.suggest.lines.length);
    }

    // --- Paint it -----------------------------------------------------------
    // The invitation to draw an unpainted building lives on the plaque beside
    // its door: one kind line, with the DOM link beside the box, deep-linked
    // to the building and up for the whole entry rather than for one line of
    // it (DESIGN.md §2). Checked on the touch page so the link is exercised at
    // phone width, where it has the least room.
    log('  "Paint it" on an unpainted building\'s plaque');
    const bare = WORLD.maps.stamford.buildings.find(
      (b) => !b.interior && !existsSync(resolve(PACK, 'assets', 'buildings', `${b.id}.png`))
    );
    if (!bare) fail('paint-it', 'no unpainted building without an interior in Stamford to read');
    const barePlaque = plaqueOf(bare);
    if (!barePlaque) fail('paint-it', `${bare.id} has no plaque to read`);
    // The plaque is always exactly one line, whatever the episode says at the
    // sign next door.
    const bareLines = 1;
    await walkTo(tp, 'paint-it', barePlaque);
    await pressA(tp);
    await expectDialogue(tp, 'paint-it', `${bare.id}'s plaque`);
    const paint = tp.locator('#say-link');
    if (!(await paint.isVisible())) fail('paint-it', `no "Paint it" link on ${bare.id}'s first page`);
    const href = (await paint.getAttribute('href')) ?? '';
    if (!href.endsWith(`&building=${bare.id}`)) fail('paint-it', `link href is "${href}"`);
    // A page, not a mail app: it opens in a new tab, so going to paint never
    // costs anyone their place in the game (Tom's playtest feedback).
    if ((await paint.getAttribute('target')) !== '_blank') {
      fail('paint-it', '"Paint it" should open in a new tab (target="_blank")');
    }
    const paintBox = await paint.boundingBox();
    if (!paintBox || paintBox.width < 44 || paintBox.height < 24) {
      fail('paint-it', `the "Paint it" link is not a tappable size: ${JSON.stringify(paintBox)}`);
    }
    // Reachable by keyboard, and the game does not swallow the keys while it
    // has focus (CLAUDE.md #4: it is a browser control, not a game control).
    let focused = false;
    for (let i = 0; i < 4 && !focused; i++) {
      await tp.keyboard.press('Tab');
      focused = await tp.evaluate(() => document.activeElement?.matches('#say-link') === true);
    }
    if (!focused) fail('paint-it', 'the "Paint it" link is not reachable with Tab');
    await pressA(tp);
    if (!(await snap(tp)).dialogueOpen) fail('paint-it', 'space stole focus from the link and closed the dialogue');
    await tp.evaluate(() => document.activeElement?.blur());
    log(`    "${(await paint.innerText()).trim()}" -> ${href}`);
    await shot(tp, 'paint-it');

    // Every page, not just one: the box is read for what the place is up to,
    // and the way in is standing by the whole time.
    const bareRead = await readDialogue(tp, 'paint-it', bareLines, async (i) => {
      if (!(await paint.isVisible())) fail('paint-it', `the "Paint it" link went missing on page ${i + 1}`);
      const box = await paint.boundingBox();
      const body = await tp.locator('#stage').boundingBox();
      if (box && body && box.y + box.height > body.y + body.height) {
        fail('paint-it', `the "Paint it" link fell off the stage on page ${i + 1}: ${JSON.stringify(box)}`);
      }
    });
    if (bareRead !== bareLines) {
      fail(
        'paint-it',
        `${bare.id}'s plaque read ${bareRead} page(s) for ${bareLines} line(s) of copy`
      );
    }
    log(`    link held for all ${bareRead} page(s)`);
    if (await paint.isVisible()) fail('paint-it', 'the "Paint it" link outlived the dialogue');

    // And the sign a tile away is the story only: same unpainted building, no
    // link anywhere near it (DESIGN.md §2/§4).
    log('  no "Paint it" on the same building\'s sign');
    // The episode's sign and the building's standing sign both read here, and
    // with neither one stand-in line stands in for an empty box — so there is
    // always at least one page.
    const bareSignLines = signLinesOf(bare.id).length || 1;
    await walkTo(tp, 'paint-it-sign', bare.door);
    await pressA(tp);
    await expectDialogue(tp, 'paint-it-sign', `${bare.id}'s sign`);
    if (await paint.isVisible()) fail('paint-it-sign', `the "Paint it" link showed on ${bare.id}'s sign`);
    await shot(tp, 'unpainted-sign');
    const signRead = await readDialogue(tp, 'paint-it-sign', bareSignLines, async (i) => {
      if (await paint.isVisible()) fail('paint-it-sign', `a "Paint it" link appeared on sign page ${i + 1}`);
    });
    if (signRead !== bareSignLines) {
      fail('paint-it-sign', `${bare.id}'s sign read ${signRead} page(s) for ${bareSignLines} line(s) of copy`);
    }
    log(`    sign: ${signRead} page(s), no link`);

    // A person is not a building waiting for paint: no link on their dialogue.
    log('  no "Paint it" on a person');
    await walkTo(tp, 'paint-it-npc', [earl.pos[0], earl.pos[1] + 1]);
    await pressA(tp);
    await expectDialogue(tp, 'paint-it-npc', 'Earl');
    if (await paint.isVisible()) fail('paint-it-npc', 'the "Paint it" link showed on Earl\'s dialogue');
    await advanceDialogue(tp, 'paint-it-npc', 3);

    // --- a standing sign from world.json ------------------------------------
    // A building the episode says nothing about is not silent: its own sign in
    // the buildings registry is what the door reads, and only a building with
    // neither falls back to the "unpainted" stand-in (DESIGN.md §3).
    log("  a building's standing sign, where the episode has none");
    const standing = WORLD.maps.stamford.buildings.find(
      (b) =>
        !b.interior &&
        (WORLD.buildings[b.id].sign ?? []).length > 0 &&
        !(EPISODE.signs ?? []).some((sg) => sg.building === b.id)
    );
    if (!standing) fail('standing-sign', 'no Stamford building has a standing sign the episode leaves alone');
    const standingLines = WORLD.buildings[standing.id].sign;
    await walkTo(tp, 'standing-sign', standing.door);
    await pressA(tp);
    const standingState = await expectDialogue(tp, 'standing-sign', `${standing.id}'s sign`);
    if (standingState.dialogue?.text !== standingLines[0]) {
      fail(
        'standing-sign',
        `${standing.id} reads "${standingState.dialogue?.text}" — expected its world.json sign, "${standingLines[0]}"`
      );
    }
    if (standingState.dialogue?.text === COPY.ui.unpainted.replace('{building}', WORLD.buildings[standing.id].name)) {
      fail('standing-sign', `${standing.id} is still showing the "unpainted" stand-in`);
    }
    await shot(tp, 'standing-sign');
    const standingRead = await readDialogue(tp, 'standing-sign', standingLines.length, async (i) => {
      const on = (await snap(tp)).dialogue;
      if (on?.text !== standingLines[i]) {
        fail('standing-sign', `${standing.id} page ${i + 1} reads "${on?.text}", expected "${standingLines[i]}"`);
      }
    });
    if (standingRead !== standingLines.length) {
      fail('standing-sign', `${standing.id} read ${standingRead} page(s) for ${standingLines.length} line(s)`);
    }
    log(`    ${standing.id}: ${standingRead} page(s) of its own copy, no episode sign in sight`);

    // --- both kinds of sign, in order ---------------------------------------
    // A story goes on top of a place, not in place of it: where the episode
    // has a sign for a building that also has a standing sign, the door reads
    // the episode's pages first and the building's own after them, so a week
    // of story never costs the player the colour of where it sent them
    // (DESIGN.md §3).
    log('  a building with both signs reads the episode first, then its own');
    const both = WORLD.maps.stamford.buildings.find(
      (b) =>
        !b.interior &&
        (WORLD.buildings[b.id].sign ?? []).length > 0 &&
        (EPISODE.signs ?? []).some((sg) => sg.building === b.id && (sg.requires ?? []).length === 0 && !sg.replace)
    );
    if (!both) fail('both-signs', 'no Stamford building carries an episode sign and a standing sign at once');
    const bothWant = signLinesOf(both.id);
    const bothStanding = WORLD.buildings[both.id].sign;
    await walkTo(tp, 'both-signs', both.door);
    await pressA(tp);
    await expectDialogue(tp, 'both-signs', `${both.id}'s sign`);
    await shot(tp, 'both-signs');
    const bothRead = await readDialogue(tp, 'both-signs', bothWant.length, async (i) => {
      const on = (await snap(tp)).dialogue;
      if (on?.text !== bothWant[i]) {
        fail('both-signs', `${both.id} page ${i + 1} reads "${on?.text}", expected "${bothWant[i]}"`);
      }
    });
    if (bothRead !== bothWant.length) {
      fail(
        'both-signs',
        `${both.id} read ${bothRead} page(s) for ${bothWant.length} line(s) — the standing sign is being dropped`
      );
    }
    log(
      `    ${both.id}: ${bothWant.length - bothStanding.length} episode page(s), ` +
        `then ${bothStanding.length} of its own`
    );

    // --- the Studio's door and plaque markers -------------------------------
    // The artist says where the door and the little plaque go, and the code
    // carries it (studio/codec.ts). Two things matter here: the markers are
    // reachable without dragging, and moving one never touches the drawing —
    // the payload either side of a move has to be the same string. Run at
    // phone width, which is where the strip has the least room.
    log('  Studio: the door and plaque markers');
    const sp = await touchCtx.newPage();
    attach(sp, 'studio');
    const scdp = await touchCtx.newCDPSession(sp);
    const paintable = Object.values(WORLD.maps)
      .flatMap((map) => map.buildings)
      .find((b) => b.size[0] >= 3);
    if (!paintable) fail('studio-markers', 'no building wide enough to place two markers on');
    await sp.goto(`${BASE}studio/?world=${WORLD_ID}&building=${paintable.id}`, { waitUntil: 'load' });
    await sp.waitForSelector('#markers', { timeout: 20000 });

    // The Studio keeps a draft of the current code in localStorage, which is
    // the code itself — the tidiest way to read what a move actually changed.
    const DRAFT = `mainstreet.studio.v1.${WORLD_ID}.${paintable.id}`;
    async function studioCode(differentFrom) {
      for (let i = 0; i < 80; i++) {
        const code = await evalIn(sp, 'the marker draft', (key) => {
          try {
            return JSON.parse(localStorage.getItem(key) ?? '{}').code ?? null;
          } catch {
            return null;
          }
        }, DRAFT);
        if (code && code !== differentFrom) return code;
        await sleep(100);
      }
      fail('studio-markers', `the code never settled${differentFrom ? ' after moving a marker' : ''}`);
    }

    // The marker rows sit behind "More" now — the strip under the drawing is
    // the everyday way to move a marker, and the buttons are there for a
    // keyboard, a screen reader, or anyone who would rather not drag.
    if (await sp.locator('#doorrow').isVisible()) {
      fail('studio-markers', 'the door row is on the phone editor before "More" has been opened');
    }
    await sp.locator('#moretoggle').click({ timeout: 20000 });
    await sleep(200);
    for (const sel of ['#doorrow', '#plaquerow', '#doorleft', '#doorright', '#doorreset', '#markers']) {
      if (!(await sp.locator(sel).isVisible({ timeout: 20000 }))) fail('studio-markers', `${sel} is not on the page`);
    }
    log('    "More" reveals the door and plaque rows');
    const doorAt = async () => (await sp.locator('#doorwhere').innerText({ timeout: 20000 })).trim();
    const restingPlace = await doorAt();
    if (!restingPlace) fail('studio-markers', 'the door marker does not say which column it is in');

    const fresh = await studioCode(null);
    if (fresh.split('|').length !== 5) {
      fail('studio-markers', `an untouched drawing should carry no columns, and this one is "${fresh}"`);
    }

    // On a phone the marker buttons sit under the drawing, so they are scrolled
    // to before they are tapped — a touch goes to a place on the screen, not to
    // an element.
    async function tapAfterScroll(selector) {
      await sp.locator(selector).scrollIntoViewIfNeeded({ timeout: 20000 });
      await sleep(150);
      await tapEl(scdp, sp, selector);
    }

    // The button path, tapped: what a keyboard reaches too.
    await tapAfterScroll('#doorright');
    const stepped = await studioCode(fresh);
    if (stepped.split('|')[4] !== fresh.split('|')[4]) {
      fail('studio-markers', 'moving the door changed the drawing itself — a marker got painted in');
    }
    const columns = stepped.split('|')[5] ?? '';
    if (!/^door=\d+(,plaque=\d+)?$/.test(columns)) {
      fail('studio-markers', `moving the door should add "door=…" to the code, and it added "${columns}"`);
    }
    if ((await doorAt()) === restingPlace) fail('studio-markers', 'the ▶ button did not move the door');
    log(`    ▶ moved the door: ${restingPlace} -> ${await doorAt()} (${columns})`);
    await shot(sp, 'studio-markers');

    // Reset puts both back where the town has them, and a code with nothing to
    // say about the columns goes back to being five parts long.
    await tapAfterScroll('#doorreset');
    const reset = await studioCode(stepped);
    if (reset !== fresh) fail('studio-markers', `Reset should give back the code we started with, and gave "${reset}"`);

    // The pointer path: drag the door marker along the strip to the left-hand
    // column. One pointer, no touch handlers (CLAUDE.md #4).
    await sp.locator('#markers').scrollIntoViewIfNeeded({ timeout: 20000 });
    await sleep(150);
    const strip = await sp.locator('#markers').boundingBox({ timeout: 20000 });
    const wide = paintable.size[0];
    const colAt = (col) => ({ x: strip.x + (strip.width / wide) * (col + 0.5), y: strip.y + strip.height / 2 });
    // Reset has just put the door back on the column the world has it on, so
    // that is where the finger goes down — on the marker itself.
    const doorHome = paintable.door[0] - paintable.pos[0];
    const goal = doorHome === 0 ? wide - 1 : 0;
    const from = colAt(doorHome);
    const to = colAt(goal);
    await touchAt(scdp, 'touchStart', from.x, from.y);
    await touchAt(scdp, 'touchMove', (from.x + to.x) / 2, from.y);
    await touchAt(scdp, 'touchMove', to.x, to.y);
    await touchAt(scdp, 'touchEnd', to.x, to.y);
    const dragged = await studioCode(reset);
    if (!new RegExp(`\\|door=${goal}(,|$)`).test(dragged)) {
      fail('studio-markers', `dragging the door to column ${goal} gave "${dragged.split('|')[5] ?? 'nothing'}"`);
    }
    if (dragged.split('|')[4] !== fresh.split('|')[4]) {
      fail('studio-markers', 'dragging a marker changed the drawing itself');
    }
    log(`    dragged the door to the left-hand column (${dragged.split('|')[5]})`);
    await shot(sp, 'studio-markers-dragged');

    // --- "Improve it?" -------------------------------------------------------
    // A touch-up path: bring the shipped facade back onto the canvas as real,
    // editable pixels (studio/studio.ts improvePicture()), rather than
    // starting from the placeholder guide. Offered only on a building that
    // already has a facade PNG (main()'s HEAD probe). Run at phone width,
    // where the "Files" row has the least room.
    log('  Studio: "Improve it?"');
    const anyPainted = Object.values(WORLD.maps)
      .flatMap((map) => map.buildings)
      .find((b) => existsSync(resolve(PACK, 'assets', 'buildings', `${b.id}.png`)));
    if (!anyPainted) fail('studio-improve', 'no painted building in this world to check "Improve it?" against');

    const ip = await touchCtx.newPage();
    attach(ip, 'studio-improve');

    // Absent on an unpainted building — reusing `bare` from the "Paint it"
    // check above, which is already known to have no facade PNG.
    await ip.goto(`${BASE}studio/?world=${WORLD_ID}&building=${bare.id}`, { waitUntil: 'load' });
    await ip.waitForSelector('#markers', { timeout: 20000 });
    if (await ip.locator('#improveit').count()) {
      fail('studio-improve', `"Improve it?" showed up on unpainted ${bare.id}`);
    }
    log(`    absent on unpainted ${bare.id}`);

    // Present on a painted building, and clicking it fills the canvas.
    await ip.goto(`${BASE}studio/?world=${WORLD_ID}&building=${anyPainted.id}`, { waitUntil: 'load' });
    await ip.waitForSelector('#markers', { timeout: 20000 });
    const improveButton = ip.locator('#improveit');
    if (!(await improveButton.isVisible({ timeout: 20000 }))) {
      fail('studio-improve', `"Improve it?" is missing on painted ${anyPainted.id}`);
    }

    const IMPROVE_DRAFT = `mainstreet.studio.v1.${WORLD_ID}.${anyPainted.id}`;
    async function improveCode(differentFrom) {
      for (let i = 0; i < 80; i++) {
        const code = await evalIn(ip, 'the \u201cImprove it?\u201d draft', (key) => {
          try {
            return JSON.parse(localStorage.getItem(key) ?? '{}').code ?? null;
          } catch {
            return null;
          }
        }, IMPROVE_DRAFT);
        if (code && code !== differentFrom) return code;
        await sleep(100);
      }
      fail('studio-improve', `the code never settled${differentFrom ? ' after clicking "Improve it?"' : ''}`);
    }

    const blank = await improveCode(null);
    await improveButton.click({ timeout: 20000 });
    const filled = await improveCode(blank);
    if (filled === blank) fail('studio-improve', '"Improve it?" did not change the drawing');
    log(`    "${anyPainted.id}": clicking "Improve it?" filled the canvas from the shipped PNG`);
    // The click scrolled the "Files" row into view; scroll back up so the
    // screenshot shows the canvas with the painting now on it.
    await ip.locator('#stage').scrollIntoViewIfNeeded({ timeout: 20000 });
    await sleep(150);
    await shot(ip, 'improve-it');

    // The plaque's "Improve it?" link (checked above) carries `&improve=1`,
    // so opening the Studio that way should run the same fetch on its own,
    // with no click needed — a fresh context, so there is no earlier draft
    // in localStorage to make a stale pass either way.
    log('  Studio: &improve=1 loads the painting on open, with no click');
    const autoCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: false,
      deviceScaleFactor: 1
    });
    const auto = await autoCtx.newPage();
    attach(auto, 'studio-improve-auto');
    await auto.goto(`${BASE}studio/?world=${WORLD_ID}&building=${anyPainted.id}&improve=1`, { waitUntil: 'load' });
    await auto.waitForSelector('#markers', { timeout: 20000 });
    const AUTO_DRAFT = `mainstreet.studio.v1.${WORLD_ID}.${anyPainted.id}`;
    let autoCode = null;
    for (let i = 0; i < 80; i++) {
      autoCode = await evalIn(auto, 'the \u0026improve=1 draft', (key) => {
        try {
          return JSON.parse(localStorage.getItem(key) ?? '{}').code ?? null;
        } catch {
          return null;
        }
      }, AUTO_DRAFT);
      if (autoCode) break;
      await sleep(100);
    }
    if (!autoCode) fail('studio-improve-auto', '&improve=1 did not load a payload onto the canvas on open');
    log(`    "${anyPainted.id}": opening with &improve=1 filled the canvas without a click`);
    await autoCtx.close();

    // --- the Studio's send step ---------------------------------------------
    // This world pack carries a `submit.art` block, so Send no longer posts
    // anything itself: it opens the form's own page, prefilled, in a new tab
    // (a real `<a target="_blank">` the button clicks), and the painter
    // presses Submit there, on Google's page. The harness never lets that
    // real page load — it reads the link's own href, and the new tab it
    // opened, then closes the tab without touching Google at all.
    log('  Studio: opening the form the world pack names, prefilled');
    const send = await touchCtx.newPage();
    attach(send, 'studio-send');

    const FORM = WORLD.submit?.art;
    if (!FORM) fail('studio-send', 'this world pack has no submit.art for the studio to open');
    const VIEWFORM = FORM.page ?? FORM.form.replace(/\/formResponse\/?$/, '/viewform');

    await send.goto(`${BASE}studio/?world=${WORLD_ID}&building=${bare.id}`, { waitUntil: 'load' });
    await send.waitForSelector('#markers', { timeout: 20000 });

    // The header: "Back to <world>" now points at the game itself, sibling to
    // the Studio, rather than at the building picker (Tom's playtest note:
    // painters were leaving the game to paint and not finding their way
    // back) — and the picker is still one tap away as its own link.
    const homeHref = await send.locator('#home').getAttribute('href');
    if (!homeHref || !new URL(homeHref, send.url()).pathname.endsWith(`/${WORLD_ID}/`)) {
      fail('studio-send', `the header's "Back to" link is "${homeHref}", not the game`);
    }
    if (!(await send.locator('#home').innerText()).includes(WORLD.title)) {
      fail('studio-send', `the header's "Back to" link should name ${WORLD.title}`);
    }
    if (!(await send.locator('#allbuildings').isVisible())) {
      fail('studio-send', 'the header lost its way back to "All buildings"');
    }
    log(`    header: "${await send.locator('#home').innerText()}" -> ${homeHref}`);

    // The "rather draw in an app?" card: prominent, with both of its controls,
    // not three "elsewhere" disclosures deep (Tom's note that it was buried).
    if (!(await send.locator('#appcard').isVisible())) fail('studio-send', 'the "rather draw in an app?" card is missing');
    if (!(await send.locator('#appimport').isVisible())) fail('studio-send', 'the appcard has no "Import a PNG"');
    if (!(await send.locator('#whichapps').isVisible())) fail('studio-send', 'the appcard has no "Which apps?" link');
    const whichAppsHref = await send.locator('#whichapps').getAttribute('href');
    if (!whichAppsHref || !whichAppsHref.includes('/contributing/') || !whichAppsHref.endsWith('#apps')) {
      fail('studio-send', `"Which apps?" points at "${whichAppsHref}", not the contributing page's apps section`);
    }

    if (await send.locator('#insurance').isVisible()) {
      fail('studio-send', 'the "Didn’t go through?" note was showing before anything had been sent');
    }
    if (await send.locator('#backtogamerow').isVisible()) {
      fail('studio-send', '"Back to the game" was showing before anything had been sent');
    }
    // With a form configured there is no email route at all — one way to
    // send, and it is the one that needs nothing of the painter's machine.
    for (const gone of ['#sendmail', '#gmail', '#outlook', '#fallback']) {
      if (await send.locator(gone).count()) {
        fail('studio-send', `${gone} is still on the page, and this world opens a form`);
      }
    }
    const mailLinks = await evalIn(send, 'any mailto: link left on the page', () =>
      Array.from(document.querySelectorAll('a[href^="mailto:"]')).length
    );
    if (mailLinks) fail('studio-send', `${mailLinks} mailto: link(s) on a page that opens a form`);

    // The drawing code is the long line that starts with the codec's magic;
    // the paste box's own placeholder is where the harness learns it.
    const MAGIC = (await send.locator('#codebox').getAttribute('placeholder')).split('|')[0];

    await send.locator('#fromguide').click({ timeout: 20000 });
    await sleep(400);
    await send.locator('#credit').fill('A resident');
    await send.locator('#notes').fill('The awning is green in summer.');
    await send.locator('#consent').check({ timeout: 20000 });

    const [smallPopup] = await Promise.all([
      touchCtx.waitForEvent('page'),
      send.locator('#send').click({ timeout: 20000 })
    ]);
    // The real href the button just activated — read from the page rather
    // than trusted from the popup, which the harness never lets finish
    // loading the real, cross-origin form.
    const smallHref = await send.locator('#sendform').getAttribute('href');
    await smallPopup.close().catch(() => {});
    if (!smallHref) fail('studio-send', 'pressing Send left the form link with no href');
    const smallUrl = new URL(smallHref);
    if (`${smallUrl.origin}${smallUrl.pathname}` !== VIEWFORM) {
      fail('studio-send', `Send opened "${smallUrl.href}", not the world pack's viewform (${VIEWFORM})`);
    }
    if (smallUrl.searchParams.get('usp') !== 'pp_url') {
      fail('studio-send', 'the prefilled form link is missing usp=pp_url');
    }
    const want = [
      ['building', FORM.fields.building, bare.id],
      ['world', FORM.fields.world, WORLD_ID],
      ['credit', FORM.fields.credit, 'A resident'],
      ['notes', FORM.fields.notes, 'The awning is green in summer.']
    ];
    for (const [what, id, value] of want) {
      if (!id) continue;
      const got = smallUrl.searchParams.get(id);
      if (got !== value) fail('studio-send', `the form's "${what}" field (${id}) carried "${got}", not "${value}"`);
    }
    const smallCode = smallUrl.searchParams.get(FORM.fields.code) ?? '';
    if (!smallCode.startsWith(MAGIC)) {
      fail('studio-send', `the form's code field carried "${smallCode.slice(0, 40)}", which is not a drawing`);
    }
    await sleep(300);
    const said = (await send.locator('#sendstatus').innerText({ timeout: 20000 })).trim();
    if (!said.includes('opened in a new tab') || !said.includes('Press Submit there')) {
      fail('studio-send', `after sending a small drawing, the studio said "${said}"`);
    }
    if (!(await send.locator('#insurance').isVisible({ timeout: 20000 }))) {
      fail('studio-send', 'the "Didn’t go through?" note stayed hidden after a send');
    }
    if (!(await send.locator('#backtogamerow').isVisible({ timeout: 20000 }))) {
      fail('studio-send', '"Back to the game" stayed hidden after a send');
    }
    const backHref = await send.locator('#backtogame').getAttribute('href');
    if (!backHref || !new URL(backHref, send.url()).pathname.endsWith(`/${WORLD_ID}/`)) {
      fail('studio-send', `"Back to the game" points at "${backHref}", not the game`);
    }
    log(
      `    small drawing: opened ${smallUrl.pathname} with ${[...smallUrl.searchParams.keys()].length}` +
        ` fields (${smallHref.length} characters); it said "${said}"`
    );
    await send.locator('#sendstatus').scrollIntoViewIfNeeded({ timeout: 20000 });
    await sleep(150);
    await shot(send, 'studio-send');

    // A finished-size facade: a URL too long for any browser to open
    // reliably (studio.ts's PREFILL_URL_BUDGET), so the code is left out of
    // the link and copied to the clipboard instead. A worst-case checkerboard
    // of run-length-1 pixels, sized to this world's biggest footprint with
    // every spare row above it, guarantees the budget is blown regardless of
    // what is actually painted on any one building today — planted straight
    // into the building's own draft in localStorage, the same place a real
    // session's work-in-progress lives, rather than drawn by hand.
    log('  Studio: a finished-size code gets copied instead of put in the URL');
    const hugeBuilding = Object.values(WORLD.maps)
      .flatMap((m) => m.buildings ?? [])
      .filter((b) => !b.interior)
      .reduce((a, b) => (a.size[0] * a.size[1] >= b.size[0] * b.size[1] ? a : b));
    const STUDIO_TILE = 16;
    const STUDIO_MAX_EXTRA_ROWS = 3; // studio.ts's MAX_EXTRA_ROWS
    const hugeWidth = hugeBuilding.size[0] * STUDIO_TILE;
    const hugeHeight = (hugeBuilding.size[1] + STUDIO_MAX_EXTRA_ROWS) * STUDIO_TILE;
    const hugePixels = new Uint8Array(hugeWidth * hugeHeight);
    for (let i = 0; i < hugePixels.length; i++) hugePixels[i] = i % 2; // every pixel its own run
    const hugeCode = encode({
      world: WORLD_ID,
      building: hugeBuilding.id,
      width: hugeWidth,
      height: hugeHeight,
      pixels: hugePixels
    });
    if (hugeCode.length < 7000) {
      fail('studio-send', `the synthetic worst-case drawing only made a ${hugeCode.length}-character code`);
    }

    await send.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: `mainstreet.studio.v1.${WORLD_ID}.${hugeBuilding.id}`,
        value: JSON.stringify({ saved: Date.now(), code: hugeCode, recent: [] })
      }
    );
    await send.goto(`${BASE}studio/?world=${WORLD_ID}&building=${hugeBuilding.id}`, { waitUntil: 'load' });
    await send.waitForSelector('#markers', { timeout: 20000 });
    await sleep(400);
    await send.locator('#credit').fill('A resident');
    await send.locator('#consent').check({ timeout: 20000 });

    const [hugePopup] = await Promise.all([
      touchCtx.waitForEvent('page'),
      send.locator('#send').click({ timeout: 20000 })
    ]);
    const hugeHref = await send.locator('#sendform').getAttribute('href');
    await hugePopup.close().catch(() => {});
    if (!hugeHref) fail('studio-send', 'a finished-size send left the form link with no href');
    const hugeUrl = new URL(hugeHref);
    if (hugeUrl.searchParams.has(FORM.fields.code)) {
      fail('studio-send', 'a finished-size drawing put its code in the URL instead of staying under the budget');
    }
    if (hugeUrl.searchParams.get(FORM.fields.building) !== hugeBuilding.id) {
      fail('studio-send', 'the form was told the wrong building for a finished-size drawing');
    }
    if (hugeHref.length >= hugeCode.length) {
      fail(
        'studio-send',
        `a link with the code left out (${hugeHref.length} chars) should be shorter than the code alone (${hugeCode.length})`
      );
    }
    await sleep(300);
    const saidHuge = (await send.locator('#sendstatus').innerText({ timeout: 20000 })).trim();
    // The clipboard write needs a focused, permitted document; a headless or
    // CI browser may refuse it, and the studio then says so and points at the
    // "Copy the code" button instead. Either wording is the right behaviour.
    const lower = saidHuge.toLowerCase();
    if (!lower.includes('copied') && !lower.includes('copy the code')) {
      fail('studio-send', `a finished-size send should say the code was copied or offer Copy the code; it said "${saidHuge}"`);
    }
    if (!(await send.locator('#copycode').isVisible({ timeout: 20000 }))) {
      fail('studio-send', 'a finished-size send should leave a "Copy the code" button showing');
    }
    if (!(await send.locator('#backtogamerow').isVisible({ timeout: 20000 }))) {
      fail('studio-send', '"Back to the game" stayed hidden after a finished-size send');
    }
    log(
      `    ${hugeBuilding.id}: a ${hugeCode.length}-character code stayed out of the ${hugeHref.length}-character` +
        ` link, and was copied to the clipboard instead; the studio said "${saidHuge}"`
    );
    await shot(send, 'studio-send-finished');

    // Everything before this is finished with, and the phone section is the
    // one that asks the browser for a real touch scroll. A touch scroll only
    // completes once a frame has been painted, and Chromium does not answer
    // the touchmove that starts it until then; three pages still running a
    // game loop are enough to keep a small CI runner from ever finding the
    // moment to paint one, and the run then waits for ever. So the rest of the
    // run is put away first — which is tidy anyway, and much the quickest part
    // of the whole playtest.
    for (const finished of [context, walkCtx, touchCtx]) await finished.close();

    // --- the Studio on a phone ----------------------------------------------
    // A phone is where most of the painting will actually happen, so: the
    // drawing opens fitting the screen it has, one finger paints, a second
    // finger turns the gesture into a pinch that zooms and paints nothing, and
    // Lock hands one-finger gestures back to the browser so the page can be
    // scrolled past the canvas. Playwright's touchscreen is one finger only, so
    // the pinch goes in as PointerEvents with two pointerIds — which is all the
    // studio listens to anyway (CLAUDE.md #4, one input path).
    log('  Studio: on a phone (390x844)');
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: false,
      deviceScaleFactor: 1
    });
    const pp = await phoneCtx.newPage();
    attach(pp, 'studio-phone');
    const pcdp = await phoneCtx.newCDPSession(pp);
    await pp.goto(`${BASE}studio/?world=${WORLD_ID}&building=${paintable.id}`, { waitUntil: 'load' });
    await pp.waitForSelector('#markers', { timeout: 20000 });

    const room = await evalIn(pp, 'the phone studio\u2019s measurements', () => ({
      drawing: document.getElementById('view').getBoundingClientRect().width,
      stage: document.getElementById('stage').clientWidth,
      page: document.documentElement.scrollWidth,
      window: window.innerWidth
    }));
    if (room.drawing > room.stage) {
      fail('studio-phone', `the drawing opens ${room.drawing}px wide in a ${room.stage}px stage`);
    }
    if (room.page > room.window) {
      fail('studio-phone', `the studio is ${room.page}px wide on a ${room.window}px screen, so the page scrolls sideways`);
    }
    if (room.drawing < room.stage * 0.7) {
      fail('studio-phone', `the drawing opens ${room.drawing}px wide in a ${room.stage}px stage, smaller than it needs to be`);
    }
    const zoomNow = () => pp.locator('#zoomlevel').innerText({ timeout: 20000 });
    log(`    opens ${room.drawing}px wide in a ${room.stage}px stage, at ${await zoomNow()}`);
    await shot(pp, 'studio-phone');

    // The first screen has to hold the drawing and something to draw with.
    // Before the reorder it held two paragraphs of prose and no control at
    // all, with the nearest button more than a screen further down.
    const reach = await evalIn(pp, 'what the first screen holds', () => {
      const box = (selector) => {
        const found = document.querySelector(selector);
        if (!found) return null;
        const rect = found.getBoundingClientRect();
        return { top: Math.round(rect.top + window.scrollY), bottom: Math.round(rect.bottom + window.scrollY) };
      };
      return {
        fold: window.innerHeight,
        page: document.documentElement.scrollHeight,
        canvas: box('#view'),
        tool: box('#toolrow .tool'),
        swatch: box('.palettebar .swatch'),
        colours: box('#allcolours')
      };
    });
    if (!reach.canvas) fail('studio-phone', 'there is no drawing on the page');
    if (reach.canvas.top > 700) fail('studio-phone', `the canvas starts ${reach.canvas.top}px down the page`);
    for (const [what, where] of [
      ['a tool', reach.tool],
      ['the colour in hand', reach.swatch],
      ['the way to all the colours', reach.colours]
    ]) {
      if (!where) fail('studio-phone', `${what} is not on the page at all`);
      if (where.bottom > reach.fold) {
        fail('studio-phone', `${what} ends ${where.bottom}px down, past the ${reach.fold}px fold`);
      }
    }
    log(
      `    canvas at ${reach.canvas.top}px, with a tool and the colours above the ${reach.fold}px fold ` +
        `(the whole editor is ${reach.page}px tall)`
    );

    // Choosing a tool says so, in the status line beside the drawing — before
    // this the only sign was a button two screens below the canvas.
    const statusNow = () => pp.locator('#status').innerText({ timeout: 20000 });
    for (const [tool, word] of [['fill', 'Fill'], ['pencil', 'Pencil']]) {
      await pp.locator(`#toolrow .tool[data-tool="${tool}"]`).click({ timeout: 20000 });
      await sleep(150);
      const said = (await statusNow()).trim();
      if (!said.startsWith(word)) fail('studio-phone', `choosing ${word} left the status line saying "${said}"`);
      const chosen = await evalIn(pp, 'the tool that looks chosen', () =>
        document.querySelector('#toolrow .tool.on')?.dataset.tool ?? null
      );
      if (chosen !== tool) fail('studio-phone', `choosing ${word} left "${chosen}" looking like the chosen tool`);
    }
    log('    choosing a tool selects it and says so in the status line');

    // The palette bar keeps the colours lately used beside the one in hand, so
    // changing colour stops being a scroll down to a grid of sixty-four.
    const recentCount = () =>
      evalIn(pp, 'the colours lately used', () => document.querySelectorAll('#recents .swatch').length);
    const recentsBefore = await recentCount();
    for (const nth of [3, 9]) {
      await pp.locator('#allcolours').click({ timeout: 20000 });
      await sleep(150);
      await pp.locator('#palette .swatch').nth(nth).click({ timeout: 20000 });
      await sleep(200);
    }
    const recentsAfter = await recentCount();
    if (recentsAfter < 1) fail('studio-phone', 'picking two colours left the row beside the current one empty');
    log(`    picking colours fills the palette bar (${recentsBefore} -> ${recentsAfter})`);
    await shot(pp, 'studio-phone-recents');

    /** Pointer events by id, which is the studio's only input path. */
    async function pointerSteps(steps) {
      await evalIn(pp, `pointer ${steps.map((s) => `${s.type}#${s.id}`).join(', ')}`, (steps) => {
        const view = document.getElementById('view');
        for (const step of steps) {
          view.dispatchEvent(
            new PointerEvent(step.type, {
              pointerId: step.id,
              pointerType: 'touch',
              isPrimary: step.id === 1,
              clientX: step.x,
              clientY: step.y,
              buttons: step.type === 'pointerup' ? 0 : 1,
              bubbles: true,
              cancelable: true
            })
          );
        }
      }, steps);
    }

    /** A point that is over the drawing and inside the stage, whatever the
     *  zoom has done to the drawing's size. */
    async function overCanvas(dx = 0.35, dy = 0.35) {
      return evalIn(
        pp,
        'a point over the drawing',
        ({ dx, dy }) => {
          const view = document.getElementById('view').getBoundingClientRect();
          const stage = document.getElementById('stage').getBoundingClientRect();
          const left = Math.max(view.left, stage.left) + 4;
          const right = Math.min(view.right, stage.right) - 4;
          const top = Math.max(view.top, stage.top) + 4;
          const bottom = Math.min(view.bottom, stage.bottom) - 4;
          return { x: left + (right - left) * dx, y: top + (bottom - top) * dy };
        },
        { dx, dy }
      );
    }

    const PHONE_DRAFT = `mainstreet.studio.v1.${WORLD_ID}.${paintable.id}`;
    const phoneCode = () =>
      evalIn(pp, 'the saved draft', (key) => {
        try {
          return JSON.parse(localStorage.getItem(key) ?? '{}').code ?? null;
        } catch {
          return null;
        }
      }, PHONE_DRAFT);
    /** The draft is written 400ms after the drawing changes, so a claim that
     *  nothing was painted has to outwait that. */
    async function settledCode(differentFrom) {
      for (let i = 0; i < 40; i++) {
        const code = await phoneCode();
        if (code && code !== differentFrom) return code;
        await sleep(100);
      }
      return null;
    }

    const blankPhone = await settledCode(null);
    if (!blankPhone) fail('studio-phone', 'the studio never saved a draft to read the drawing back from');

    // One finger paints, exactly as it always did.
    const strokeFrom = await overCanvas(0.25, 0.25);
    await pointerSteps([{ type: 'pointerdown', id: 11, x: strokeFrom.x, y: strokeFrom.y }]);
    await pointerSteps([{ type: 'pointermove', id: 11, x: strokeFrom.x + 14, y: strokeFrom.y + 8 }]);
    await pointerSteps([{ type: 'pointerup', id: 11, x: strokeFrom.x + 14, y: strokeFrom.y + 8 }]);
    const phonePainted = await settledCode(blankPhone);
    if (!phonePainted) fail('studio-phone', 'one finger drew nothing');
    log('    one finger paints');

    // Two fingers zoom, and put back whatever the first one had started.
    const middle = await overCanvas(0.5, 0.5);
    const zoomBefore = await zoomNow();
    await pointerSteps([{ type: 'pointerdown', id: 21, x: middle.x - 30, y: middle.y }]);
    await pointerSteps([{ type: 'pointerdown', id: 22, x: middle.x + 30, y: middle.y }]);
    for (let i = 1; i <= 3; i++) {
      await pointerSteps([
        { type: 'pointermove', id: 21, x: middle.x - 30 - i * 8, y: middle.y },
        { type: 'pointermove', id: 22, x: middle.x + 30 + i * 8, y: middle.y }
      ]);
    }
    await pointerSteps([{ type: 'pointerup', id: 22, x: middle.x + 54, y: middle.y }]);
    await pointerSteps([{ type: 'pointerup', id: 21, x: middle.x - 54, y: middle.y }]);
    await sleep(800);
    const zoomAfter = await zoomNow();
    if (zoomAfter === zoomBefore) fail('studio-phone', `a pinch left the zoom at ${zoomAfter}`);
    const afterPinch = await phoneCode();
    if (afterPinch !== phonePainted) {
      fail('studio-phone', 'a pinch painted something — the stroke the first finger started was not put back');
    }
    log(`    a pinch zooms ${zoomBefore} -> ${zoomAfter} and paints nothing`);
    await shot(pp, 'studio-phone-pinched');

    // Locked, one finger belongs to the browser: it scrolls, and paints nothing.
    await pp.locator('#lock').click({ timeout: 20000 });
    await sleep(200);
    if ((await pp.locator('#lock').getAttribute('aria-pressed', { timeout: 20000 })) !== 'true') {
      fail('studio-phone', 'the Lock button did not say it was on');
    }
    const lockedFrom = await overCanvas(0.6, 0.6);
    await pointerSteps([{ type: 'pointerdown', id: 31, x: lockedFrom.x, y: lockedFrom.y }]);
    await pointerSteps([{ type: 'pointermove', id: 31, x: lockedFrom.x + 16, y: lockedFrom.y + 10 }]);
    await pointerSteps([{ type: 'pointerup', id: 31, x: lockedFrom.x + 16, y: lockedFrom.y + 10 }]);
    await sleep(800);
    if ((await phoneCode()) !== afterPinch) fail('studio-phone', 'a finger painted on a locked canvas');

    // And the point of the lock: a real finger, dragged up the canvas, scrolls
    // the page past it rather than being swallowed. Real touches this time, so
    // the browser's own touch-action handling is what is being asked.
    // Back down to a zoom the stage holds whole, so what scrolls is the page
    // and not the stage the drawing is sitting in.
    for (let i = 0; i < 12; i++) {
      const spills = await evalIn(pp, 'whether the drawing still spills out of the stage', () => {
        const stage = document.getElementById('stage');
        return stage.scrollHeight > stage.clientHeight || stage.scrollWidth > stage.clientWidth;
      });
      if (!spills) break;
      await pp.locator('#zoomout').click({ timeout: 20000 });
      await sleep(120);
    }
    await evalIn(pp, 'scrolling the phone page back to the top', () => window.scrollTo(0, 0));
    await sleep(200);
    const overDrawing = await overCanvas(0.5, 0.9);
    await touchAt(pcdp, 'touchStart', overDrawing.x, overDrawing.y);
    for (let y = overDrawing.y; y > overDrawing.y - 180; y -= 15) {
      await touchAt(pcdp, 'touchMove', overDrawing.x, y);
      await sleep(16);
    }
    await touchAt(pcdp, 'touchEnd', overDrawing.x, overDrawing.y - 180);
    await sleep(600);
    const scrolled = await evalIn(pp, 'how far the phone page scrolled', () => window.scrollY);
    if (scrolled <= 0) fail('studio-phone', 'a finger could not scroll the page past a locked canvas');
    log(`    Lock keeps one finger from painting, and lets it scroll the page (${Math.round(scrolled)}px)`);

    // Zoomed right in, every column of the drawing has to be reachable. A
    // centred scroll container quietly loses the ones off its left-hand side:
    // the overflow on the start side of a centred flex box is not added to
    // scrollWidth, so no scroll and no pinch can ever get to it.
    for (let i = 0; i < 14; i++) {
      if ((await zoomNow()).trim() === '\u00d78') break;
      await pp.locator('#zoomin').click({ timeout: 20000 });
      await sleep(80);
    }
    const edges = await evalIn(pp, 'how far the stage scrolls', () => {
      const stage = document.getElementById('stage');
      const view = document.getElementById('view');
      stage.scrollLeft = 0;
      const left = Math.round(view.getBoundingClientRect().left - stage.getBoundingClientRect().left);
      stage.scrollLeft = stage.scrollWidth;
      const right = Math.round(view.getBoundingClientRect().right - stage.getBoundingClientRect().right);
      return { left, right, scrollWidth: stage.scrollWidth, drawing: view.offsetWidth };
    });
    const zoomedTo = await zoomNow();
    if (edges.drawing > edges.scrollWidth) {
      fail('studio-phone', `at ${zoomedTo} the drawing is ${edges.drawing}px in a stage that only scrolls ${edges.scrollWidth}px`);
    }
    if (edges.left < 0) {
      fail('studio-phone', `at ${zoomedTo} the first column sits ${-edges.left}px off the left of the stage, out of reach`);
    }
    if (edges.right > 0) {
      fail('studio-phone', `at ${zoomedTo} the last column sits ${edges.right}px off the right of the stage, out of reach`);
    }
    log(`    at ${zoomedTo} both edges of the drawing are still reachable`);
    await shot(pp, 'studio-phone-zoomed');

    // --- a scene, its lights and its overlay ---------------------------------
    // Issue #73: an episode can stage a moment — the lights go up, people walk
    // in, somebody says hello — and can patch a village's one canonical map
    // behind a flag (DESIGN.md §3). All of it is data, so the harness finds
    // the episode that has a scene rather than being told which one, and
    // checks the scene against its own steps.
    const sceneEpisode = (() => {
      for (const file of readdirSync(resolve(PACK, 'episodes')).sort()) {
        if (!file.endsWith('.json') || file.startsWith('draft-')) continue;
        const candidate = readJson(resolve(PACK, 'episodes', file));
        const staged = (candidate.scenes ?? []).find((sc) => sc.on?.enter && (sc.on.requires ?? []).length === 0);
        if (!staged) continue;
        // Reached through a door, so there is somewhere to press A.
        for (const [mapId, meta] of Object.entries(WORLD.maps)) {
          const building = meta.buildings.find((b) => b.interior === staged.on.enter);
          if (building) return { id: file.slice(0, -'.json'.length), episode: candidate, scene: staged, mapId, building };
        }
      }
      return null;
    })();

    if (!sceneEpisode) {
      log('  (no episode stages a scene behind a door — skipping the scene check)');
    } else {
      const { id: sceneId, episode: sceneEp, scene, mapId: outsideMap, building } = sceneEpisode;
      log(`  a staged scene: "${scene.id}" of ${sceneId}, through ${building.id}'s door`);
      const cctx = await browser.newContext({ viewport: { width: 620, height: 900 }, deviceScaleFactor: 1 });
      const cp = await cctx.newPage();
      attach(cp, 'scene');
      await cp.goto(`${BASE}?episode=${encodeURIComponent(sceneId)}`, { waitUntil: 'load' });
      await waitUntil(cp, (st) => st.map === WORLD.start.map, 'the scene episode to start');
      for (let i = 0; i < 6 && (await snap(cp)).dialogueOpen; i++) await pressA(cp);

      // In through the door. The scene is not allowed to start until whatever
      // was on screen has closed, so nothing here races the opening card.
      if (outsideMap !== WORLD.start.map) {
        fail('scene', `"${scene.id}" is behind a door on "${outsideMap}", which is not the start map`);
      }
      // Anything this episode stages on the start map itself plays out before
      // the walk to the door does. Nothing in the demo does — the scene out
      // here waits on a flag the party sets — but a scene that fired on the
      // opening spawn would otherwise take the controls mid-walk, and that is
      // worth finding here rather than as a walk mysteriously interrupted.
      await playStagedScene(cp, sceneEp, outsideMap, scene.id);
      await walkTo(cp, 'scene', building.door, { episode: sceneEp });
      await pressA(cp);
      const inside = await waitUntil(cp, (st) => st.map === scene.on.enter, `the door into "${scene.on.enter}"`, 25000);
      log(`    walked in: ${inside.map} at ${here(inside)}`);

      // The lights, off the scene's own light step.
      const lightStep = scene.steps.find((st) => st.light)?.light;
      if (lightStep) {
        const lit = await waitUntil(
          cp,
          (st) => st.light?.mode === lightStep.mode,
          `the lights to come up "${lightStep.mode}"`,
          20000
        );
        const wanted = (lightStep.at ?? []).length;
        if (lit.light.spots !== wanted) {
          fail('scene-light', `the lights hung ${lit.light.spots} discs, expected ${wanted}`);
        }
        log(`    lights: ${lit.light.mode}, ${lit.light.spots} disc${lit.light.spots === 1 ? '' : 's'}`);
      }

      // Everybody the scene moves ends up where it sent them. The last leg of
      // a path is the tile that matters; the rest is how they got there.
      const moves = scene.steps.filter((st) => st.move && st.move.who !== 'player').map((st) => st.move);
      const startedAt = new Map(
        moves.map((mv) => {
          const npc = sceneEp.npcs.find((n) => n.id === mv.who);
          return [mv.who, npc ? [npc.pos[0], npc.pos[1]] : null];
        })
      );
      for (const move of moves) {
        const goal = move.path ? move.path[move.path.length - 1] : move.to;
        const arrived = await waitUntil(
          cp,
          (st) => {
            const who = (st.people ?? []).find((p) => p.id === move.who);
            return Boolean(who) && Math.hypot(who.x - goal[0], who.y - goal[1]) < 0.2;
          },
          `"${move.who}" to walk to ${goal}`,
          40000
        );
        const from = startedAt.get(move.who);
        const who = arrived.people.find((p) => p.id === move.who);
        if (from && Math.hypot(who.x - from[0], who.y - from[1]) < 1) {
          fail('scene-move', `"${move.who}" never left ${from}`);
        }
        log(`    "${move.who}" walked from ${from} to ${goal}`);
      }
      await shot(cp, 'scene-party');

      // The line of welcome, said by whoever the step names.
      const sayStep = scene.steps.find((st) => st.say)?.say;
      if (sayStep) {
        const talking = await waitUntil(cp, (st) => st.dialogueOpen, 'the scene to say its line', 40000);
        const speaker = sayStep.who ? sceneEp.npcs.find((n) => n.id === sayStep.who)?.name : COPY.ui.narrator;
        if (talking.dialogue?.speaker !== speaker) {
          fail('scene-say', `the box named "${talking.dialogue?.speaker}", expected "${speaker}"`);
        }
        if (talking.dialogue?.text !== sayStep.lines[0]) {
          fail('scene-say', `the box reads "${talking.dialogue?.text}", expected "${sayStep.lines[0]}"`);
        }
        log(`    ${speaker} — "${talking.dialogue.text}"`);
        await advanceDialogue(cp, 'scene-say', sayStep.lines.length);
      }

      // The toast, and the flag the scene records itself with.
      const toastStep = scene.steps.find((st) => st.toast !== undefined)?.toast;
      if (toastStep) {
        const toasted = await waitUntil(cp, (st) => st.toast === toastStep, `the toast "${toastStep}"`, 20000);
        log(`    toast: "${toasted.toast}"`);
      }
      const ran = await waitUntil(
        cp,
        (st) => st.scene === null && st.flags[`scene:${scene.id}`] === true,
        `the scene to finish and record "scene:${scene.id}"`,
        30000
      );
      for (const set of scene.steps.filter((st) => st.set).map((st) => st.set)) {
        expectFlag(ran, 'scene-flags', set);
      }
      log(`    scene over: scene:${scene.id} is set, and so is every flag it sets`);

      // Back out the door: an overlay whose flag the scene set is on the map
      // now, and its prop reads. Nothing about it was saved — it is derived
      // from the flags, which is the whole point (DESIGN.md §3).
      await waitUntil(
        cp,
        (st) => st.map === outsideMap,
        `the way back out to "${outsideMap}"`,
        30000,
        async () => {
          const st = await snap(cp);
          if (st.map === scene.on.enter && !st.locked && !st.dialogueOpen) {
            await walkTo(cp, 'scene-out', building.enter, { episode: sceneEp, allowInterrupt: true });
            await cp.keyboard.down(KEY.down);
            await sleep(400);
            await cp.keyboard.up(KEY.down);
          }
        }
      );
      // The threshold card is still up on the frame the map changes, and it is
      // the card, not the scene, that clears first: a scene staged out here
      // only starts once the card is down, and its box opens a frame or two
      // after that. Polling for "is a box open yet" right here would find
      // nothing and walk straight into the line as it arrived, so what is
      // waited for is the scene the episode actually stages, by name.
      await waitUntil(cp, (st) => !st.locked, 'the threshold card to clear', 20000);
      await playStagedScene(cp, sceneEp, outsideMap, scene.id);
      const outside = await snap(cp);
      const expectOverlays = (sceneEp.overlays ?? [])
        .filter((o) => o.map === outsideMap && (o.requires ?? []).every((f) => outside.flags[f]))
        .map((o) => o.id);
      for (const id of expectOverlays) {
        if (!outside.overlays.includes(id)) {
          fail('overlay', `overlay "${id}" is not on "${outsideMap}": ${JSON.stringify(outside.overlays)}`);
        }
      }
      log(`    outside again: overlays ${JSON.stringify(outside.overlays)}`);
      await shot(cp, 'scene-overlay');

      // The harness's own idea of the ground has to follow the overlay too,
      // or it will happily route the player through a chalkboard.
      noteOverlays(sceneEp, outside.flags);

      const prop = (sceneEp.overlays ?? []).find(
        (o) => expectOverlays.includes(o.id) && (o.props ?? []).length
      )?.props?.[0];
      if (prop) {
        // Somewhere beside it to read it from: not a doorstep and not a
        // plaque tile, both of which answer A themselves (DESIGN.md §2).
        const meta = WORLD.maps[outsideMap];
        const taken = new Set();
        for (const b of meta.buildings) {
          taken.add(`${b.door[0]},${b.door[1]}`);
          const pl = plaqueOf(b);
          if (pl) taken.add(`${pl[0]},${pl[1]}`);
        }
        const away = exitTiles(meta);
        const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([dx, dy]) => [prop.pos[0] + dx, prop.pos[1] + dy])
          .find(
            (t) =>
              !isSolid(meta, t[0], t[1]) &&
              !taken.has(`${t[0]},${t[1]}`) &&
              !away.has(`${t[0]},${t[1]}`) &&
              !fixtureAt(outsideMap, t[0], t[1])
          );
        if (!beside) fail('overlay-prop', `nowhere to stand beside the prop at ${prop.pos}`);
        await walkTo(cp, 'overlay-prop', beside, { episode: sceneEp });
        await pressA(cp);
        const read = await expectDialogue(cp, 'overlay-prop', "the overlay's prop");
        if (read.dialogue?.text !== prop.lines[0]) {
          fail('overlay-prop', `the prop reads "${read.dialogue?.text}", expected "${prop.lines[0]}"`);
        }
        log(`    and it reads: "${read.dialogue.text}"`);
        await advanceDialogue(cp, 'overlay-prop', prop.lines.length);
      }
      // Back to the plain map for whatever runs after this.
      overlaySolid.clear();
      await cctx.close();
    }

    // --- an episode's own opening card (issue #37) ---------------------------
    // The world's intro (copy.json) is episode-neutral; each episode may add
    // its own `intro` lines after it (DESIGN.md §3), shown on the same card.
    // The boot section above already checked this for PLAYTEST_EPISODE (ep000
    // by default) — its own line, not some other episode's leftover. This
    // checks a second, different episode by id, so a hard-coded line that
    // happened to still be right for ep000 would not slip through unnoticed.
    {
      const otherId = PLAYTEST_EPISODE === 'ep001' ? 'ep000' : 'ep001';
      const otherFile = resolve(PACK, 'episodes', `${otherId}.json`);
      if (existsSync(otherFile)) {
        log(`  the opening card for "${otherId}"`);
        const other = readJson(otherFile);
        const octx = await browser.newContext({ viewport: { width: 620, height: 900 }, deviceScaleFactor: 1 });
        const op = await octx.newPage();
        attach(op, 'other-intro');
        try {
          await op.goto(`${BASE}?episode=${encodeURIComponent(otherId)}`, { waitUntil: 'load' });
          await waitUntil(op, (s) => s.dialogueOpen, `"${otherId}"'s intro to open`);
          const otherLines = [...(COPY.intro?.lines ?? []), ...(other.intro ?? [])];
          const otherPages = await readDialogue(op, 'other-intro', otherLines.length, async (i) => {
            const on = (await snap(op)).dialogue;
            if (on?.text !== otherLines[i]) {
              fail('other-intro', `"${otherId}" intro page ${i + 1} reads "${on?.text}", expected "${otherLines[i]}"`);
            }
          });
          if (otherPages !== otherLines.length) {
            fail('other-intro', `"${otherId}" intro read ${otherPages} page(s) for ${otherLines.length} line(s)`);
          }
          log(`    "${otherId}"'s own line: "${(other.intro ?? []).at(-1) ?? '(none)'}"`);
        } finally {
          await octx.close();
        }
      }
    }

    // --- townspeople who walk -----------------------------------------------
    // A village has people in it who belong to no story: they stroll a route or
    // potter about a corner, stop when somebody comes over, say one kind line,
    // and carry on (DESIGN.md §2). All of it is world data, so who the harness
    // follows is found in world.json rather than named here.
    const strollMap = WORLD.start.map;
    const stroller = (WORLD.maps[strollMap].people ?? []).find((p) => p.route?.path?.length >= 2);
    if (!stroller) {
      log('  (nobody walks a route on the start map — skipping the strollers)');
    } else {
      log(`  a townsperson who walks: "${stroller.id}" on ${strollMap}`);
      const sctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: false,
        deviceScaleFactor: 1
      });
      const sp = await sctx.newPage();
      attach(sp, 'walk');
      const scdp = await sctx.newCDPSession(sp);
      await sp.goto(GAME_URL, { waitUntil: 'load' });
      await waitUntil(sp, (s) => s.map === strollMap, 'the start map, with the townspeople on it');
      for (let i = 0; i < 6 && (await snap(sp)).dialogueOpen; i++) {
        await tapEl(scdp, sp, '#stage');
        await sleep(320);
      }
      if ((await snap(sp)).dialogueOpen) fail('walkers', 'the intro never closed on the strollers page');
      await watchTaps(sp);

      const whereIs = async (id) => {
        const state = await snap(sp);
        const found = (state.people ?? []).find((p) => p.id === id);
        if (!found) fail('walkers', `the engine published nobody called "${id}" on "${state.map}"`);
        return found;
      };

      // They move on their own, with the player right across the village.
      const before = await whereIs(stroller.id);
      await shot(sp, 'stroller-before');
      await sleep(3000);
      const after = await whereIs(stroller.id);
      const covered = Math.hypot(after.x - before.x, after.y - before.y);
      if (covered < 1) {
        fail(
          'walkers',
          `"${stroller.id}" covered ${covered.toFixed(2)} tiles in three seconds — ` +
            `${[before.x, before.y]} to ${[after.x, after.y]}`
        );
      }
      log(`    covered ${covered.toFixed(1)} tiles in 3s with nobody near`);
      await shot(sp, 'stroller-walking');

      // Somewhere to watch from: three tiles off the route, one further than
      // the reach at which somebody stops to say hello.
      const leg = stroller.route.path;
      const mid = [Math.round((leg[0][0] + leg[1][0]) / 2), Math.round((leg[0][1] + leg[1][1]) / 2)];
      const exits = exitTiles(WORLD.maps[strollMap]);
      const standing = here(await snap(sp));
      const readable = readableTiles(strollMap);
      let spot = null;
      for (const [dx, dy] of [[0, 3], [0, -3], [3, 0], [-3, 0], [0, 4], [0, -4], [4, 0], [-4, 0]]) {
        const tile = [mid[0] + dx, mid[1] + dy];
        if (isSolid(WORLD.maps[strollMap], tile[0], tile[1])) continue;
        if (fixtureAt(strollMap, tile[0], tile[1])) continue;
        if (exits.has(`${tile[0]},${tile[1]}`) || readable.has(`${tile[0]},${tile[1]}`)) continue;
        if (!findPath(strollMap, standing, tile)) continue;
        spot = tile;
        break;
      }
      if (!spot) fail('walkers', `nowhere to stand and watch "${stroller.id}" go past, near ${mid}`);
      await walkTo(sp, 'walkers', spot);
      log(`    watching from ${spot}, three tiles off their route`);

      // Wait for them to come past, then tap them where they are now: the walk
      // follows them if they carry on, and talks to them on arrival.
      const seen = await waitUntil(
        sp,
        (s) => {
          const p = (s.people ?? []).find((q) => q.id === stroller.id);
          return Boolean(p) && Math.hypot(p.x - s.x, p.y - s.y) <= 6;
        },
        `"${stroller.id}" to come past the watching spot`,
        60000
      );
      const passing = (seen.people ?? []).find((p) => p.id === stroller.id);
      log(`    they came past at ${passing.x.toFixed(1)},${passing.y.toFixed(1)}`);

      /**
       * Aims at the middle of somebody's *picture*, worked out inside the page
       * so that reading where they are and turning it into a point on the
       * canvas is one round trip — somebody walking cannot get out from under
       * the finger in between. A person is drawn 16x32 standing on their tile
       * (engine/scenes/map.ts `personBox`), so their chest is half a tile
       * above the tile they are on, at whatever sub-tile position they have
       * walked to.
       */
      async function pointOfPerson(page, id) {
        const point = await page.evaluate((wanted) => {
          const s = window.__mainstreet;
          const canvas = document.querySelector('#stage canvas');
          const who = (s?.people ?? []).find((q) => q.id === wanted);
          if (!s?.view || !canvas || !who) return null;
          const r = canvas.getBoundingClientRect();
          const v = s.view;
          const wx = who.x * v.tile + v.tile / 2;
          const wy = who.y * v.tile;
          return {
            x: r.left + ((wx - v.x) / v.width) * r.width,
            y: r.top + ((wy - v.y) / v.height) * r.height,
            at: [who.x, who.y]
          };
        }, id);
        if (!point) fail('walkers', `"${id}" is not on screen to aim at`);
        return point;
      }

      /** waitUntil, but a timeout is an answer rather than a failure. */
      async function tryUntil(page, predicate, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const state = await snap(page);
          if (state && predicate(state)) return state;
          await sleep(25);
        }
        return null;
      }

      // A finger that comes down beside somebody walking is a miss, and a real
      // player would simply tap again. What happens once it lands on them is
      // what this section is about, and all of that is exact.
      let talking = null;
      let hailed = null;
      for (let attempt = 1; attempt <= 3 && !talking; attempt++) {
        const point = await pointOfPerson(sp, stroller.id);
        await Promise.all([
          touchAt(scdp, 'touchStart', point.x, point.y),
          touchAt(scdp, 'touchEnd', point.x, point.y)
        ]);
        // Tapped, they wait: the engine hails whoever a walk is aimed at, so
        // walking over to somebody is never walking over to where they were.
        await sleep(120);
        hailed = await whereIs(stroller.id);
        talking = await tryUntil(sp, (s) => s.dialogueOpen, 12000);
        if (!talking) {
          log(`    (tap ${attempt} came down beside them at ${point.at.map((n) => n.toFixed(1))} — aiming again)`);
          await sleep(600);
        }
      }
      if (!talking) fail('walkers', `three taps in a row never got a word out of "${stroller.id}"`);
      const waited = (talking.people ?? []).find((p) => p.id === stroller.id);
      if (!waited || Math.hypot(waited.x - hailed.x, waited.y - hailed.y) > 0.05) {
        fail(
          'walkers',
          `"${stroller.id}" carried on walking while the player crossed to them: ` +
            `${[hailed.x, hailed.y]} -> ${[waited?.x, waited?.y]}`
        );
      }
      const aim = [Math.round(hailed.x), Math.round(hailed.y)];
      const lines = COPY.ui.passerby ?? [];
      const trivia = COPY.ui.trivia ?? [];
      if (!lines.length) fail('walkers', 'copy.json has no ui.passerby for a townsperson to say');
      if (!lines.includes(talking.dialogue?.text) && !trivia.includes(talking.dialogue?.text)) {
        fail('walkers', `"${stroller.id}" said "${talking.dialogue?.text}", which is not one of ui.passerby or ui.trivia`);
      }
      // Somebody the player is passing rather than being introduced to: the
      // box carries the world's own word for them (copy.json ui.passerbyName).
      const passerbyName = COPY.ui.passerbyName ?? '';
      if (talking.dialogue?.speaker !== (stroller.name ?? passerbyName)) {
        fail(
          'walkers',
          `the box named "${stroller.id}" "${talking.dialogue?.speaker}", expected "${stroller.name ?? passerbyName}"`
        );
      }
      log(`    tapped them at ${aim} and walked over: ${talking.dialogue?.speaker} — "${talking.dialogue?.text}"`);
      await shot(sp, 'stroller-tapped');
      await advanceDialogue(sp, 'walkers', 1);

      // Standing beside somebody stops them: nobody walks off mid-sentence.
      const held = await whereIs(stroller.id);
      await sleep(1500);
      const stillHeld = await whereIs(stroller.id);
      const drift = Math.hypot(stillHeld.x - held.x, stillHeld.y - held.y);
      if (drift > 0.05) {
        fail('walkers', `"${stroller.id}" wandered off ${drift.toFixed(2)} tiles with the player standing beside them`);
      }
      log('    stood still while the player was beside them');
      await shot(sp, 'stroller-stopped');

      // And A says the same line again, without a tap.
      await pressA(sp);
      const pressed = await expectDialogue(sp, 'walkers', `"${stroller.id}" on A`);
      if (!lines.includes(pressed.dialogue?.text) && !trivia.includes(pressed.dialogue?.text)) {
        fail('walkers', `A on "${stroller.id}" said "${pressed.dialogue?.text}", which is not one of ui.passerby or ui.trivia`);
      }
      log(`    A says it again: "${pressed.dialogue?.text}"`);
      await advanceDialogue(sp, 'walkers', 1);

      // Step away and they pick their walk back up.
      await walkTo(sp, 'walkers', spot);
      const resumeFrom = await whereIs(stroller.id);
      await sleep(3000);
      const resumeTo = await whereIs(stroller.id);
      const resumed = Math.hypot(resumeTo.x - resumeFrom.x, resumeTo.y - resumeFrom.y);
      if (resumed < 1) {
        fail('walkers', `"${stroller.id}" never picked their walk back up: ${resumed.toFixed(2)} tiles in three seconds`);
      }
      log(`    walked on again once the player stepped away (${resumed.toFixed(1)} tiles in 3s)`);
      await shot(sp, 'stroller-resumed');
    }

    // --- the site's front page ----------------------------------------------
    // dist/index.html is written by scripts/build-site.mjs out of the world
    // packs and this repo's own files, never out of anything typed into the
    // script (hard rule 1), so what it carries is checked here against the pack
    // on disk. MS_PAGES_ONLY=1 writes that page and the contributing page and
    // skips the Vite builds, which keeps this to about a second.
    log('  The front page');
    const site = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'build-site.mjs')], {
      cwd: ROOT,
      env: { ...process.env, MS_PAGES_ONLY: '1' },
      encoding: 'utf8'
    });
    if (site.status !== 0) {
      fail('landing', `build-site.mjs exited ${site.status}: ${(site.stderr ?? '').trim() || 'no output'}`);
    }
    const landingFile = resolve(ROOT, 'dist', 'index.html');
    if (!existsSync(landingFile)) fail('landing', 'the build wrote no dist/index.html');

    const landingCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: false,
      deviceScaleFactor: 1
    });
    const lp = await landingCtx.newPage();
    attach(lp, 'landing');
    await lp.goto(pathToFileURL(landingFile).href, { waitUntil: 'load' });

    const readLinks = (page) =>
      evalIn(page, 'the links on the page', () =>
        Array.from(document.querySelectorAll('a')).map((a) => ({
          href: a.getAttribute('href') ?? '',
          text: (a.textContent ?? '').replace(/\s+/g, ' ').trim()
        }))
      );
    const links = await readLinks(lp);
    const wants = (what, test) => {
      const found = links.find(test);
      if (!found) fail('landing', `no ${what} on the front page — it links to: ${links.map((l) => l.href).join(', ')}`);
      return found;
    };

    const play = wants(`"Play" link for "${WORLD_ID}"`, (l) => l.href.endsWith(`/${WORLD_ID}/`) && /Play/.test(l.text));
    wants('link to the Studio', (l) => l.href.includes('/studio/'));
    wants('link to the contributing page', (l) => /\/contributing\/$/.test(l.href));
    wants('link to the repository', (l) => /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(l.href));
    wants('link to the code licence', (l) => /\/LICENSE$/.test(l.href));
    wants('link to the content licence', (l) => /\/LICENSE-CONTENT\.md$/.test(l.href));
    const writeTo = WORLD.feedback?.url ?? (WORLD.feedback?.email ? `mailto:${WORLD.feedback.email}` : null);
    if (writeTo) wants('"Write to us" link', (l) => l.href.startsWith(writeTo) && /Write to us/i.test(l.text));
    log(`    "${play.text}" goes to ${play.href}, and the Studio, licences and repository are all linked`);

    // Everyone whose painting is in the game is named on the front page, and
    // the page reads the credits the way the plaque does — a name or a list of
    // them, and only once the building actually has its PNG (DESIGN.md §4).
    const creditsFile = resolve(PACK, 'credits.json');
    const credited = existsSync(creditsFile) ? (readJson(creditsFile).buildings ?? {}) : {};
    const paintedIds = Object.keys(credited).filter((id) =>
      existsSync(resolve(PACK, 'assets', 'buildings', `${id}.png`))
    );
    if (!paintedIds.length) fail('landing', 'this world pack has no painted building for the front page to credit');
    const words = await evalIn(lp, "the front page's words", () => document.body.innerText.replace(/\s+/g, ' '));
    if (!words.includes('Painted so far')) fail('landing', 'the front page has no "Painted so far" list');
    for (const id of paintedIds) {
      const name = WORLD.buildings?.[id]?.name ?? id;
      if (!words.includes(name)) fail('landing', `"Painted so far" never names ${name}`);
      for (const painter of [].concat(credited[id])) {
        if (!words.includes(painter)) fail('landing', `${name} is listed without its painter, ${painter}`);
      }
    }
    log(`    "Painted so far" names ${paintedIds.length} building(s) and everyone who painted them`);

    // A phone is where this page is read, so nothing anyone has to hit is
    // smaller than a fingertip (CLAUDE.md #4).
    const tooSmall = await evalIn(lp, 'how tall the links are on a phone', () =>
      Array.from(document.querySelectorAll('ul.towns a, p.do a, ul.links a'))
        .filter((a) => a.getBoundingClientRect().height < 44)
        .map((a) => `${(a.textContent ?? '').trim()} (${Math.round(a.getBoundingClientRect().height)}px)`)
    );
    if (tooSmall.length) fail('landing', `links too small to tap on a phone: ${tooSmall.join('; ')}`);
    const overflow = await evalIn(lp, 'whether the page fits the phone sideways', () =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 0) fail('landing', `the front page is ${overflow}px wider than a 390px phone`);
    log('    every link is a finger tall, and nothing spills off a 390px screen');
    await shot(lp, 'landing-phone', { fullPage: true });

    // And the way out of the contributing page: back to the front page.
    const contributingFile = resolve(ROOT, 'dist', 'contributing', 'index.html');
    if (!existsSync(contributingFile)) fail('landing', 'the build wrote no dist/contributing/index.html');
    await lp.goto(pathToFileURL(contributingFile).href, { waitUntil: 'load' });
    const backLinks = await readLinks(lp);
    if (!backLinks.some((l) => /mainstreet/i.test(l.text) && l.href.startsWith('/'))) {
      fail('landing', 'the contributing page has no link back to the front page');
    }
    // Its tables are the widest thing on either page, and a table that walks
    // off the side of a phone takes the whole page with it.
    const sideways = await evalIn(lp, 'whether the contributing page fits the phone', () =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (sideways > 0) fail('landing', `the contributing page is ${sideways}px wider than a 390px phone`);
    log('    the contributing page links back to the front page, and fits a phone sideways');
    await shot(lp, 'contributing-phone', { fullPage: true });
    await landingCtx.close();

    const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const dp = await deskCtx.newPage();
    attach(dp, 'landing-desktop');
    await dp.goto(pathToFileURL(landingFile).href, { waitUntil: 'load' });
    await shot(dp, 'landing-desktop', { fullPage: true });
    await deskCtx.close();
    // --- ambient cars --------------------------------------------------------
    // A village's paved routes carry traffic (DESIGN.md §2, issue #72). A car
    // drives on its own, gives way to somebody standing in its lane, picks
    // its trip back up when they step off, and is never a hazard: one that
    // goes by leaves the player exactly where they were, with the same flags.
    // Like the strollers, which car the harness follows is found in world.json.
    const carMap = WORLD.start.map;
    const carData = (WORLD.maps[carMap].vehicles ?? []).find((v) => (v.path ?? []).length >= 2);
    if (!carData) {
      log('  (no traffic on the start map — skipping the cars)');
    } else {
      const lane = carData.path[0][1] === carData.path[1][1] ? 'row' : 'column';
      log(`  a car on ${carMap}: "${carData.id}", first leg along one ${lane}`);
      // A window big enough for the engine to spend its third zoom step,
      // which is where a car on a state route reads properly.
      const cctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
      const cp = await cctx.newPage();
      attach(cp, 'cars');
      await cp.goto(GAME_URL, { waitUntil: 'load' });
      await waitUntil(cp, (s) => s.map === carMap, 'the start map, with the traffic on it');
      for (let i = 0; i < 6 && (await snap(cp)).dialogueOpen; i++) await pressA(cp);
      if ((await snap(cp)).dialogueOpen) fail('cars', 'the intro never closed on the cars page');
      const zoom = await evalIn(cp, 'the zoom the cars page is drawn at', () => {
        const canvas = document.querySelector('#stage canvas');
        return Math.round(canvas.width / window.__mainstreet.view.width);
      });
      if (zoom !== 3) fail('cars', `the cars page came up at zoom ${zoom}, not the 3 the shots are meant to be at`);
      log(`    drawn at zoom ${zoom}`);

      const whereIsCar = async (id) => {
        const state = await snap(cp);
        const found = (state.vehicles ?? []).find((v) => v.id === id);
        if (!found) fail('cars', `the engine published no car called "${id}" on "${state.map}"`);
        return found;
      };

      /**
       * How far a car covers, added up poll by poll rather than measured end
       * to end. Two reasons for the adding up: a car that turns at the end of
       * its leg and comes back has barely moved as the crow flies but has very
       * much been driving, and a slow machine polls at whatever rate it can
       * manage. `want` tiles ends the watch early and is what the checks below
       * wait on; `ms` is only how long to keep looking.
       *
       * Nothing here counts frames or assumes a frame rate: the engine
       * publishes where the car *is*, and this reads that, so the same numbers
       * come out of a fast laptop and a loaded CI runner.
       */
      const drivenBy = async (id, want, ms, why) => {
        const t0 = Date.now();
        let last = await whereIsCar(id);
        let total = 0;
        while (Date.now() - t0 < ms) {
          await sleep(60);
          const now = await whereIsCar(id);
          total += Math.hypot(now.x - last.x, now.y - last.y);
          last = now;
          if (total >= want) return { tiles: total, ms: Date.now() - t0 };
        }
        fail(
          'cars',
          `"${id}" covered ${total.toFixed(2)} tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
            `and is sitting at ${[last.x, last.y]} — ${why}`
        );
      };

      // It sets off on its own, with the player nowhere near it. A car stands
      // at a waypoint for a beat before each leg (`pause`), so this waits for
      // it to be under way rather than starting a stopwatch on the chance that
      // it already is — which is exactly what a slower machine gets wrong.
      const away = await drivenBy(carData.id, 1, 30000, 'it never set off with nobody near it');
      log(`    set off on its own: ${away.tiles.toFixed(1)} tiles in ${(away.ms / 1000).toFixed(1)}s`);
      const on = await drivenBy(carData.id, 4, 20000, 'it set off and then stopped with nobody near it');
      log(`    kept going: ${on.tiles.toFixed(1)} more tiles in ${(on.ms / 1000).toFixed(1)}s`);

      // Two places to stand, both found from the car's own first leg rather
      // than written down: one *in* its lane, and one beside it on the next
      // line over, which the car has no reason to stop for.
      const [a, b] = carData.path;
      const alongX = a[1] === b[1];
      const exits = exitTiles(WORLD.maps[carMap]);
      const readable = readableTiles(carMap);
      const standing = here(await snap(cp));
      // The other lane of the same route: one tile the way the car turns at
      // the end of its leg, which is where the centre line is.
      const over = alongX ? [0, carData.path[2] ? Math.sign(carData.path[2][1] - a[1]) : -1] : [carData.path[2] ? Math.sign(carData.path[2][0] - a[0]) : -1, 0];
      const usable = (tile) => {
        if (isSolid(WORLD.maps[carMap], tile[0], tile[1])) return false;
        if (fixtureAt(carMap, tile[0], tile[1])) return false;
        if (exits.has(`${tile[0]},${tile[1]}`) || readable.has(`${tile[0]},${tile[1]}`)) return false;
        // Clear of any other car's route, so only the car being watched is in play.
        for (const other of WORLD.maps[carMap].vehicles ?? []) {
          if (other.id === carData.id) continue;
          for (const point of other.path ?? []) {
            if (Math.abs(point[0] - tile[0]) <= 3 && Math.abs(point[1] - tile[1]) <= 3) return false;
          }
        }
        return Boolean(findPath(carMap, standing, tile));
      };

      let inLane = null;
      let beside = null;
      const span = alongX ? [a[0], b[0]] : [a[1], b[1]];
      const step = span[1] > span[0] ? 1 : -1;
      // Well inside the leg, so the car is at speed rather than turning.
      for (let n = Math.round(Math.abs(span[1] - span[0]) * 0.45); n > 3 && !inLane; n--) {
        const at = span[0] + n * step;
        const tile = alongX ? [at, a[1]] : [a[0], at];
        const next = [tile[0] + over[0], tile[1] + over[1]];
        if (usable(tile) && usable(next)) {
          inLane = tile;
          beside = next;
        }
      }
      if (!inLane) fail('cars', `nowhere on "${carData.id}"'s first leg to stand and watch it`);

      // Beside the lane, on the line the car does not drive on: it goes past
      // without stopping, and nothing about the player changes when it does.
      await walkTo(cp, 'cars', beside);
      // Walking over may have crossed the lane and stopped the car; give it
      // its road back before watching for it.
      await drivenBy(carData.id, 1, 30000, 'it never picked up again after the player crossed the road');
      const before = await snap(cp);
      const wasAt = here(before);
      const wasFlags = JSON.stringify(before.flags);
      log(`    standing at ${wasAt}, one line over from the lane`);

      // "It went past" is a crossing, not a near miss: which side of the
      // player it is on has to flip. A slow machine polls slowly, and a car
      // can cover several tiles between two polls, so waiting to *catch* it
      // alongside would be waiting on the sampling rate. Being within a tile
      // still ends the wait first when the polling is quick enough, because
      // that is the frame worth photographing.
      const axis = alongX ? 'x' : 'y';
      const cross = alongX ? 'y' : 'x';
      let side = null;
      let closest = Infinity;
      // Roughly a dozen seconds between passes — the car comes by on one lane
      // and then the other — so the wait is minutes of headroom, not a guess.
      const sawItAt = Date.now();
      const passing = await waitUntil(
        cp,
        (state) => {
          const v = (state.vehicles ?? []).find((q) => q.id === carData.id);
          if (!v) return false;
          // Only while it is on one of the lanes beside the player: the far
          // side of the loop crosses the same line and is not this pass.
          if (Math.abs(v[cross] - state[cross]) > 1.2) {
            side = null;
            return false;
          }
          closest = Math.min(closest, Math.hypot(v.x - state.x, v.y - state.y));
          if (closest <= 1) return true;
          const now = Math.sign(v[axis] - state[axis]);
          if (now === 0) return true;
          if (side === null) side = now;
          return now !== side;
        },
        `"${carData.id}" to come past the watching spot`,
        90000
      );
      const waitedToPass = ((Date.now() - sawItAt) / 1000).toFixed(1);
      await shot(cp, 'car-passing');
      const went = (passing.vehicles ?? []).find((v) => v.id === carData.id);
      if (went.stopped) fail('cars', `"${carData.id}" stopped for somebody who was not even in its lane`);
      if (JSON.stringify(passing.flags) !== wasFlags) {
        fail('cars', `a car going by set a flag: ${wasFlags} -> ${JSON.stringify(passing.flags)}`);
      }
      const nudged = Math.hypot(passing.x - before.x, passing.y - before.y);
      if (nudged > 0.01 || String(here(passing)) !== String(wasAt)) {
        fail('cars', `a car going by moved the player ${nudged.toFixed(2)} tiles, ${wasAt} -> ${here(passing)}`);
      }
      log(
        `    it went by after ${waitedToPass}s (${closest === Infinity ? 'a crossing' : `${closest.toFixed(1)} tiles off`}) ` +
          'without stopping, and left the player and the flags alone'
      );

      // In the lane: it sees the player, coasts to a stop and waits. Started
      // from a car that is known to be driving, so "it stopped" means it
      // stopped *for the player* rather than for its own waypoint.
      await drivenBy(carData.id, 1, 30000, 'it was not driving before the player stepped into its lane');
      await walkTo(cp, 'cars', inLane);
      log(`    standing in the lane at ${inLane}`);
      // Only one of the lanes is this one, so the wait here is a whole lap of
      // the car's route rather than half — half a minute at Route 10's pace,
      // and the allowance is five times that so a loaded machine is slow
      // rather than broken.
      const steppedInAt = Date.now();
      const held = await waitUntil(
        cp,
        (state) => {
          const v = (state.vehicles ?? []).find((q) => q.id === carData.id);
          return Boolean(v) && v.stopped && v.yielding;
        },
        `"${carData.id}" to give way to the player standing in its lane`,
        150000
      );
      const waiting = (held.vehicles ?? []).find((v) => v.id === carData.id);
      const gap = Math.hypot(waiting.x - held.x, waiting.y - held.y);
      log(
        `    it stopped ${gap.toFixed(1)} tiles short of the player and waited ` +
          `(it came round in ${((Date.now() - steppedInAt) / 1000).toFixed(1)}s)`
      );
      await shot(cp, 'car-stopped');
      if (gap < 0.5) fail('cars', `"${carData.id}" stopped on top of the player rather than behind them`);

      // And it stays stopped for as long as they stand there — watched all
      // the way through rather than looked at twice, so a crawl is caught too.
      // Read once more first: `stopped` is "throttle closed", and the last
      // fraction of a tile of coasting belongs to the stop, not to creeping.
      const parkedAt = await whereIsCar(carData.id);
      let crept = 0;
      for (let i = 0; i < 8; i++) {
        await sleep(200);
        const now = await whereIsCar(carData.id);
        crept = Math.max(crept, Math.hypot(now.x - parkedAt.x, now.y - parkedAt.y));
      }
      if (crept > 0.05) {
        fail('cars', `"${carData.id}" crept ${crept.toFixed(2)} tiles with the player still standing in front of it`);
      }
      log('    stayed put while the player stood in front of it');

      // Step off the road and it carries on.
      await walkTo(cp, 'cars', beside);
      const again = await drivenBy(carData.id, 2, 30000, 'it never pulled away again once the player stepped off');
      log(`    pulled away again once the player stepped off: ${again.tiles.toFixed(1)} tiles in ${(again.ms / 1000).toFixed(1)}s`);
    }

    log(`\n  ${PLAYTEST_EPISODE} completed end to end.`);
  } finally {
    await browser.close();
    if (server) server.kill();
    clearTimeout(watchdog);
  }

  if (consoleLines.length) {
    log('\nconsole errors/warnings:');
    for (const line of consoleLines) log('  ' + line);
  } else {
    log('\nconsole: clean (asset 404s for unpainted art, and a missing credits.json, excluded).');
  }
  if (pageErrors.length) {
    log('\npage errors:');
    for (const line of pageErrors) log('  ' + line);
    problems.push(`${pageErrors.length} uncaught page error(s)`);
  }
  if (problems.length) {
    logErr('\nFAILED: ' + problems.join('; '));
    process.exit(1);
  }
  log('\nPASS');
}

main().catch(async (err) => {
  logErr('\nFAILED ' + (err instanceof Failure ? err.message : (err?.stack ?? String(err))));
  if (pageErrors.length) {
    logErr('\npage errors:');
    for (const line of pageErrors) logErr('  ' + line);
  }
  if (consoleLines.length) {
    logErr('\nconsole errors/warnings:');
    for (const line of consoleLines) logErr('  ' + line);
  }
  logErr(`\nscreenshots + log: ${OUT}`);
  process.exit(1);
});
