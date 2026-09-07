/**
 * mainstreet Studio v1 — a small, static facade painter.
 *
 * Someone in Jefferson opens this on their phone, paints the front of a shop
 * they walk past every day, and emails it in. There is no backend and no
 * account: the drawing becomes a short text code (see codec.ts) that rides
 * along in a `mailto:` body, or a PNG they attach themselves.
 *
 * Engine/content separation holds here as strictly as it does in the engine
 * (CLAUDE.md hard rule 1): this file names no world, no town and no building.
 * It reads `worlds/<id>/world.json` and `worlds/<id>/palette.png` at runtime
 * and takes everything — names, footprints, colours — from there.
 *
 * The canvas listens to pointer events and nothing else (hard rule 4): no
 * touch handlers anywhere, so nothing can fire twice. One finger paints; a
 * second finger turns the gesture into a two-finger pan and quietly puts back
 * whatever the first finger had started, so scrolling a big drawing never
 * leaves marks on it. The ordinary controls are <button>s on `click`, which is
 * one path too and is the one a keyboard can reach.
 */
import { CodeError, MAGIC, TRANSPARENT, decode, encode } from './codec';
import {
  describeImport,
  fitCode,
  fitImport,
  nearestIn,
  paletteRgb,
  plural,
  rgbOf,
  settleCode,
  snapToPalette
} from './artwork';

// --- constants ---------------------------------------------------------------

const BASE = import.meta.env.BASE_URL;
const TILE = 16;
/** Head-room the engine's placeholder facade draws above the footprint. */
const OVERHEAD = 20;
/** Most spare rows of 16px an artist may add above the footprint. */
const MAX_EXTRA_ROWS = 3;
const DEFAULT_EXTRA_ROWS = 1;
const UNDO_LIMIT = 60;
const SUBMIT_ADDRESS = 'tom.hennen+mainstreet@gmail.com';
/** Above this many characters of encoded body, a mailto stops being reliable. */
const MAILTO_BUDGET = 1800;
/** Below this share of painted pixels, submitting gets a gentle reminder. */
const LIGHT_PAINT_SHARE = 0.02;
/** The "what you'll send" preview never gets wider than this on screen. */
const PREVIEW_MAX_WIDTH = 260;

const CONSENT =
  "I made this, I'm happy for it to appear in mainstreet with credit to the " +
  'name above, and I license it under the terms on the contributing page.';

const GUIDANCE = "Draw the storefront as you remember it; please don't paste a logo.";

const CANNOT_READ =
  "That file would not open here as a picture, and it may well be nothing you did. " +
  'A PNG saved straight out of a pixel editor usually goes in first time — and if this one ' +
  'stays stubborn, emailing it to us works just as well.';

type Tool = 'pencil' | 'fill' | 'eraser' | 'eyedropper' | 'line' | 'rect';
type BrushSize = 1 | 2 | 3;

// --- world pack shapes (read-only; the engine owns the real schema) ----------

interface BuildingDef {
  name: string;
  wall: string;
  roof: string;
}

interface Placement {
  id: string;
  pos: [number, number];
  size: [number, number];
  door: [number, number];
}

interface MapDef {
  name: string;
  buildings?: Placement[];
}

interface World {
  id: string;
  title: string;
  subtitle?: string;
  palette?: string;
  buildings: Record<string, BuildingDef>;
  maps: Record<string, MapDef>;
}

interface Entry {
  placement: Placement;
  def: BuildingDef;
  mapName: string;
  painted: boolean;
}

// --- little helpers ----------------------------------------------------------

const app = document.getElementById('app') as HTMLElement;
const here = document.getElementById('here') as HTMLElement;
const home = document.getElementById('home') as HTMLAnchorElement;

function packUrl(world: string, path: string): string {
  return `${BASE}worlds/${world}/${path}`;
}

/** The contributing page lives one level up from the studio, wherever we are. */
function contributingUrl(): string {
  return new URL('../contributing/', new URL(BASE, location.href)).href;
}

function esc(text: string): string {
  return String(text).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string
  );
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`the studio expected an element #${id}`);
  return node as T;
}

function kindly(message: string, detail?: string): void {
  app.innerHTML = `
    <section class="notice">
      <p>${esc(message)}</p>
      ${detail ? `<p class="quiet">${esc(detail)}</p>` : ''}
      <p><a class="link" href="${esc(contributingUrl())}">How to send art in another way</a></p>
    </section>`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

async function exists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return response.ok;
  } catch {
    return false;
  }
}

// --- palette -----------------------------------------------------------------

/**
 * The world's palette.png, one pixel per colour (DESIGN.md §4). A colour's
 * index is its reading position in that image, so a fully transparent pixel
 * still occupies an index — it is simply a colour nobody may paint with.
 */
async function loadPalette(world: World): Promise<(string | null)[]> {
  const url = packUrl(world.id, world.palette ?? 'palette.png');
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('this browser would not give the studio a canvas to read with');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const colours: (string | null)[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) {
      colours.push(null);
      continue;
    }
    colours.push(`#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  }
  return colours.slice(0, TRANSPARENT);
}

// --- the placeholder facade, as a faint reference ----------------------------

/**
 * A rough redrawing of the engine's unpainted facade (engine/art.ts) at the
 * same scale, so an artist can see where the door and the sign sit today. It
 * is a reference, not a template: nobody has to keep any of it.
 */
function referenceCanvas(placement: Placement, def: BuildingDef, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  const bodyW = placement.size[0] * TILE;
  const bodyH = placement.size[1] * TILE;
  // The engine anchors art to the bottom of the footprint, so the footprint's
  // top edge is `bodyH` up from the bottom of this canvas, whatever height the
  // artist chose. `top` is where engine/art.ts's y = OVERHEAD lands here.
  const top = height - bodyH - OVERHEAD;

  ctx.fillStyle = def.roof;
  ctx.fillRect(-2, top + OVERHEAD - 8, bodyW + 4, 12);

  ctx.fillStyle = def.wall;
  ctx.fillRect(0, top + OVERHEAD + 4, bodyW, bodyH - 4);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(0, top + OVERHEAD + bodyH - 3, bodyW, 3);

  ctx.fillStyle = '#f5e6b8';
  for (let i = 0; i < placement.size[0] - 1; i += 2) {
    ctx.fillRect(8 + i * TILE, top + OVERHEAD + 12, 8, 8);
  }

  const doorX = (placement.door[0] - placement.pos[0]) * TILE;
  ctx.fillStyle = '#3a2c1e';
  ctx.fillRect(doorX + 3, top + OVERHEAD + bodyH - 14, 10, 14);

  ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  const signW = Math.ceil(ctx.measureText(def.name).width + 8);
  ctx.fillStyle = 'rgba(30,25,18,.85)';
  ctx.fillRect(width / 2 - signW / 2, top, signW, 10);
  ctx.fillStyle = '#f3ead8';
  ctx.fillText(def.name, width / 2, top + 7.5);

  return canvas;
}

// --- pickers -----------------------------------------------------------------

function renderWorldPicker(ids: string[]): void {
  here.textContent = 'studio';
  app.innerHTML = `
    <section class="masthead">
      <h1>Paint a building</h1>
      <p class="lede">Pick the town you'd like to paint in. Every building in it
        would be glad of a coat of paint, and there is no wrong way to start.</p>
    </section>
    <ul class="cards">
      ${ids
        .map((id) => `<li><a href="?world=${encodeURIComponent(id)}"><strong>${esc(id)}</strong></a></li>`)
        .join('')}
    </ul>`;
}

function renderBuildingPicker(world: World, entries: Entry[]): void {
  app.classList.remove('editing');
  here.textContent = world.title;
  const cards = entries
    .map((entry) => {
      const [w, h] = entry.placement.size;
      const state = entry.painted
        ? '<span class="tag painted">already painted — repaints welcome</span>'
        : '<span class="tag">waiting for paint</span>';
      return `
      <li>
        <a href="?world=${encodeURIComponent(world.id)}&amp;building=${encodeURIComponent(entry.placement.id)}">
          <strong>${esc(entry.def.name)}</strong>
          <span class="quiet">${esc(entry.mapName)} · ${esc(plural(w, 'tile', 'tiles'))} wide,
            ${esc(plural(h, 'tile', 'tiles'))} deep · ${w * TILE} pixels across</span>
          ${state}
        </a>
      </li>`;
    })
    .join('');

  app.innerHTML = `
    <section class="masthead">
      <h1>Paint a building in ${esc(world.title)}</h1>
      <p class="lede">Here is every building in ${esc(world.title)}. Pick one you
        know and paint the front of it. ${esc(GUIDANCE)}</p>
    </section>
    <ul class="cards">${cards}</ul>
    <footer class="how">
      <p>New to this? The <a class="link" href="${esc(contributingUrl())}">contributing page</a>
        explains what happens to a drawing after you send it, and the licence it goes under.</p>
    </footer>`;
}

// --- the editor --------------------------------------------------------------

interface EditorState {
  world: World;
  entry: Entry;
  palette: (string | null)[];
  width: number;
  height: number;
  extraRows: number;
  pixels: Uint8Array;
  colour: number;
  tool: Tool;
  brushSize: BrushSize;
  rectFilled: boolean;
  mirror: boolean;
  zoom: number;
  showGrid: boolean;
  showReference: boolean;
  undo: Uint8Array[];
  redo: Uint8Array[];
}

function draftKey(worldId: string, buildingId: string): string {
  return `mainstreet.studio.v1.${worldId}.${buildingId}`;
}

function blankPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  pixels.fill(TRANSPARENT);
  return pixels;
}

function renderEditor(world: World, entry: Entry, palette: (string | null)[]): void {
  const { placement, def } = entry;
  const footW = placement.size[0] * TILE;
  const footH = placement.size[1] * TILE;

  const state: EditorState = {
    world,
    entry,
    palette,
    width: footW,
    height: footH + DEFAULT_EXTRA_ROWS * TILE,
    extraRows: DEFAULT_EXTRA_ROWS,
    pixels: blankPixels(footW, footH + DEFAULT_EXTRA_ROWS * TILE),
    colour: palette.findIndex((c) => c !== null),
    tool: 'pencil',
    brushSize: 1,
    rectFilled: false,
    mirror: false,
    zoom: 4,
    showGrid: true,
    showReference: false,
    undo: [],
    redo: []
  };
  if (state.colour < 0) state.colour = 0;

  restoreDraft(state);

  here.textContent = def.name;
  home.href = `?world=${encodeURIComponent(world.id)}`;
  home.textContent = `← ${world.title}`;

  const swatches = palette
    .map((colour, index) =>
      colour === null
        ? ''
        : `<button class="swatch" data-colour="${index}" style="background:${esc(colour)}"
             title="Colour ${index}" aria-label="Colour ${index}, ${esc(colour)}"></button>`
    )
    .join('');

  app.innerHTML = `
    <section class="masthead">
      <h1>${esc(def.name)}</h1>
      <p class="where" id="shape"></p>
      <p class="guidance">${esc(GUIDANCE)} A drawing of the place as you see it
        is worth far more to us than anything traced.</p>
    </section>

    <div class="stage" id="stage">
      <canvas id="view"></canvas>
    </div>
    <p class="quiet" id="guidenote" hidden>Guide only. It isn't part of your drawing.</p>

    <p class="statusline" id="status" role="status" aria-live="polite">&nbsp;</p>

    <section class="preview">
      <canvas id="previewcanvas"></canvas>
      <p class="quiet">What you'll send: just what you drew.</p>
    </section>

    <section class="tools">
      <div class="row" id="toolrow">
        <button class="tool" data-tool="pencil">Pencil<kbd>B</kbd></button>
        <button class="tool" data-tool="fill">Fill<kbd>F</kbd></button>
        <button class="tool" data-tool="eraser">Eraser<kbd>E</kbd></button>
        <button class="tool" data-tool="eyedropper">Pick<kbd>I</kbd></button>
        <button class="tool" data-tool="line">Line<kbd>L</kbd></button>
        <button class="tool" data-tool="rect">Rect<kbd>R</kbd></button>
      </div>
      <div class="row" id="sizerow">
        <span class="quiet">Brush</span>
        <button class="size" data-size="1">1<kbd>1</kbd></button>
        <button class="size" data-size="2">2<kbd>2</kbd></button>
        <button class="size" data-size="3">3<kbd>3</kbd></button>
        <button id="rectfilled" class="toggle">Filled</button>
        <button id="mirror" class="toggle">Mirror<kbd>M</kbd></button>
      </div>
      <div class="row">
        <button id="undo">Undo<kbd>⌘Z</kbd></button>
        <button id="redo">Redo<kbd>⇧⌘Z</kbd></button>
        <button id="zoomout">Zoom −<kbd>[</kbd></button>
        <button id="zoomin">Zoom +<kbd>]</kbd></button>
        <button id="grid" class="toggle">Grid<kbd>G</kbd></button>
        <button id="reference" class="toggle">Reference<kbd>V</kbd></button>
      </div>
      <div class="row rows">
        <span class="quiet" id="rowslabel"></span>
        <button id="fewerrows">Fewer rows above</button>
        <button id="morerows">More rows above</button>
      </div>
      <div class="palette" id="palette">${swatches}</div>
    </section>

    <section class="files">
      <h2>Files</h2>
      <div class="row">
        <!-- A real <button> opens the picker, so a keyboard reaches Import the
             same way it reaches every other control here. The input itself is
             hidden off to one side rather than with display:none, which some
             browsers take as a reason not to open a file picker at all. -->
        <button id="importbutton">Import a PNG</button>
        <input id="import" type="file" accept="image/png,image/*" class="offscreen"
               tabindex="-1" aria-hidden="true" />
        <button id="pastecode" aria-expanded="false" aria-controls="pastepanel">Paste a code</button>
        <button id="export">Export a PNG</button>
        <button id="fromguide">Start from the guide</button>
        <button id="clear">Start again</button>
      </div>
      <p class="quiet">Painting in Aseprite or Piskel instead? Lovely — export a
        PNG at the width above, any of the heights it lists, and import it here
        to send it in.</p>
      <p class="quiet">Turns the guide into real pixels you can edit and send.</p>
      <p class="quiet">Sent a drawing in already and want to carry on with it?
        The code is in your sent email — paste it back and it picks up right
        where it left off.</p>

      <div class="paste" id="pastepanel" hidden>
        <label class="field" for="codebox">
          <span>Paste the code from your email — line breaks and all, they don't matter</span>
          <textarea id="codebox" rows="3" spellcheck="false" autocomplete="off"
            autocapitalize="off" placeholder="${esc(MAGIC)}|…"></textarea>
        </label>
        <div class="row">
          <button id="codeload" class="primary">Bring it back</button>
          <button id="codecancel">Never mind</button>
        </div>
        <p class="statusline" id="codestatus" role="status" aria-live="polite">&nbsp;</p>
      </div>

      <details class="elsewhere">
        <summary>Painting somewhere else?</summary>
        <div class="elsewhere-body">
          <p class="quiet" id="elsewheresize"></p>
          <p class="quiet">Export a PNG with a transparent background — no
            anti-aliasing or smoothing — using only the palette colours below.
            The footprint sits at the very bottom of the canvas; any spare
            rows for a roof, sign or awning go above it.</p>
          <div class="row">
            <a class="button" id="downloadpalette" href="#" download>Download the palette PNG</a>
            <button id="downloadhex">Download the palette as .hex</button>
          </div>
          <p class="quiet">The .hex file is one colour per line, which
            Aseprite, Piskel and Lospec all read straight in.</p>
          <p class="quiet">Import a PNG above afterwards and the Studio sorts
            out the small things itself: it moves any colour that isn't quite
            on the palette to the nearest one that is, makes up its mind about
            soft edges, and tells you what it changed. If the size is one it
            can't use, it says exactly which one it's after.</p>
        </div>
      </details>
    </section>

    <section class="send">
      <h2>Send it in</h2>
      <label class="field">
        <span>Name for the credit</span>
        <input id="credit" type="text" autocomplete="name" placeholder="However you'd like to be thanked" />
      </label>
      <label class="consent">
        <input id="consent" type="checkbox" />
        <span>${esc(CONSENT)}</span>
      </label>
      <p class="quiet" id="submitnote" hidden></p>
      <div class="row">
        <button id="send" class="primary">Open an email with my drawing</button>
        <button id="copy">Copy the code</button>
      </div>
      <p id="sendmailwrap" hidden><a class="link" id="sendmail" href="#">If nothing opened, tap here to open the email</a></p>
      <p class="statusline" id="sendstatus" role="status" aria-live="polite">&nbsp;</p>
      <div id="attach" hidden>
        <p class="quiet" id="attachnote"></p>
        <div class="row">
          <button id="attachexport">Download the PNG</button>
          <a class="button" id="attachmail" href="#">Open the email</a>
        </div>
      </div>
    </section>

    <footer class="how">
      <p><strong>How this works:</strong> your drawing becomes a short line of
        text, your email app opens with that line already written out, and you
        press send. Nothing leaves this page until you do.</p>
      <p><a class="link" href="${esc(contributingUrl())}">What happens next, and the licence</a></p>
    </footer>`;

  // A wide screen puts the tools beside the drawing; see style.css.
  app.classList.add('editing');
  wireEditor(state);
}

function wireEditor(state: EditorState): void {
  const stage = el<HTMLDivElement>('stage');
  const view = el<HTMLCanvasElement>('view');
  const status = el<HTMLParagraphElement>('status');
  const sendStatus = el<HTMLParagraphElement>('sendstatus');

  const pix = document.createElement('canvas');
  let reference = referenceCanvas(state.entry.placement, state.entry.def, state.width, state.height);
  let saveTimer = 0;

  function say(message: string): void {
    status.textContent = message || ' ';
  }

  function saySend(message: string): void {
    sendStatus.textContent = message || ' ';
  }

  // --- painting ---------------------------------------------------------

  function syncPix(): void {
    pix.width = state.width;
    pix.height = state.height;
    const ctx = pix.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(state.width, state.height);
    for (let i = 0; i < state.pixels.length; i++) {
      const value = state.pixels[i];
      const colour = value === TRANSPARENT ? null : state.palette[value] ?? null;
      if (!colour) continue;
      const [r, g, b] = rgbOf(colour);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function render(): void {
    const w = state.width * state.zoom;
    const h = state.height * state.zoom;
    view.width = w;
    view.height = h;
    view.style.width = `${w}px`;
    view.style.height = `${h}px`;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // A soft check for "nothing painted here yet".
    ctx.fillStyle = '#26302a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2d3a32';
    for (let y = 0; y < h; y += 8) {
      for (let x = ((y / 8) % 2) * 8; x < w; x += 16) ctx.fillRect(x, y, 8, 8);
    }

    if (state.showReference) {
      ctx.globalAlpha = 0.32;
      ctx.drawImage(reference, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    syncPix();
    ctx.drawImage(pix, 0, 0, w, h);

    if (state.showGrid && state.zoom >= 3) {
      ctx.fillStyle = 'rgba(243,234,216,.10)';
      for (let x = state.zoom; x < w; x += state.zoom) ctx.fillRect(x, 0, 1, h);
      for (let y = state.zoom; y < h; y += state.zoom) ctx.fillRect(0, y, w, 1);
    }
    if (state.showGrid) {
      ctx.fillStyle = 'rgba(243,234,216,.28)';
      for (let x = TILE * state.zoom; x < w; x += TILE * state.zoom) ctx.fillRect(x, 0, 1, h);
      for (let y = h - TILE * state.zoom; y > 0; y -= TILE * state.zoom) ctx.fillRect(0, y, w, 1);
    }

    // Where the building's footprint begins: everything above this line hangs
    // over the street, which is exactly where a roof or a sign wants to be.
    if (state.extraRows > 0) {
      const line = state.extraRows * TILE * state.zoom;
      ctx.fillStyle = 'rgba(181,84,42,.75)';
      for (let x = 0; x < w; x += 8) ctx.fillRect(x, line - 1, 4, 2);
    }

    // A soft dashed line down the middle while mirroring, so it's obvious
    // where the fold is before a single pixel goes down.
    if (state.mirror) {
      const mid = Math.round((state.width / 2) * state.zoom);
      ctx.fillStyle = 'rgba(126,180,214,.6)';
      for (let y = 0; y < h; y += 8) ctx.fillRect(mid - 1, y, 2, 4);
    }

    renderPreview();
  }

  /** The biggest whole zoom (3 or 2, falling back to 1) that keeps the "what
   *  you'll send" preview under PREVIEW_MAX_WIDTH wide. */
  function previewZoomFor(width: number): number {
    for (const zoom of [3, 2, 1]) {
      if (width * zoom <= PREVIEW_MAX_WIDTH) return zoom;
    }
    return 1;
  }

  /**
   * The drawing alone, on a light checkerboard, at up to 3x — so nobody has to
   * take our word for it that the faint reference isn't part of what ships.
   * Reads from `pix`, which syncPix() just filled with painted pixels only.
   */
  function renderPreview(): void {
    const canvas = el<HTMLCanvasElement>('previewcanvas');
    const zoom = previewZoomFor(state.width);
    const w = state.width * zoom;
    const h = state.height * zoom;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const pctx = canvas.getContext('2d');
    if (!pctx) return;
    pctx.imageSmoothingEnabled = false;

    pctx.fillStyle = '#f3ead8';
    pctx.fillRect(0, 0, w, h);
    pctx.fillStyle = '#ddceac';
    const cell = Math.max(4, zoom * 4);
    for (let y = 0; y < h; y += cell) {
      for (let x = ((y / cell) % 2) * cell; x < w; x += cell * 2) pctx.fillRect(x, y, cell, cell);
    }

    pctx.drawImage(pix, 0, 0, w, h);
  }

  function describeShape(): void {
    const [tw, th] = state.entry.placement.size;
    const rows = state.extraRows;
    const above =
      rows === 0
        ? 'There are no spare rows above the footprint just now, so the drawing stops at the roofline.'
        : `Above the footprint there ${rows === 1 ? 'is' : 'are'} ${plural(rows, 'spare row', 'spare rows')} of
           16 pixels for a roof, an awning or a sign.`;
    el<HTMLElement>('shape').textContent =
      `${state.entry.def.name} stands ${plural(tw, 'tile', 'tiles')} wide and ${plural(th, 'tile', 'tiles')} deep ` +
      `in ${state.entry.mapName}, so the canvas is ${state.width} pixels across and ${state.height} pixels tall. ` +
      above.replace(/\s+/g, ' ');
    el<HTMLElement>('rowslabel').textContent = `${plural(rows, 'row', 'rows')} above the footprint`;

    const footH = th * TILE;
    const minH = footH;
    const maxH = footH + MAX_EXTRA_ROWS * TILE;
    el<HTMLElement>('elsewheresize').textContent =
      `Right now this canvas is ${state.width} pixels wide and ${state.height} pixels tall. ` +
      `The width is fixed at ${state.width}; the height can be any multiple of 16 from ${minH} up to ${maxH}, ` +
      'depending on how many spare rows you leave for a roof, sign or awning — import one at any of those ' +
      'heights and the canvas follows it.';
  }

  function refreshChrome(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.tool'))) {
      button.classList.toggle('on', button.dataset.tool === state.tool);
    }
    for (const swatch of Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'))) {
      swatch.classList.toggle('on', Number(swatch.dataset.colour) === state.colour);
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.size'))) {
      button.classList.toggle('on', Number(button.dataset.size) === state.brushSize);
    }
    el<HTMLButtonElement>('rectfilled').classList.toggle('on', state.rectFilled);
    el<HTMLButtonElement>('mirror').classList.toggle('on', state.mirror);
    el<HTMLButtonElement>('grid').classList.toggle('on', state.showGrid);
    el<HTMLButtonElement>('reference').classList.toggle('on', state.showReference);
    el<HTMLElement>('guidenote').hidden = !state.showReference;
    el<HTMLButtonElement>('undo').disabled = state.undo.length === 0;
    el<HTMLButtonElement>('redo').disabled = state.redo.length === 0;
    el<HTMLButtonElement>('fewerrows').disabled = state.extraRows <= 0;
    el<HTMLButtonElement>('morerows').disabled = state.extraRows >= MAX_EXTRA_ROWS;
    describeShape();
  }

  function changed(): void {
    render();
    refreshChrome();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveDraft(state), 400);
  }

  function pushUndo(): void {
    state.undo.push(state.pixels.slice());
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
    state.redo.length = 0;
  }

  // --- the canvas, under a finger or a mouse ----------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let strokeSnapshot: Uint8Array | null = null;
  let last: { x: number; y: number } | null = null;
  let shapeStart: { x: number; y: number } | null = null;
  let panFrom: { x: number; y: number } | null = null;

  function cellAt(event: PointerEvent): { x: number; y: number } | null {
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return { x, y };
  }

  /** Sets one pixel, and its mirror twin too when mirror mode is on. Every
   *  tool below ends up here, so mirroring only has to live in one place. */
  function setPixel(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
    state.pixels[y * state.width + x] = value;
    if (state.mirror) {
      const mx = state.width - 1 - x;
      if (mx !== x) state.pixels[y * state.width + mx] = value;
    }
  }

  /** Pencil and eraser stamp a square of the chosen brush size: 1 pixel,
   *  a 2×2 anchored at the cursor, or a 3×3 centred on it. */
  function paint(x: number, y: number): void {
    const value = state.tool === 'eraser' ? TRANSPARENT : state.colour;
    switch (state.brushSize) {
      case 2:
        setPixel(x, y, value);
        setPixel(x + 1, y, value);
        setPixel(x, y + 1, value);
        setPixel(x + 1, y + 1, value);
        break;
      case 3:
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) setPixel(x + dx, y + dy, value);
        }
        break;
      default:
        setPixel(x, y, value);
    }
  }

  /**
   * Pure Bresenham: visits every pixel on a straight line between two points
   * and hands each to `plot`. A quick pencil swipe uses this (via `paint`) so
   * a fast drag leaves a line and not a dotted one; the Line tool uses it
   * (via `setPixel`) to commit the straight, pixel-perfect line it previews.
   */
  function plotLine(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** The Rectangle tool's outline or fill, between two opposite corners. */
  function plotRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    filled: boolean,
    plot: (x: number, y: number) => void
  ): void {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (filled) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) plot(x, y);
      }
      return;
    }
    for (let x = minX; x <= maxX; x++) {
      plot(x, minY);
      plot(x, maxY);
    }
    for (let y = minY; y <= maxY; y++) {
      plot(minX, y);
      plot(maxX, y);
    }
  }

  /** Redraws the Line or Rectangle tool's live preview from the stroke's
   *  starting snapshot, so dragging the end point around never leaves a
   *  trail — only the shape between the start and the current point shows. */
  function previewShape(to: { x: number; y: number }): void {
    if (!shapeStart || !strokeSnapshot) return;
    state.pixels = strokeSnapshot.slice();
    const plot = (x: number, y: number) => setPixel(x, y, state.colour);
    if (state.tool === 'line') plotLine(shapeStart.x, shapeStart.y, to.x, to.y, plot);
    else plotRect(shapeStart.x, shapeStart.y, to.x, to.y, state.rectFilled, plot);
  }

  function fillFrom(x: number, y: number): void {
    const target = state.pixels[y * state.width + x];
    const value = state.tool === 'eraser' ? TRANSPARENT : state.colour;
    if (target === value) return;
    const stack = [y * state.width + x];
    while (stack.length > 0) {
      const at = stack.pop() as number;
      if (state.pixels[at] !== target) continue;
      state.pixels[at] = value;
      if (state.mirror) {
        const px = at % state.width;
        const py = (at - px) / state.width;
        state.pixels[py * state.width + (state.width - 1 - px)] = value;
      }
      const cx = at % state.width;
      if (cx > 0) stack.push(at - 1);
      if (cx < state.width - 1) stack.push(at + 1);
      if (at >= state.width) stack.push(at - state.width);
      if (at + state.width < state.pixels.length) stack.push(at + state.width);
    }
  }

  function abortStroke(): void {
    if (!strokeSnapshot) return;
    state.pixels = strokeSnapshot;
    strokeSnapshot = null;
    last = null;
    shapeStart = null;
    render();
  }

  function centroid(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const point of pointers.values()) {
      x += point.x;
      y += point.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  }

  view.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      // A second finger means "move the canvas", never "paint". Whatever the
      // first finger did on the way down goes back the way it was.
      abortStroke();
      panFrom = centroid();
      return;
    }

    event.preventDefault();
    view.setPointerCapture(event.pointerId);
    const cell = cellAt(event);
    if (!cell) return;

    if (state.tool === 'eyedropper') {
      const value = state.pixels[cell.y * state.width + cell.x];
      if (value === TRANSPARENT) {
        state.tool = 'eraser';
        say('That spot is empty, so the eraser is ready instead.');
      } else {
        state.colour = value;
        state.tool = 'pencil';
        say(`Picked colour ${value}. Back to the pencil.`);
      }
      refreshChrome();
      return;
    }

    strokeSnapshot = state.pixels.slice();
    if (state.tool === 'fill') {
      fillFrom(cell.x, cell.y);
    } else if (state.tool === 'line' || state.tool === 'rect') {
      shapeStart = cell;
      previewShape(cell);
    } else {
      paint(cell.x, cell.y);
      last = cell;
    }
    render();
  });

  view.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size > 1) {
      const now = centroid();
      if (panFrom) {
        stage.scrollLeft -= now.x - panFrom.x;
        stage.scrollTop -= now.y - panFrom.y;
      }
      panFrom = now;
      return;
    }
    if (!strokeSnapshot || state.tool === 'fill') return;

    const cell = cellAt(event);
    if (!cell) return;

    if (state.tool === 'line' || state.tool === 'rect') {
      previewShape(cell);
      render();
      return;
    }

    if (last) plotLine(last.x, last.y, cell.x, cell.y, paint);
    else paint(cell.x, cell.y);
    last = cell;
    render();
  });

  function endPointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) panFrom = null;
    if (pointers.size > 0) return;
    if (view.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId);
    if (strokeSnapshot) {
      const before = strokeSnapshot;
      strokeSnapshot = null;
      last = null;
      shapeStart = null;
      const same = before.every((value, i) => value === state.pixels[i]);
      if (!same) {
        state.undo.push(before);
        if (state.undo.length > UNDO_LIMIT) state.undo.shift();
        state.redo.length = 0;
        changed();
        return;
      }
    }
    last = null;
    shapeStart = null;
    refreshChrome();
  }

  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);

  // --- canvas size, zoom, toggles ---------------------------------------

  function fitZoom(): number {
    const wide = Math.max(1, Math.floor((stage.clientWidth - 8) / state.width));
    const tall = Math.max(1, Math.floor((stage.clientHeight - 8) / state.height));
    return Math.min(12, Math.max(1, Math.min(wide, tall)));
  }

  function setRows(rows: number): void {
    const next = Math.min(MAX_EXTRA_ROWS, Math.max(0, rows));
    if (next === state.extraRows) return;
    pushUndo();
    const height = state.entry.placement.size[1] * TILE + next * TILE;
    const pixels = blankPixels(state.width, height);
    // Keep the drawing sitting on the ground: the footprint's bottom edge is
    // the fixed thing, and rows come and go from the sky above it.
    const shared = Math.min(height, state.height) * state.width;
    pixels.set(state.pixels.subarray(state.pixels.length - shared), pixels.length - shared);
    state.pixels = pixels;
    state.height = height;
    state.extraRows = next;
    reference = referenceCanvas(state.entry.placement, state.entry.def, state.width, state.height);
    state.zoom = fitZoom();
    changed();
    say(
      next === 0
        ? 'The canvas now stops at the roofline.'
        : `The canvas now has ${plural(next, 'row', 'rows')} of sky above the footprint.`
    );
  }

  el<HTMLButtonElement>('morerows').addEventListener('click', () => setRows(state.extraRows + 1));
  el<HTMLButtonElement>('fewerrows').addEventListener('click', () => setRows(state.extraRows - 1));

  el<HTMLDivElement>('toolrow').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.tool');
    if (!button || !button.dataset.tool) return;
    state.tool = button.dataset.tool as Tool;
    refreshChrome();
  });

  el<HTMLDivElement>('sizerow').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.size');
    if (!button || !button.dataset.size) return;
    state.brushSize = Number(button.dataset.size) as BrushSize;
    refreshChrome();
  });

  el<HTMLButtonElement>('rectfilled').addEventListener('click', () => {
    state.rectFilled = !state.rectFilled;
    refreshChrome();
  });

  el<HTMLButtonElement>('mirror').addEventListener('click', () => {
    state.mirror = !state.mirror;
    changed();
    say(
      state.mirror
        ? "Mirroring on — paint one side and the other fills in to match."
        : 'Mirroring is off; both sides are their own now.'
    );
  });

  el<HTMLDivElement>('palette').addEventListener('click', (event) => {
    const swatch = (event.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
    if (!swatch) return;
    state.colour = Number(swatch.dataset.colour);
    if (state.tool === 'eraser' || state.tool === 'eyedropper') state.tool = 'pencil';
    refreshChrome();
  });

  function undo(): void {
    const before = state.undo.pop();
    if (!before) return;
    state.redo.push(state.pixels.slice());
    state.pixels = before;
    fixHeight();
    changed();
  }

  function redo(): void {
    const next = state.redo.pop();
    if (!next) return;
    state.undo.push(state.pixels.slice());
    state.pixels = next;
    fixHeight();
    changed();
  }

  /** An undo may restore a canvas with a different number of rows above. */
  function fixHeight(): void {
    const height = state.pixels.length / state.width;
    if (height === state.height) return;
    state.height = height;
    state.extraRows = (height - state.entry.placement.size[1] * TILE) / TILE;
    reference = referenceCanvas(state.entry.placement, state.entry.def, state.width, state.height);
    state.zoom = fitZoom();
  }

  el<HTMLButtonElement>('undo').addEventListener('click', undo);
  el<HTMLButtonElement>('redo').addEventListener('click', redo);
  el<HTMLButtonElement>('zoomin').addEventListener('click', () => {
    state.zoom = Math.min(12, state.zoom + 1);
    changed();
  });
  el<HTMLButtonElement>('zoomout').addEventListener('click', () => {
    state.zoom = Math.max(1, state.zoom - 1);
    changed();
  });
  el<HTMLButtonElement>('grid').addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    changed();
  });
  el<HTMLButtonElement>('reference').addEventListener('click', () => {
    state.showReference = !state.showReference;
    changed();
    say(state.showReference ? 'The old placeholder is showing through, faintly.' : 'Just your drawing now.');
  });

  el<HTMLButtonElement>('clear').addEventListener('click', () => {
    pushUndo();
    state.pixels = blankPixels(state.width, state.height);
    changed();
    say('Cleared — and undo will bring it all back if you change your mind.');
  });

  // --- import and export -------------------------------------------------

  function toPngCanvas(): HTMLCanvasElement {
    syncPix();
    return pix;
  }

  function download(): void {
    toPngCanvas().toBlob((blob) => {
      if (!blob) {
        say('This browser would not make a PNG just now. Copying the code works just as well.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${state.entry.placement.id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      say(`Saved as ${state.entry.placement.id}.png. Thank you for painting it.`);
    }, 'image/png');
  }

  el<HTMLButtonElement>('export').addEventListener('click', download);
  el<HTMLButtonElement>('attachexport').addEventListener('click', download);

  // --- for anyone painting in another program ----------------------------

  const paletteLink = el<HTMLAnchorElement>('downloadpalette');
  paletteLink.href = packUrl(state.world.id, state.world.palette ?? 'palette.png');
  paletteLink.download = `${state.world.id}-palette.png`;

  el<HTMLButtonElement>('downloadhex').addEventListener('click', () => {
    const lines = state.palette.filter((colour): colour is string => colour !== null).map((colour) => colour.toUpperCase());
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.world.id}-palette.hex`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Saved ${plural(lines.length, 'colour', 'colours')} as ${state.world.id}-palette.hex — most pixel editors read that straight in.`);
  });

  const importInput = el<HTMLInputElement>('import');
  const importButton = el<HTMLButtonElement>('importbutton');

  // One control, one handler: a <button> fires `click` for a tap, a mouse and
  // the Enter or Space key alike, so the keyboard path costs nothing extra and
  // nothing can fire twice (hard rule 4).
  importButton.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    // Cleared straight away so choosing the same file twice still counts as a
    // change; the File itself is already in hand.
    importInput.value = '';
    if (!file) return;
    say('Reading that picture…');
    try {
      await importPicture(file);
    } catch (error) {
      say(error instanceof Error ? error.message : CANNOT_READ);
    }
  });

  const paletteRgbs = paletteRgb(state.palette);

  /** The palette index whose colour sits closest to this RGB triple. */
  function nearestPaletteIndex(r: number, g: number, b: number): number {
    return Math.max(0, nearestIn(paletteRgbs, r, g, b));
  }

  interface Picture {
    source: CanvasImageSource;
    width: number;
    height: number;
    release: () => void;
  }

  /**
   * Hands the file to the browser's own image decoder and takes back something
   * `drawImage` will accept. Nothing here reads PNG bytes by hand, so an
   * indexed PNG, a 16-bit one, an interlaced one and a JPEG a phone offered
   * from its camera roll all arrive the same way.
   *
   * `colorSpaceConversion: 'none'` is the load-bearing option. By default a
   * browser colour-manages the picture using whatever gAMA or ICC profile the
   * exporter wrote into it, which quietly shifts every pixel off the palette
   * it was painted with — the drawing still imports, it just comes out the
   * wrong colours. `premultiplyAlpha: 'none'` keeps a soft edge's colour exact
   * rather than rounding it through its own alpha.
   */
  async function openPicture(file: File): Promise<Picture> {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none'
        });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch {
        // An older browser may not take a File here, or may not know those
        // options. An <img> reads the same picture; it is only colour-managed,
        // and snapping to the palette takes care of that.
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('undecodable'));
        img.src = url;
      });
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url)
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(CANNOT_READ);
    }
  }

  /** The picture's pixels, straight, with no smoothing anywhere near them. */
  function pixelsOf(picture: Picture): Uint8ClampedArray {
    const scratch = document.createElement('canvas');
    scratch.width = picture.width;
    scratch.height = picture.height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser would not lend the studio a canvas to read the picture with.');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(picture.source, 0, 0);
    return ctx.getImageData(0, 0, picture.width, picture.height).data;
  }

  async function importPicture(file: File): Promise<void> {
    const picture = await openPicture(file);
    let report;
    try {
      if (!picture.width || !picture.height) throw new Error(CANNOT_READ);
      const outcome = fitImport(picture.width, picture.height, {
        width: state.entry.placement.size[0] * TILE,
        height: state.entry.placement.size[1] * TILE,
        tile: TILE,
        maxExtraRows: MAX_EXTRA_ROWS
      });
      if (!outcome.ok) throw new Error(outcome.message);
      report = snapToPalette(pixelsOf(picture), picture.width, outcome.fit, paletteRgbs);
    } finally {
      picture.release();
    }

    // Nothing above this line has touched the drawing, so a picture that could
    // not be used leaves the canvas — and the undo history — exactly as it was.
    const rowsBefore = state.extraRows;
    pushUndo();
    state.pixels = report.pixels;
    fixHeight();
    changed();
    say(describeImport(report, rowsBefore));
  }

  /** The faint reference facade, matched to the nearest palette colours. */
  function pixelsFromReference(): Uint8Array {
    const pixels = blankPixels(state.width, state.height);
    const scratch = document.createElement('canvas');
    scratch.width = state.width;
    scratch.height = state.height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) return pixels;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(reference, 0, 0);
    const { data } = ctx.getImageData(0, 0, state.width, state.height);
    for (let i = 0; i < pixels.length; i++) {
      const a = data[i * 4 + 3];
      if (a < 128) continue;
      pixels[i] = nearestPaletteIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    }
    return pixels;
  }

  el<HTMLButtonElement>('fromguide').addEventListener('click', () => {
    pushUndo();
    state.pixels = pixelsFromReference();
    changed();
    say('The guide is now real pixels of your own — paint over any of it you like.');
  });

  // --- bringing a code back ----------------------------------------------

  /**
   * Someone sent a drawing in last week and would like to carry on with it.
   * The code is sitting in their sent mail, so pasting it back here is the
   * whole of the round trip — no account, nothing kept on our side.
   */
  const pastePanel = el<HTMLDivElement>('pastepanel');
  const pasteToggle = el<HTMLButtonElement>('pastecode');
  const codeBox = el<HTMLTextAreaElement>('codebox');
  const codeStatus = el<HTMLParagraphElement>('codestatus');

  function sayCode(message: string, offer?: { href: string; label: string }): void {
    codeStatus.innerHTML = offer
      ? `${esc(message)} <a class="link" href="${esc(offer.href)}">${esc(offer.label)}</a>`
      : esc(message || ' ');
  }

  function showPaste(open: boolean): void {
    pastePanel.hidden = !open;
    pasteToggle.classList.toggle('on', open);
    pasteToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      sayCode('');
      codeBox.focus();
    }
  }

  pasteToggle.addEventListener('click', () => showPaste(pastePanel.hidden));
  el<HTMLButtonElement>('codecancel').addEventListener('click', () => {
    codeBox.value = '';
    showPaste(false);
    pasteToggle.focus();
  });

  /** Where a building lives in the studio, for offering someone the right one. */
  function studioLink(worldId: string, buildingId: string): string {
    return `?world=${encodeURIComponent(worldId)}&building=${encodeURIComponent(buildingId)}`;
  }

  function loadCode(text: string): void {
    if (!text.trim()) {
      sayCode(`Paste the code in first — it is the long line that starts with ${MAGIC}.`);
      return;
    }

    let drawing;
    try {
      drawing = decode(text);
    } catch (error) {
      sayCode(
        error instanceof CodeError
          ? error.message
          : 'That code would not read here. Copying the whole of it again usually sorts it out.'
      );
      return;
    }

    if (drawing.world !== state.world.id) {
      // We can't know from here whether that town is on this site, so the offer
      // is a link rather than a promise; the studio greets it kindly either way.
      sayCode(
        `That code was painted in a different town (${drawing.world}), so it belongs over there rather ` +
          'than here. Nothing is wrong with it.',
        { href: studioLink(drawing.world, drawing.building), label: 'Open it in that town' }
      );
      return;
    }

    if (drawing.building !== state.entry.placement.id) {
      const other = state.world.buildings[drawing.building];
      if (other) {
        sayCode(
          `That code is for ${other.name}, not ${state.entry.def.name} — an easy pair to mix up in a sent-mail folder.`,
          { href: studioLink(drawing.world, drawing.building), label: `Open ${other.name} instead` }
        );
      } else {
        sayCode(
          `That code is for a building ${state.world.title} doesn't list any more (${drawing.building}). ` +
            'The code is still perfectly good; there is just nowhere here to put it.'
        );
      }
      return;
    }

    const fit = fitCode(drawing.width, drawing.height, {
      width: state.entry.placement.size[0] * TILE,
      height: state.entry.placement.size[1] * TILE,
      tile: TILE,
      maxExtraRows: MAX_EXTRA_ROWS
    });
    if (!fit.ok) {
      sayCode(fit.message);
      return;
    }

    // A code can carry an index this world's palette has no colour for — from
    // another world, or from before a palette was tidied. Those pixels would
    // draw as nothing at all, so they are made properly clear and counted.
    const settled = settleCode(drawing.pixels, paletteRgbs);

    const rowsBefore = state.extraRows;
    pushUndo();
    state.pixels = settled.pixels;
    fixHeight();
    changed();

    codeBox.value = '';
    showPaste(false);
    pasteToggle.focus();

    const notes: string[] = [];
    if (fit.extraRows !== rowsBefore) {
      notes.push(
        fit.extraRows === 0
          ? 'It stops at the roofline, so the canvas came down to meet it.'
          : `It has ${plural(fit.extraRows, 'row', 'rows')} above the footprint, so the canvas made room.`
      );
    }
    if (settled.stray > 0) {
      notes.push(
        `${settled.stray} pixel${settled.stray === 1 ? '' : 's'} asked for a colour this palette hasn't got, ` +
          `so ${settled.stray === 1 ? 'it is' : 'they are'} clear now.`
      );
    }
    say(
      `Back on the canvas, just as the code left it.${notes.length ? ` ${notes.join(' ')}` : ''} ` +
        'Carry on wherever you like — and undo puts it back if you would rather.'
    );
  }

  el<HTMLButtonElement>('codeload').addEventListener('click', () => loadCode(codeBox.value));

  // --- sending -----------------------------------------------------------

  function currentCode(): string {
    return encode({
      world: state.world.id,
      building: state.entry.placement.id,
      width: state.width,
      height: state.height,
      pixels: state.pixels
    });
  }

  function isBlank(): boolean {
    return state.pixels.every((value) => value === TRANSPARENT);
  }

  function paintedShare(): number {
    let painted = 0;
    for (const value of state.pixels) if (value !== TRANSPARENT) painted++;
    return painted / state.pixels.length;
  }

  /**
   * A one-line, non-blocking nudge shown above the send buttons whenever the
   * faint reference is still on, or almost nothing has been painted — the two
   * situations where someone might not realise the guide isn't going with
   * their drawing. It never stops the send or copy it's attached to.
   */
  function maybeReminder(): void {
    const note = el<HTMLElement>('submitnote');
    if (state.showReference || paintedShare() < LIGHT_PAINT_SHARE) {
      note.textContent = "Just a reminder: only what you drew goes in the email; the faint building is a guide.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  async function copyCode(): Promise<void> {
    const code = currentCode();
    try {
      await navigator.clipboard.writeText(code);
      saySend('Copied. Paste it anywhere you like — a text, an email, a note to yourself.');
      return;
    } catch {
      // Clipboard permission, an old browser, or an insecure origin. Fall back
      // to the oldest trick there is.
    }
    const box = document.createElement('textarea');
    box.value = code;
    box.setAttribute('readonly', 'readonly');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, code.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    box.remove();
    saySend(
      copied
        ? 'Copied. Paste it anywhere you like.'
        : 'This browser keeps the clipboard to itself. Exporting a PNG and attaching it works just as well.'
    );
  }

  el<HTMLButtonElement>('copy').addEventListener('click', () => {
    maybeReminder();
    void copyCode();
  });

  function mailtoFor(body: string): string {
    const subject = `mainstreet art: ${state.entry.placement.id} (${state.world.id})`;
    return `mailto:${SUBMIT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function bodyLines(name: string): string[] {
    return [
      `Name for the credit: ${name}`,
      '',
      CONSENT,
      '',
      `Building: ${state.entry.def.name} (${state.entry.placement.id}) in ${state.world.title}`,
      `Canvas: ${state.width} by ${state.height} pixels`,
      ''
    ];
  }

  el<HTMLButtonElement>('send').addEventListener('click', () => {
    maybeReminder();
    const name = el<HTMLInputElement>('credit').value.trim();
    const consented = el<HTMLInputElement>('consent').checked;
    const attach = el<HTMLDivElement>('attach');

    if (!name) {
      saySend('Pop a name in first, so we know who to thank in the credits.');
      el<HTMLInputElement>('credit').focus();
      return;
    }
    if (!consented) {
      saySend('Tick the box below the name and it will be on its way.');
      return;
    }
    if (isBlank()) {
      saySend('The canvas is still empty — paint a little first and then send it.');
      return;
    }

    let code: string;
    try {
      code = currentCode();
    } catch (error) {
      saySend(error instanceof CodeError ? error.message : 'Something went awry making the code, sorry.');
      return;
    }

    const withCode = [...bodyLines(name), 'Here is the drawing, as a code:', '', code, ''].join('\n');
    if (encodeURIComponent(withCode).length <= MAILTO_BUDGET) {
      attach.hidden = true;
      // The click opens the mail app on every browser we know of; the link
      // stays on the page afterwards for the ones that quietly don't.
      const link = el<HTMLAnchorElement>('sendmail');
      link.href = mailtoFor(withCode);
      el<HTMLElement>('sendmailwrap').hidden = false;
      link.click();
      saySend('Your email app should be opening now. Thank you — this really does make the town.');
      return;
    }

    const withoutCode = [...bodyLines(name), 'My PNG is attached to this email.', ''].join('\n');
    el<HTMLElement>('attachnote').textContent =
      `This one is too detailed to fit in an email link, which is a lovely problem to have. ` +
      `Download the PNG and attach it to an email to ${SUBMIT_ADDRESS} — the two buttons below do both halves.`;
    el<HTMLAnchorElement>('attachmail').href = mailtoFor(withoutCode);
    attach.hidden = false;
    saySend(`Download the PNG and attach it to an email to ${SUBMIT_ADDRESS}.`);
  });

  // --- keyboard, for anyone at a desk ------------------------------------

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (meta) return;

    switch (event.key.toLowerCase()) {
      case 'b':
      case 'p':
        state.tool = 'pencil';
        break;
      case 'f':
        state.tool = 'fill';
        break;
      case 'e':
        state.tool = 'eraser';
        break;
      case 'i':
        state.tool = 'eyedropper';
        break;
      case 'l':
        state.tool = 'line';
        break;
      case 'r':
        state.tool = 'rect';
        break;
      case '1':
        state.brushSize = 1;
        break;
      case '2':
        state.brushSize = 2;
        break;
      case '3':
        state.brushSize = 3;
        break;
      case 'g':
        state.showGrid = !state.showGrid;
        changed();
        return;
      case 'v':
        state.showReference = !state.showReference;
        changed();
        return;
      case 'm':
        state.mirror = !state.mirror;
        changed();
        return;
      case ']':
      case '+':
      case '=':
        state.zoom = Math.min(12, state.zoom + 1);
        changed();
        return;
      case '[':
      case '-':
        state.zoom = Math.max(1, state.zoom - 1);
        changed();
        return;
      default:
        return;
    }
    refreshChrome();
  });

  window.addEventListener('resize', () => {
    state.zoom = fitZoom();
    render();
  });

  state.zoom = fitZoom();
  changed();
  say(`${plural(state.palette.filter((c) => c !== null).length, 'colour', 'colours')} to paint with. Take your time.`);
}

// --- drafts ------------------------------------------------------------------

function saveDraft(state: EditorState): void {
  try {
    localStorage.setItem(
      draftKey(state.world.id, state.entry.placement.id),
      JSON.stringify({ saved: Date.now(), code: encode({
        world: state.world.id,
        building: state.entry.placement.id,
        width: state.width,
        height: state.height,
        pixels: state.pixels
      }) })
    );
  } catch {
    // A full or blocked localStorage is not worth interrupting anyone over.
  }
}

function restoreDraft(state: EditorState): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(draftKey(state.world.id, state.entry.placement.id));
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as { code?: string };
    if (!saved.code) return;
    const drawing = decode(saved.code);
    const footW = state.entry.placement.size[0] * TILE;
    const footH = state.entry.placement.size[1] * TILE;
    const extra = (drawing.height - footH) / TILE;
    if (drawing.width !== footW || !Number.isInteger(extra) || extra < 0 || extra > MAX_EXTRA_ROWS) return;
    state.pixels = drawing.pixels;
    state.width = drawing.width;
    state.height = drawing.height;
    state.extraRows = extra;
  } catch {
    // An unreadable draft is simply not restored; the blank canvas is fine.
  }
}

// --- boot --------------------------------------------------------------------

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const worldId = params.get('world');

  if (!worldId) {
    try {
      const ids = await getJson<string[]>(`${BASE}worlds/index.json`);
      if (ids.length === 1) {
        location.replace(`?world=${encodeURIComponent(ids[0])}`);
        return;
      }
      renderWorldPicker(ids);
    } catch {
      kindly(
        'The studio needs to know which town you would like to paint in.',
        'Follow the "paint a building" link from the front page and it will bring the town along with it.'
      );
    }
    return;
  }

  let world: World;
  try {
    world = await getJson<World>(packUrl(worldId, 'world.json'));
  } catch {
    kindly(
      `We could not find a town called "${worldId}" to paint in.`,
      'It may have been renamed since that link was made. The front page has every town we have.'
    );
    return;
  }

  const entries: Entry[] = [];
  for (const map of Object.values(world.maps ?? {})) {
    for (const placement of map.buildings ?? []) {
      const def = world.buildings?.[placement.id];
      if (!def) continue;
      entries.push({ placement, def, mapName: map.name, painted: false });
    }
  }
  entries.sort((a, b) => a.def.name.localeCompare(b.def.name));

  const buildingId = params.get('building');
  const entry = entries.find((candidate) => candidate.placement.id === buildingId);

  if (!entry) {
    await Promise.all(
      entries.map(async (candidate) => {
        candidate.painted = await exists(packUrl(worldId, `assets/buildings/${candidate.placement.id}.png`));
      })
    );
    renderBuildingPicker(world, entries);
    if (buildingId) {
      const note = document.createElement('p');
      note.className = 'notice';
      note.textContent = `We could not find a building called "${buildingId}" in ${world.title}, so here is the whole street to choose from.`;
      app.prepend(note);
    }
    return;
  }

  let palette: (string | null)[];
  try {
    palette = await loadPalette(world);
  } catch {
    kindly(
      `${world.title} has not got its colour palette in place yet, so there is nothing to paint with in here today.`,
      'It is on its way. In the meantime a PNG painted in any editor is every bit as welcome.'
    );
    return;
  }

  if (palette.every((colour) => colour === null)) {
    kindly(`${world.title}'s palette came through empty, which is not something you did.`);
    return;
  }

  renderEditor(world, entry, palette);
}

void main().catch((error: unknown) => {
  kindly(
    'Something went sideways getting the studio ready, and that is on us.',
    error instanceof Error ? error.message : String(error)
  );
});
