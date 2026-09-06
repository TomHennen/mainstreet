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
import { CodeError, TRANSPARENT, decode, encode } from './codec';

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

const CONSENT =
  "I made this, I'm happy for it to appear in mainstreet with credit to the " +
  'name above, and I license it under the terms on the contributing page.';

const GUIDANCE = "Draw the storefront as you remember it; please don't paste a logo.";

type Tool = 'pencil' | 'fill' | 'eraser' | 'eyedropper';

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

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function inWords(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

function plural(n: number, one: string, many: string): string {
  return `${inWords(n)} ${n === 1 ? one : many}`;
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

function rgbOf(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
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
    zoom: 4,
    showGrid: true,
    showReference: true,
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

    <p class="statusline" id="status" role="status" aria-live="polite">&nbsp;</p>

    <section class="tools">
      <div class="row" id="toolrow">
        <button class="tool" data-tool="pencil">Pencil<kbd>B</kbd></button>
        <button class="tool" data-tool="fill">Fill<kbd>F</kbd></button>
        <button class="tool" data-tool="eraser">Eraser<kbd>E</kbd></button>
        <button class="tool" data-tool="eyedropper">Pick<kbd>I</kbd></button>
      </div>
      <div class="row">
        <button id="undo">Undo<kbd>⌘Z</kbd></button>
        <button id="redo">Redo<kbd>⇧⌘Z</kbd></button>
        <button id="zoomout">Zoom −<kbd>[</kbd></button>
        <button id="zoomin">Zoom +<kbd>]</kbd></button>
        <button id="grid" class="toggle">Grid<kbd>G</kbd></button>
        <button id="reference" class="toggle">Reference<kbd>R</kbd></button>
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
        <label class="button" for="import">Import a PNG</label>
        <input id="import" type="file" accept="image/png,image/*" hidden />
        <button id="export">Export a PNG</button>
        <button id="clear">Start again</button>
      </div>
      <p class="quiet">Painting in Aseprite or Piskel instead? Lovely — export a
        PNG the exact size above and import it here to send it in.</p>
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
  }

  function refreshChrome(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.tool'))) {
      button.classList.toggle('on', button.dataset.tool === state.tool);
    }
    for (const swatch of Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'))) {
      swatch.classList.toggle('on', Number(swatch.dataset.colour) === state.colour);
    }
    el<HTMLButtonElement>('grid').classList.toggle('on', state.showGrid);
    el<HTMLButtonElement>('reference').classList.toggle('on', state.showReference);
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
  let panFrom: { x: number; y: number } | null = null;

  function cellAt(event: PointerEvent): { x: number; y: number } | null {
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return { x, y };
  }

  function paint(x: number, y: number): void {
    const at = y * state.width + x;
    if (state.tool === 'eraser') state.pixels[at] = TRANSPARENT;
    else state.pixels[at] = state.colour;
  }

  function line(from: { x: number; y: number }, to: { x: number; y: number }): void {
    // Straight Bresenham, so a quick swipe leaves a line and not a dotted one.
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      paint(x, y);
      if (x === to.x && y === to.y) break;
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

  function fillFrom(x: number, y: number): void {
    const target = state.pixels[y * state.width + x];
    const value = state.tool === 'eraser' ? TRANSPARENT : state.colour;
    if (target === value) return;
    const stack = [y * state.width + x];
    while (stack.length > 0) {
      const at = stack.pop() as number;
      if (state.pixels[at] !== target) continue;
      state.pixels[at] = value;
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
    if (state.tool === 'fill') fillFrom(cell.x, cell.y);
    else {
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
    if (last) line(last, cell);
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

  const importInput = el<HTMLInputElement>('import');
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      await importPng(file);
    } catch (error) {
      say(error instanceof Error ? error.message : 'That file would not open here, sorry.');
    }
  });

  async function importPng(file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width !== state.width || bitmap.height !== state.height) {
      const rowsFor = (bitmap.height - state.entry.placement.size[1] * TILE) / TILE;
      const hint =
        bitmap.width === state.width && Number.isInteger(rowsFor) && rowsFor >= 0 && rowsFor <= MAX_EXTRA_ROWS
          ? ` Set the rows above to ${inWords(rowsFor)} and it will drop straight in.`
          : '';
      bitmap.close();
      throw new Error(
        `That PNG is ${bitmap.width}×${bitmap.height}, and this canvas is ${state.width}×${state.height}. ` +
          `Resize it to match and it is very welcome.${hint}`
      );
    }

    const scratch = document.createElement('canvas');
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser would not give the studio a canvas to read the PNG with.');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
    const exact = new Map<string, number>();
    state.palette.forEach((colour, index) => {
      if (colour) exact.set(colour.toLowerCase(), index);
    });

    pushUndo();
    const pixels = blankPixels(state.width, state.height);
    let nudged = 0;
    for (let i = 0; i < pixels.length; i++) {
      const a = data[i * 4 + 3];
      if (a < 128) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      const found = exact.get(hex);
      if (found !== undefined) {
        pixels[i] = found;
        continue;
      }
      nudged++;
      let best = 0;
      let bestDistance = Infinity;
      state.palette.forEach((colour, index) => {
        if (!colour) return;
        const [pr, pg, pb] = rgbOf(colour);
        const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      pixels[i] = best;
    }
    state.pixels = pixels;
    changed();
    say(
      nudged === 0
        ? 'Imported, every colour already on the palette. Lovely.'
        : `Imported. ${nudged} pixel${nudged === 1 ? '' : 's'} sat just off the palette and moved to the nearest ` +
          'colour on it, which usually looks the same.'
    );
  }

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

  el<HTMLButtonElement>('copy').addEventListener('click', () => void copyCode());

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
      case 'g':
        state.showGrid = !state.showGrid;
        changed();
        return;
      case 'r':
        state.showReference = !state.showReference;
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
