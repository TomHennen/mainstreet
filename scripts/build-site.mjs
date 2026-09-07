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
 * One more page joins them: the Studio (studio/), the facade editor a
 * contributor paints a building in. It is world-agnostic — it is handed a
 * world in its query string — so it is built once, into dist/studio/, and the
 * two files it reads at runtime (world.json and palette.png) are copied in
 * beside it for every world on the site.
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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
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

function buildStudio() {
  const outDir = resolve(DIST_DIR, 'studio');
  const base = `${SITE_BASE}/studio/`;
  console.log(`\n> building the studio (base ${base})`);

  const result = spawnSync(process.execPath, [VITE_BIN, 'build', '--base', base], {
    cwd: ROOT,
    stdio: 'inherit',
    // MS_TARGET switches vite.config.ts to the studio's own root and outDir.
    env: { ...process.env, MS_TARGET: 'studio' }
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`vite build failed for the studio (exit ${result.status})`);
  return outDir;
}

/**
 * The Studio reads a world pack the way the game does, over HTTP, but it needs
 * only two files from it: world.json (names, footprints, doors) and
 * palette.png (the colours it may paint with). It also probes
 * assets/buildings/<id>.png to tell a painted building from one still waiting,
 * so that directory comes along too. Nothing else — the studio has no business
 * shipping maps or episodes.
 */
function copyStudioWorlds(studioDir, ids) {
  const root = resolve(studioDir, 'worlds');
  for (const id of ids) {
    const from = resolve(WORLDS_DIR, id);
    const to = resolve(root, id);
    mkdirSync(to, { recursive: true });

    cpSync(resolve(from, 'world.json'), resolve(to, 'world.json'));

    const world = JSON.parse(readFileSync(resolve(from, 'world.json'), 'utf-8'));
    const palette = world.palette ?? 'palette.png';
    if (existsSync(resolve(from, palette))) {
      mkdirSync(dirname(resolve(to, palette)), { recursive: true });
      cpSync(resolve(from, palette), resolve(to, palette));
    } else {
      // Not fatal: the studio says so kindly and points at the other ways in.
      console.warn(`  ! world "${id}" has no ${palette}; the studio will say so gently`);
    }

    const facades = resolve(from, 'assets', 'buildings');
    if (existsSync(facades)) {
      const painted = readdirSync(facades).filter((file) => file.endsWith('.png'));
      if (painted.length > 0) {
        mkdirSync(resolve(to, 'assets', 'buildings'), { recursive: true });
        for (const file of painted) cpSync(resolve(facades, file), resolve(to, 'assets', 'buildings', file));
      }
    }
  }
  writeFileSync(resolve(root, 'index.json'), JSON.stringify(ids));
}

function worldTitle(id) {
  const world = JSON.parse(readFileSync(resolve(WORLDS_DIR, id, 'world.json'), 'utf-8'));
  return { title: world.title ?? id, subtitle: world.subtitle ?? '' };
}

/**
 * Who painted what, for the landing page. The painter is named here (and,
 * later, on an in-game credits screen) rather than in the building's sign
 * dialogue, which belongs to the story copy (DESIGN.md §2/§4).
 *
 * Read the way the engine reads it: credits.json is optional, and a credit
 * only counts once the building actually has its PNG.
 */
function paintedSoFar(id) {
  const dir = resolve(WORLDS_DIR, id);
  const creditsFile = resolve(dir, 'credits.json');
  if (!existsSync(creditsFile)) return [];
  const buildings = JSON.parse(readFileSync(creditsFile, 'utf-8')).buildings ?? {};
  const world = JSON.parse(readFileSync(resolve(dir, 'world.json'), 'utf-8'));
  return Object.entries(buildings)
    .filter(([buildingId]) => existsSync(resolve(dir, 'assets', 'buildings', `${buildingId}.png`)))
    .map(([buildingId, painter]) => ({ name: world.buildings?.[buildingId]?.name ?? buildingId, painter }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Where a relative link in CONTRIBUTING.md (to LICENSE, LICENSE-CONTENT.md,
// CLAUDE.md, ...) should point once it's off on its own page instead of
// sitting next to those files in the repo.
const GITHUB_BLOB_BASE = 'https://github.com/TomHennen/mainstreet/blob/main/';

function rewriteMarkdownLink(url) {
  if (/^([a-z]+:|#)/i.test(url)) return url; // absolute URL, mailto:, or an in-page anchor
  return GITHUB_BLOB_BASE + url.replace(/^\.?\//, '');
}

// Images in CONTRIBUTING.md are authored with a repo-relative path (e.g.
// docs/examples/demo-facade-x4.png) so they also render on GitHub. On the
// built page, buildContributingPage() copies those files in flat, next to
// dist/contributing/index.html, so the <img> src just needs the basename.
function rewriteMarkdownImage(url) {
  if (/^([a-z]+:|#)/i.test(url)) return url; // absolute URL or an in-page anchor
  return basename(url);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** Inline markdown within one block: code spans, bold, italic, images, links, and `<url>` autolinks. */
function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/&lt;(https?:\/\/[^\s&<>]+)&gt;/g, (_, url) => `<a href="${url}">${url}</a>`);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Images before links: an image's leading "!" would otherwise leave the
  // link regex to match its "[alt](url)" part and wrap it in an <a>.
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${rewriteMarkdownImage(url)}" alt="${alt}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${rewriteMarkdownLink(url)}">${label}</a>`);
  return out;
}

/**
 * A small, self-contained Markdown -> HTML converter — just enough of the
 * language for CONTRIBUTING.md (CLAUDE.md: keep dependencies minimal, so no
 * markdown library for one document). Handles: headings, paragraphs,
 * bold/italic/code spans, links (rewritten via rewriteMarkdownLink), images
 * (rewritten via rewriteMarkdownImage — see buildContributingPage for where
 * the files come from), `<url>` autolinks, bullet lists, one flavour of
 * table, and horizontal rules. Anything fancier (nested lists, ordered
 * lists, blockquotes) isn't needed by the one document this renders and
 * isn't supported.
 */
function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inList = false;
  let i = 0;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      closeList();
      html.push('<hr>');
      i++;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      // A soft-wrapped source line continues the item until a blank line or
      // the next block (another bullet, a heading, a rule).
      const item = [bullet[1]];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^(#{1,6})\s/.test(lines[i]) &&
        !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
      ) {
        item.push(lines[i].trim());
        i++;
      }
      html.push(`<li>${renderInline(item.join(' '))}</li>`);
      continue;
    }

    closeList();

    if (line.includes('|') && lines[i + 1] !== undefined && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line).map((cell) => `<th>${renderInline(cell)}</th>`).join('');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(`<tr>${splitTableRow(lines[i]).map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`);
        i++;
      }
      html.push(`<table><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }

    // A paragraph: consecutive non-blank lines that aren't some other block.
    const paragraph = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim()) &&
      !lines[i].includes('|')
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  closeList();
  return html.join('\n');
}

function renderContributingPage(bodyHtml, siteHref) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contributing art — mainstreet</title>
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
      padding: 48px 20px 64px;
    }
    main {
      width: 100%;
      max-width: 680px;
      background: var(--night);
      border: 2px solid #4c6b58;
      border-radius: 6px;
      padding: 28px 32px 36px;
      line-height: 1.6;
      font-size: 14px;
    }
    p.back { max-width: 680px; width: 100%; margin-bottom: 16px; font-size: 13px; }
    p.back a { color: var(--paper); opacity: 0.8; text-decoration: none; }
    p.back a:hover, p.back a:focus-visible { opacity: 1; text-decoration: underline; }
    h1, h2, h3 { color: var(--maple); line-height: 1.3; }
    h1 { font-size: 22px; margin-bottom: 16px; }
    h2 { font-size: 17px; margin: 28px 0 12px; }
    h3 { font-size: 15px; margin: 20px 0 8px; }
    p { margin-bottom: 14px; }
    ul { margin: 0 0 14px 22px; }
    li { margin-bottom: 6px; }
    a { color: var(--maple); }
    a:hover, a:focus-visible { text-decoration: none; }
    code {
      font-family: inherit;
      background: rgba(181, 84, 42, 0.15);
      padding: 1px 5px;
      border-radius: 3px;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 4px 0 14px;
      image-rendering: pixelated;
      border: 2px solid #4c6b58;
      border-radius: 4px;
    }
    hr { border: none; border-top: 1px solid #4c6b58; margin: 24px 0; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 13px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #33463a; }
    th { color: var(--maple); }
  </style>
</head>
<body>
  <p class="back"><a href="${escapeHtml(siteHref)}">&larr; mainstreet</a></p>
  <main>
${bodyHtml}
  </main>
</body>
</html>
`;
}

function renderLanding(ids, studioHref, contributeHref) {
  const cards = ids
    .map((id) => {
      const { title, subtitle } = worldTitle(id);
      const href = `${SITE_BASE}/${id}/`;
      const sub = subtitle ? `<p>${escapeHtml(subtitle)}</p>` : '';
      const painted = paintedSoFar(id);
      const credits = painted.length
        ? `
        <div class="painted">
          <h3>Painted so far</h3>
          <ul>
${painted.map((p) => `            <li>${escapeHtml(p.name)} &mdash; ${escapeHtml(p.painter)}</li>`).join('\n')}
          </ul>
          <p>Press &ldquo;Paint it&rdquo; on an unpainted building in the game and the Studio opens, ready for your take on it.</p>
        </div>`
        : '';
      return `
      <li>
        <a href="${escapeHtml(href)}">
          <h2>${escapeHtml(title)}</h2>
          ${sub}
        </a>${credits}
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
    li {
      background: var(--night);
      border: 2px solid #4c6b58;
      border-radius: 6px;
      transition: border-color 0.15s ease;
    }
    li:hover, li:focus-within { border-color: var(--maple); }
    li a {
      display: block;
      padding: 14px 16px;
      text-decoration: none;
      color: inherit;
    }
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
    li .painted {
      padding: 0 16px 14px;
      font-size: 12px;
      line-height: 1.6;
    }
    li .painted h3 {
      font-size: 12px;
      font-weight: normal;
      opacity: 0.7;
      margin-bottom: 2px;
      padding-top: 12px;
      border-top: 1px solid #33463a;
    }
    li .painted ul { display: block; }
    li .painted li {
      background: none;
      border: none;
      opacity: 0.9;
    }
    li .painted p { margin-top: 8px; opacity: 0.6; }
    p.studio {
      margin-top: 22px;
      font-size: 13px;
      text-align: center;
    }
    p.studio a {
      color: var(--maple);
      text-decoration: none;
      border-bottom: 1px solid rgba(181, 84, 42, 0.5);
      padding-bottom: 2px;
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
    <p class="studio"><a href="${escapeHtml(studioHref)}">Paint a building &rarr;</a></p>
    <p class="studio"><a href="${escapeHtml(contributeHref)}">How to contribute art &rarr;</a></p>
    <footer>More towns are always welcome, and so is a fresh coat of paint.</footer>
  </main>
</body>
</html>
`;
}

function buildContributingPage() {
  const outDir = resolve(DIST_DIR, 'contributing');
  mkdirSync(outDir, { recursive: true });
  const markdown = readFileSync(resolve(ROOT, 'CONTRIBUTING.md'), 'utf-8');
  const page = renderContributingPage(renderMarkdown(markdown), `${SITE_BASE}/`);
  writeFileSync(resolve(outDir, 'index.html'), page);

  // Images CONTRIBUTING.md links to (docs/examples/*.png) are copied in
  // flat, next to index.html, matching the basename-only src that
  // rewriteMarkdownImage() writes into the page. docs/examples isn't a
  // world pack, so this is the only place these files ship from.
  const examplesDir = resolve(ROOT, 'docs', 'examples');
  if (existsSync(examplesDir)) {
    for (const file of readdirSync(examplesDir)) {
      if (file.endsWith('.png')) cpSync(resolve(examplesDir, file), resolve(outDir, file));
    }
  }
}

function main() {
  const ids = worldIds();
  if (ids.length === 0) {
    throw new Error('no worlds found under worlds/');
  }

  if (ids.includes('studio')) {
    // dist/studio/ is the editor's; a world called "studio" would land on top
    // of it. Renaming the world pack is the fix.
    throw new Error('a world cannot be called "studio" — that path belongs to the facade editor');
  }

  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  for (const id of ids) buildWorld(id);

  const studioDir = buildStudio();
  copyStudioWorlds(studioDir, ids);

  const contributeHref = `${SITE_BASE}/contributing/`;
  writeFileSync(
    resolve(DIST_DIR, 'index.html'),
    renderLanding(ids, `${SITE_BASE}/studio/?world=${ids[0]}`, contributeHref)
  );
  buildContributingPage();
  // Pages runs Jekyll by default, which ignores files/folders starting with
  // an underscore and can otherwise mangle a static site; this opts out.
  writeFileSync(resolve(DIST_DIR, '.nojekyll'), '');

  console.log(`\nBuilt ${ids.length} world(s) and the studio into ${DIST_DIR}`);
}

main();
