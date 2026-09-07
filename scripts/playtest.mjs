#!/usr/bin/env node
/**
 * Headless end-to-end playtest.
 *
 * Boots the dev server's build in Chromium, walks the player through the whole
 * of the first episode, screenshots every milestone, and exits non-zero with a
 * readable message on the first thing that goes wrong. It reads the world pack
 * from disk to path-find, and reads engine state from `window.__mainstreet`
 * (published only when `import.meta.env.DEV`, see engine/debug.ts).
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
const EPISODE = readJson(resolve(PACK, 'episodes', `${WORLD.episodes[0]}.json`));

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

/** NPCs are episode data, so MapScene.solidTile() blocks on them separately. */
function npcAt(mapId, x, y) {
  return EPISODE.npcs.some((n) => n.map === mapId && n.pos[0] === x && n.pos[1] === y);
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
      if (isSolid(map, nx, ny) || npcAt(mapId, nx, ny)) continue;
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

/** Everything the run prints also lands in playtest-out/playtest.log. */
function log(line = '') {
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
      // Collapse the path into straight runs so a key is held across a corridor.
      const dx = path[i][0] - path[i - 1][0];
      const dy = path[i][1] - path[i - 1][1];
      let j = i;
      while (j + 1 < path.length && path[j + 1][0] - path[j][0] === dx && path[j + 1][1] - path[j][1] === dy) j++;
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
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }]
  });
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
  const child = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await up()) return child;
  }
  child.kill();
  throw new Error('vite did not come up on 5173');
}

// --- the playtest ------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG, `mainstreet playtest — ${new Date().toISOString()}\n  world: ${WORLD_ID}  episode: ${EPISODE.id} \u201c${EPISODE.title}\u201d\n  url: ${BASE}\n\n`);
  const server = await ensureServer();

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });

  try {
    // PLAYTEST_VIEWPORT=1024x768 checks the desktop layout; default is a
    // tablet-ish column that exercises the stage cap.
    const [vw, vh] = (process.env.PLAYTEST_VIEWPORT ?? '620x900').split('x').map(Number);
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    attach(page, 'desktop');

    // --- boot ---------------------------------------------------------------
    log('  boot');
    await page.goto(BASE, { waitUntil: 'load' });
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

    // --- a painted building: thanks on the plaque, story on the sign ---------
    // The painter is thanked on the plaque beside the door and named on the
    // site's front page — never in the sign, where it would interrupt the copy
    // the player is reading (DESIGN.md §2/§4). So the plaque is one page of
    // thanks with no studio link, and the sign is the episode's lines and
    // nothing else.
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
      if (await deskLink.isVisible()) {
        fail('painted-plaque', `a "Paint it" link showed on painted ${painted.id}'s plaque`);
      }
      await shot(page, 'painted-plaque');
      const plaquePages = await readDialogue(page, 'painted-plaque', 1);
      if (plaquePages !== 1) fail('painted-plaque', `${painted.id}'s plaque read ${plaquePages} page(s), expected 1`);
      log(`    ${painted.id}: plaque thanks its painter in one page, no link`);

      log('  read a painted building: its sign');
      const paintedSign = (EPISODE.signs ?? []).find((s) => s.building === painted.id);
      const paintedLines = paintedSign?.lines.length ?? 0;
      if (paintedLines === 0) fail('painted-sign', `ep000 gives painted ${painted.id} no sign copy to read`);
      await walkTo(page, 'painted-sign', painted.door);
      await pressA(page);
      await expectDialogue(page, 'painted-sign', painted.id);
      if (await deskLink.isVisible()) fail('painted-sign', `a "Paint it" link showed on painted ${painted.id}`);
      await shot(page, 'painted-sign');
      const read = await readDialogue(page, 'painted-sign', paintedLines);
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
    await tp.goto(BASE, { waitUntil: 'load' });
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
    const bareSign = (EPISODE.signs ?? []).find((s) => s.building === bare.id);
    // With no sign copy this episode the engine shows one stand-in line
    // instead of an empty box, so there is always at least one page.
    const bareSignLines = bareSign?.lines.length ?? 1;
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
        const code = await sp.evaluate((key) => {
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
      if (!(await sp.locator(sel).isVisible())) fail('studio-markers', `${sel} is not on the page`);
    }
    const doorAt = async () => (await sp.locator('#doorwhere').innerText()).trim();
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
      await sp.locator(selector).scrollIntoViewIfNeeded();
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
    await sp.locator('#markers').scrollIntoViewIfNeeded();
    await sleep(150);
    const strip = await sp.locator('#markers').boundingBox();
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
    if (!(await improveButton.isVisible())) {
      fail('studio-improve', `"Improve it?" is missing on painted ${anyPainted.id}`);
    }

    const IMPROVE_DRAFT = `mainstreet.studio.v1.${WORLD_ID}.${anyPainted.id}`;
    async function improveCode(differentFrom) {
      for (let i = 0; i < 80; i++) {
        const code = await ip.evaluate((key) => {
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
    await improveButton.click();
    const filled = await improveCode(blank);
    if (filled === blank) fail('studio-improve', '"Improve it?" did not change the drawing');
    log(`    "${anyPainted.id}": clicking "Improve it?" filled the canvas from the shipped PNG`);
    // The click scrolled the "Files" row into view; scroll back up so the
    // screenshot shows the canvas with the painting now on it.
    await ip.locator('#stage').scrollIntoViewIfNeeded();
    await sleep(150);
    await shot(ip, 'improve-it');

    log('\n  ep000 completed end to end.');
  } finally {
    await browser.close();
    if (server) server.kill();
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
