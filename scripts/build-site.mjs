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
import { joinCredits } from '../engine/session.ts';

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

/**
 * A world card: what the world calls itself, where it is, the towns in it, and
 * how far along it says it is. The towns are its village maps in the order the
 * pack lists them (interiors are inside those, so they are not places to name),
 * joined the way a credit line is. A world with nothing to say about how far
 * along it is gets the gentlest true thing instead.
 */
function worldTitle(id) {
  const world = JSON.parse(readFileSync(resolve(WORLDS_DIR, id, 'world.json'), 'utf-8'));
  const villages = Object.values(world.maps ?? {})
    .filter((map) => map.kind === 'village')
    .map((map) => map.name)
    .filter(Boolean);
  return {
    title: world.title ?? id,
    subtitle: world.subtitle ?? '',
    towns: joinCredits(villages),
    status: world.status ?? 'Just getting started',
    tagline: world.tagline ?? ''
  };
}

/**
 * Who painted what, for the landing page. The painter is named here, and
 * thanked in-game on the plaque beside that building's door — never in the
 * building's sign dialogue, which belongs to the story copy (DESIGN.md §2/§4).
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
    .map(([buildingId, painter]) => ({
      name: world.buildings?.[buildingId]?.name ?? buildingId,
      // A credit is one name or an array of names in order of contribution
      // (engine/schema.ts Credits) — joined the same way the plaque reads it.
      painter: joinCredits(Array.isArray(painter) ? painter : [painter])
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where a world sends someone who has something to say — the same
 * `world.json` `feedback` block the suggestion box in the game reads
 * (DESIGN.md §2), turned into the same kind of link. Mirrors
 * engine/feedback.ts deliberately: no address is written down here.
 */
function feedbackHref(id) {
  const { feedback } = JSON.parse(readFileSync(resolve(WORLDS_DIR, id, 'world.json'), 'utf-8'));
  if (!feedback) return null;
  if (feedback.url) return feedback.url;
  if (!feedback.email) return null;
  const subject = feedback.subject ? `?subject=${encodeURIComponent(feedback.subject)}` : '';
  return `mailto:${feedback.email}${subject}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Where this repository lives. Every other name, link and title on the site is
 * read from a world pack or from a file in the repo; this is the one constant,
 * because a checkout has no way of knowing its own remote. `repository` in
 * package.json wins if it is set, then a SITE_REPO in the environment (which is
 * what a fork would pass), then this.
 */
function repoUrl() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const declared = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const cleaned = declared?.replace(/^git\+/, '').replace(/\.git$/, '');
  return (cleaned || process.env.SITE_REPO || 'https://github.com/TomHennen/mainstreet').replace(/\/+$/, '');
}

const REPO_URL = repoUrl();

// Where a relative link in CONTRIBUTING.md (to LICENSE, LICENSE-CONTENT.md,
// CLAUDE.md, ...) should point once it's off on its own page instead of
// sitting next to those files in the repo. The landing page's licence links
// go the same way.
const GITHUB_BLOB_BASE = `${REPO_URL}/blob/main/`;

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
      // Each cell carries its column's name, so a phone can stack the row and
      // still say what each part of it is (see the page's CSS).
      const heads = splitTableRow(line);
      const labels = heads.map((cell) => cell.replace(/[*`]/g, '').trim());
      const header = heads.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitTableRow(lines[i]).map(
          (cell, n) => `<td data-label="${escapeHtml(labels[n] ?? '')}">${renderInline(cell)}</td>`
        );
        rows.push(`<tr>${cells.join('')}</tr>`);
        i++;
      }
      html.push(
        `<div class="table"><table><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      );
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
      --edge: #4c6b58;
      --rule: #33463a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--frame);
      color: var(--paper);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 16px;
      line-height: 1.65;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 20px 56px;
      overflow-wrap: break-word;
    }
    header, main { width: 100%; max-width: 680px; }
    header {
      padding: 10px 0;
      border-bottom: 1px solid rgba(243, 234, 216, 0.12);
      margin-bottom: 24px;
    }
    header a {
      display: inline-block;
      min-height: 44px;
      line-height: 44px;
      color: var(--maple);
      text-decoration: none;
      font-weight: 700;
    }
    header a:hover, header a:focus-visible { text-decoration: underline; }
    h1, h2, h3 { color: var(--maple); line-height: 1.3; }
    h1 { font-size: 24px; margin-bottom: 16px; }
    h2 { font-size: 19px; margin: 34px 0 12px; }
    h3 { font-size: 17px; margin: 24px 0 8px; }
    p { margin-bottom: 14px; }
    ul { margin: 0 0 14px 22px; }
    li { margin-bottom: 8px; }
    a { color: var(--maple); text-underline-offset: 4px; }
    a:hover, a:focus-visible { color: var(--paper); }
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
      border: 2px solid var(--edge);
      border-radius: 4px;
    }
    hr { border: none; border-top: 1px solid var(--rule); margin: 28px 0; }

    /* A table on a phone is a stack of little entries, one per row: the
       heading row is put away and each cell carries its own label, so nothing
       has to be scrolled sideways to be read. Wide screens get the table back.
       No boxes around any of it — one hairline between rows is enough. */
    .table { margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tbody tr { display: block; padding: 14px 0; border-top: 1px solid var(--rule); }
    tbody tr:first-child { border-top: none; padding-top: 0; }
    tbody td { display: block; padding: 0 0 6px; }
    tbody td:last-child { padding-bottom: 0; }
    tbody td::before {
      content: attr(data-label);
      display: block;
      font-size: 14px;
      color: var(--maple);
      opacity: 0.85;
    }
    tbody td:first-child {
      font-size: 18px;
      color: var(--maple);
      padding-bottom: 8px;
    }
    tbody td:first-child::before { content: none; }
    @media (min-width: 720px) {
      .table { overflow-x: auto; font-size: 15px; }
      tbody tr { display: table-row; padding: 0; border-top: none; }
      tbody td { display: table-cell; padding: 10px 16px 10px 0; vertical-align: top; border-bottom: 1px solid var(--rule); }
      tbody td:first-child { font-size: inherit; padding-bottom: 10px; }
      tbody td::before { content: none; }
      thead { position: static; width: auto; height: auto; clip-path: none; }
      th { text-align: left; padding: 0 16px 10px 0; color: var(--maple); border-bottom: 1px solid var(--rule); }
    }
    /* Five columns of prose need more room than a column of text wants to be,
       so on a wide screen a table steps out past the text and centres itself
       on the page rather than squeezing every cell into two words a line. */
    @media (min-width: 960px) {
      .table {
        width: min(94vw, 1040px);
        margin-left: calc((100% - min(94vw, 1040px)) / 2);
      }
    }
  </style>
</head>
<body>
  <header><a href="${escapeHtml(siteHref)}">&larr; mainstreet</a></header>
  <main>
${bodyHtml}
  </main>
</body>
</html>
`;
}

/**
 * Whatever the worlds would like said at the foot of the page — where they are
 * made, or who by (`tagline` in world.json, engine/schema.ts). Named once
 * each, and nothing at all if no world asks for one.
 */
function taglines(ids) {
  const said = ids.map((id) => worldTitle(id).tagline).filter(Boolean);
  return [...new Set(said)];
}

/** The palettes the worlds paint with, named once each, for the footer. */
function palettes(ids) {
  const seen = new Map();
  for (const id of ids) {
    const world = JSON.parse(readFileSync(resolve(WORLDS_DIR, id, 'world.json'), 'utf-8'));
    if (world.paletteName && !seen.has(world.paletteName)) seen.set(world.paletteName, world.paletteLink ?? null);
  }
  return [...seen].map(([name, link]) => ({ name, link }));
}

/**
 * The front page: what the game is, who painted it, and what anyone may do
 * with it. Every name, link and count on it is read from a world pack or from
 * a file in this repo — the one constant is REPO_URL, above.
 */
function renderLanding(ids, studioHref, contributeHref, writeHref) {
  const cards = ids
    .map((id) => {
      const { title, subtitle, towns, status } = worldTitle(id);
      const href = `${SITE_BASE}/${id}/`;
      const sub = subtitle ? `<p class="where">${escapeHtml(subtitle)}</p>` : '';
      const where = towns ? `<p class="where">${escapeHtml(towns)}</p>` : '';
      const count = `<p class="count">${escapeHtml(status)}</p>`;
      return `
        <li>
          <a href="${escapeHtml(href)}">
            <h3>${escapeHtml(title)}</h3>
            ${sub}
            ${where}
            ${count}
            <span class="go">Play &rarr;</span>
          </a>
        </li>`;
    })
    .join('\n');

  const painted = ids
    .map((id) => ({ id, title: worldTitle(id).title, credits: paintedSoFar(id) }))
    .filter((world) => world.credits.length > 0)
    .map(
      (world) => `
      <div class="painted">
        <h3>Painted so far${ids.length > 1 ? ` in ${escapeHtml(world.title)}` : ''}</h3>
        <ul>
${world.credits.map((p) => `          <li>${escapeHtml(p.name)} &mdash; ${escapeHtml(p.painter)}</li>`).join('\n')}
        </ul>
      </div>`
    )
    .join('\n');

  const said = taglines(ids)
    .map((line) => `      <p>${escapeHtml(line)}</p>`)
    .join('\n');

  const paletteCredits = palettes(ids)
    .map((p) => (p.link ? `<a href="${escapeHtml(p.link)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)))
    .join(', ');

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
      --edge: #4c6b58;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--frame);
      color: var(--paper);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 16px;
      line-height: 1.65;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px 40px;
    }
    main { width: 100%; max-width: 560px; }
    h1 { font-size: 26px; letter-spacing: 0.5px; margin-bottom: 8px; }
    p.lede { opacity: 0.85; margin-bottom: 28px; }
    h2 {
      font-size: 17px;
      color: var(--maple);
      margin-bottom: 10px;
    }
    section { margin-top: 34px; }
    section p + p { margin-top: 12px; }
    ul.towns { list-style: none; display: flex; flex-direction: column; gap: 12px; }
    ul.towns li {
      background: var(--night);
      border: 2px solid var(--edge);
      border-radius: 6px;
      transition: border-color 0.15s ease;
    }
    ul.towns li:hover, ul.towns li:focus-within { border-color: var(--maple); }
    ul.towns a {
      display: block;
      padding: 14px 16px;
      text-decoration: none;
      color: inherit;
      min-height: 44px;
    }
    ul.towns h3 { font-size: 18px; color: var(--maple); }
    ul.towns p { font-size: 15px; opacity: 0.75; }
    ul.towns .go { display: inline-block; margin-top: 8px; color: var(--maple); font-size: 15px; }
    .painted {
      margin-top: 18px;
      border-top: 1px solid #33463a;
      padding-top: 12px;
    }
    .painted h3 { font-size: 15px; font-weight: normal; opacity: 0.7; }
    .painted ul { list-style: none; font-size: 15px; opacity: 0.9; }
    p.do { margin-top: 16px; }
    a { color: var(--maple); }
    p.do a, ul.links a {
      display: inline-block;
      min-height: 44px;
      padding: 9px 0;
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    p.do a:hover, p.do a:focus-visible, ul.links a:hover, ul.links a:focus-visible { color: var(--paper); }
    p.note { opacity: 0.7; font-size: 15px; }
    ul.links { list-style: none; margin-top: 8px; }
    section.write p { margin-top: 0; }
    footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #33463a;
      font-size: 14px;
      opacity: 0.65;
    }
    footer a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>mainstreet</h1>
    <p class="lede">A small, cozy, pixel-art town game you play in a browser &mdash; about twenty minutes at a time, one short story to a visit, set in real places.</p>
    <ul class="towns">
${cards}
    </ul>

    <section>
      <h2>What this is</h2>
      <p>You walk around, talk to whoever is out, read the signs, and follow one small story to the end of it. Nothing to farm, nobody to fight, no timer running. Every town in it is a real place, drawn with affection for the place and for the people who live there.</p>
    </section>

    <section>
      <h2>The buildings are painted by people</h2>
      <p>Every painted building in the game was drawn by a person, usually someone who lives there or loves the place. The buildings nobody has painted yet stand as plain placeholder boxes on purpose, waiting for whoever knows what they look like. The code, the maps and the tools are built with help from AI. No AI-made art goes into the towns.</p>
${painted}
      <p class="do"><a href="${escapeHtml(studioHref)}">Paint a building &rarr;</a></p>
      <p class="note">No account, nothing to install. Every painter is thanked on a small plaque beside that building&rsquo;s door.</p>
    </section>

    <section>
      <h2>Open source</h2>
      <p>The code is on GitHub under Apache 2.0, and anyone may read it, run a town of their own, or send a fix. It is a small engine plus world packs, and a world pack is only pictures and words.</p>
      <p class="do"><a href="${escapeHtml(REPO_URL)}">mainstreet on GitHub &rarr;</a></p>
    </section>

    <section>
      <h2>Licences, in plain words</h2>
      <p>The code is Apache 2.0. Everything in the towns &mdash; art, maps, words &mdash; and everything you contribute is Creative Commons Attribution 4.0: anyone may copy, share and adapt it, as long as they credit whoever made it. Your name stays on your work, on the plaque beside the door and here on this page.</p>
      <ul class="links">
        <li><a href="${escapeHtml(GITHUB_BLOB_BASE + 'LICENSE')}">The code licence, Apache 2.0 &rarr;</a></li>
        <li><a href="${escapeHtml(GITHUB_BLOB_BASE + 'LICENSE-CONTENT.md')}">The content licence, CC BY 4.0 &rarr;</a></li>
        <li><a href="${escapeHtml(contributeHref)}">How to contribute art &rarr;</a></li>
      </ul>
    </section>
${writeHref ? `
    <section class="write">
      <h2>Write to us</h2>
      <p>Have a story idea, a bit of local lore, someone who should be in it, or something we should fix?</p>
      <p class="do"><a href="${escapeHtml(writeHref)}">Write to us &rarr;</a></p>
    </section>` : ''}

    <footer>
${said}
${paletteCredits ? `      <p>Painted with the ${paletteCredits} palette.</p>` : ''}
    </footer>
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

  // The two flat pages — the front page and the contributing page — are
  // written from the world packs and the repo's own files in a moment, with no
  // Vite involved. MS_PAGES_ONLY=1 writes just those two, leaving anything
  // already in dist/ alone; the playtest uses it to open the front page
  // without building the whole site first.
  const pagesOnly = process.env.MS_PAGES_ONLY === '1';

  if (!pagesOnly) rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  if (!pagesOnly) {
    for (const id of ids) buildWorld(id);

    const studioDir = buildStudio();
    copyStudioWorlds(studioDir, ids);
  }

  const contributeHref = `${SITE_BASE}/contributing/`;
  writeFileSync(
    resolve(DIST_DIR, 'index.html'),
    renderLanding(ids, `${SITE_BASE}/studio/?world=${ids[0]}`, contributeHref, feedbackHref(ids[0]))
  );
  buildContributingPage();
  // Pages runs Jekyll by default, which ignores files/folders starting with
  // an underscore and can otherwise mangle a static site; this opts out.
  writeFileSync(resolve(DIST_DIR, '.nojekyll'), '');

  console.log(
    pagesOnly
      ? `\nWrote the front page and the contributing page into ${DIST_DIR}`
      : `\nBuilt ${ids.length} world(s) and the studio into ${DIST_DIR}`
  );
}

main();
