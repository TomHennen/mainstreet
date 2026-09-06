#!/usr/bin/env node
/**
 * Builds the whole GitHub Pages site: one Vite build per world pack, each
 * scoped to its own sub-path and its own output directory, plus a small
 * landing page at the site root that links to them.
 *
 * A single Vite build always ships exactly one world (see vite.config.ts —
 * the worldPacks plugin copies only `VITE_WORLD`'s pack into the build). A
 * Pages *site*, though, should offer every world at its own path, e.g.
 * https://tomhennen.github.io/mainstreet/route10/. So this script runs Vite
 * once per world (by default, every directory under worlds/; pass world ids
 * as CLI args to build a subset) and stitches the results together under
 * dist/, then writes dist/index.html as the landing page.
 *
 * Usage:  node scripts/build-site.mjs [worldId ...]
 *         SITE_BASE=/mainstreet node scripts/build-site.mjs
 *
 * SITE_BASE is the path the whole site is served under (default "/" — a
 * user/org Pages site or local preview). The Pages workflow passes
 * "/${{ github.event.repository.name }}" because a project site is served at
 * https://<owner>.github.io/<repo>/.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORLDS_DIR = resolve(ROOT, 'worlds');
const DIST_DIR = resolve(ROOT, 'dist');
const VITE_BIN = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

// A trailing slash matters (it's a URL path prefix); a leading slash and no
// trailing slash is the normal form to build one from.
const rawBase = process.env.SITE_BASE ?? '/';
const SITE_BASE = rawBase.replace(/\/+$/, '');

function worldIds() {
  const requested = process.argv.slice(2);
  if (requested.length > 0) return requested;
  return readdirSync(WORLDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function buildWorld(id) {
  const outDir = resolve(DIST_DIR, id);
  const base = `${SITE_BASE}/${id}/`;
  console.log(`\n> building world "${id}" (base ${base})`);

  const result = spawnSync(
    process.execPath,
    [VITE_BIN, 'build', '--base', base, '--outDir', outDir],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, VITE_WORLD: id }
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`vite build failed for world "${id}" (exit ${result.status})`);
  }
}

function worldTitle(id) {
  const world = JSON.parse(readFileSync(resolve(WORLDS_DIR, id, 'world.json'), 'utf-8'));
  return { title: world.title ?? id, subtitle: world.subtitle ?? '' };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function renderLanding(ids) {
  const cards = ids
    .map((id) => {
      const { title, subtitle } = worldTitle(id);
      const href = `${SITE_BASE}/${id}/`;
      const sub = subtitle ? `<p>${escapeHtml(subtitle)}</p>` : '';
      return `
      <li>
        <a href="${escapeHtml(href)}">
          <h2>${escapeHtml(title)}</h2>
          ${sub}
        </a>
      </li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>mainstreet</title>
  <style>
    :root {
      --night: #12160f;
      --frame: #1d2b23;
      --paper: #f3ead8;
      --maple: #b5542a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      background: var(--frame);
      color: var(--paper);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 20px 32px;
    }
    main { width: 100%; max-width: 480px; }
    h1 {
      font-size: 22px;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    p.lede {
      opacity: 0.8;
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    ul { list-style: none; display: flex; flex-direction: column; gap: 12px; }
    li a {
      display: block;
      background: var(--night);
      border: 2px solid #4c6b58;
      border-radius: 6px;
      padding: 14px 16px;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.15s ease;
    }
    li a:hover, li a:focus-visible { border-color: var(--maple); }
    li h2 {
      font-size: 15px;
      color: var(--maple);
      margin-bottom: 4px;
    }
    li p {
      font-size: 12px;
      opacity: 0.75;
      line-height: 1.5;
    }
    footer {
      margin-top: 32px;
      font-size: 11px;
      opacity: 0.6;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <h1>mainstreet</h1>
    <p class="lede">Small, cozy walks through real places. Pick a town below and stay a while.</p>
    <ul>
${cards}
    </ul>
    <footer>More towns are always welcome.</footer>
  </main>
</body>
</html>
`;
}

function main() {
  const ids = worldIds();
  if (ids.length === 0) {
    throw new Error('no worlds found under worlds/');
  }

  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  for (const id of ids) buildWorld(id);

  writeFileSync(resolve(DIST_DIR, 'index.html'), renderLanding(ids));
  // Pages runs Jekyll by default, which ignores files/folders starting with
  // an underscore and can otherwise mangle a static site; this opts out.
  writeFileSync(resolve(DIST_DIR, '.nojekyll'), '');

  console.log(`\nBuilt ${ids.length} world(s) into ${DIST_DIR}`);
}

main();
