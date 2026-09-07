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
 * Usage:  npx playwright install chromium   # once
 *         npm run playtest
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const ref of tiled.tilesets) {
    const tileset = readJson(resolve(dirname(file), ref.source));
    for (const tile of tileset.tiles ?? []) {
      if (tile.properties?.some((p) => p.name === 'solid' && p.value === true)) solidGid.add(ref.firstgid + tile.id);
    }
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

/** Mirrors engine/validate.ts isSolid(). */
function isSolid(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  if (map.solid[y * map.width + x]) return true;
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

/** NPCs are episode data, so MapScene.solidTile() blocks on them separately. */
function npcAt(mapId, x, y) {
  return EPISODE.npcs.some((n) => n.map === mapId && n.pos[0] === x && n.pos[1] === y);
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
function findPath(mapId, from, to) {
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
      if (isSolid(map, nx, ny) || npcAt(mapId, nx, ny) || fixtureAt(mapId, nx, ny)) continue;
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

async function shot(page, slug) {
  shotIndex += 1;
  const name = `${String(shotIndex).padStart(2, '0')}-${slug}.png`;
  const file = resolve(SHOTS, name);
  await page.screenshot({ path: file });
  log(`    shot  ${name}`);
  return file;
}

const snap = (page) => page.evaluate(() => window.__mainstreet ?? null);

async function waitUntil(page, predicate, label, timeout = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await snap(page);
    if (last && predicate(last)) return last;
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
async function walkTo(page, milestone, goal, { allowInterrupt = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await snap(page);
    if (!s) fail(milestone, 'window.__mainstreet is missing');
    const from = here(s);
    if (from[0] === goal[0] && from[1] === goal[1]) return;
    const path = findPath(s.map, from, goal);
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

    // --- no ?episode= plays the shipped episode -----------------------------
    // A quick, separate check that the default (no parameter at all) is what
    // world.json actually ships — WORLD.episodes[0], route10's ep001 — before
    // the rest of this run switches to ep000 via GAME_URL (DESIGN.md §3).
    {
      log('  boot with no ?episode= (should play the shipped episode)');
      const shippedId = WORLD.episodes[0];
      const shipped = readJson(resolve(PACK, 'episodes', `${shippedId}.json`));
      const defaultCtx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      const dp = await defaultCtx.newPage();
      attach(dp, 'default-episode');
      try {
        await dp.goto(BASE, { waitUntil: 'load' });
        try {
          await dp.waitForFunction(
            () => (document.querySelector('[data-hud="episode"]')?.textContent ?? '').trim().length > 0,
            null,
            { timeout: 20000 }
          );
        } catch {
          fail('default-episode', 'HUD episode title was never filled in with no ?episode= parameter');
        }
        const hudEpisode = (await dp.locator('[data-hud="episode"]').innerText()).trim();
        if (!hudEpisode.includes(shipped.title)) {
          fail(
            'default-episode',
            `HUD showed "${hudEpisode}" with no ?episode=; expected the shipped "${shippedId}" ("${shipped.title}")`
          );
        }
        log(`    HUD: "${hudEpisode}" (no ?episode= -> shipped ${shippedId})`);
      } finally {
        await defaultCtx.close();
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
    await advanceDialogue(page, 'boot', 3);
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

      const write = page.locator('a[data-overlay="link"]');
      if (!(await write.isVisible())) fail('suggestion-box', 'no link beside the suggestion box');
      const writeHref = (await write.getAttribute('href')) ?? '';
      if (!writeHref.startsWith('mailto:')) fail('suggestion-box', `the link href is "${writeHref}"`);
      const subject = WORLD.feedback?.subject;
      if (subject && !writeHref.includes(encodeURIComponent(subject))) {
        fail('suggestion-box', `the link carries no "${subject}" subject: "${writeHref}"`);
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
      const deskLink = page.locator('a[data-overlay="link"]');

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
     * The camera rides along with the player, so a tile is only briefly at any
     * one place on the canvas: at zoom 2 the view slides a whole tile every
     * ~160ms of walking. Everything a tap needs — the camera's view and the
     * canvas box — is therefore read in one round trip, and the aim is the
     * exact centre of the tile, which leaves half a tile of slack for whatever
     * the machine spends getting the touch back down the wire.
     */
    async function pointOfTile(page, tile) {
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
      if (!p) fail('tap-walk', 'the page has no camera view to tap into');
      if (p.x < p.box.x || p.y < p.box.y || p.x > p.box.x + p.box.width || p.y > p.box.y + p.box.height) {
        fail('tap-walk', `tile ${tile} is off screen (${JSON.stringify(p)})`);
      }
      return p;
    }

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
    const paint = tp.locator('a[data-overlay="link"]');
    if (!(await paint.isVisible())) fail('paint-it', `no "Paint it" link on ${bare.id}'s first page`);
    const href = (await paint.getAttribute('href')) ?? '';
    if (!href.endsWith(`&building=${bare.id}`)) fail('paint-it', `link href is "${href}"`);
    const paintBox = await paint.boundingBox();
    if (!paintBox || paintBox.width < 44 || paintBox.height < 24) {
      fail('paint-it', `the "Paint it" link is not a tappable size: ${JSON.stringify(paintBox)}`);
    }
    // Reachable by keyboard, and the game does not swallow the keys while it
    // has focus (CLAUDE.md #4: it is a browser control, not a game control).
    let focused = false;
    for (let i = 0; i < 4 && !focused; i++) {
      await tp.keyboard.press('Tab');
      focused = await tp.evaluate(() => document.activeElement?.matches('a[data-overlay="link"]') === true);
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

    for (const sel of ['#doorrow', '#plaquerow', '#doorleft', '#doorright', '#doorreset', '#markers']) {
      if (!(await sp.locator(sel).isVisible({ timeout: 20000 }))) fail('studio-markers', `${sel} is not on the page`);
    }
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
