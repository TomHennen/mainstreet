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
 * touch handlers anywhere, so nothing can fire twice. The strip of door and
 * plaque markers under it is the same one path — drag a marker with a finger
 * or a mouse — with a row of buttons beside the drawing for anyone who would
 * rather not drag, or is using a keyboard. One finger paints; the moment a
 * second finger lands the gesture becomes a pinch — zoom and pan together —
 * and whatever the first finger had started goes back the way it was, so
 * getting a closer look never leaves a stray dot behind. Lock puts the
 * drawing hand away entirely, so a finger can scroll the page past the
 * canvas. The ordinary controls are <button>s on `click`, which is one path
 * too and is the one a keyboard can reach.
 */
import { CodeError, MAGIC, TRANSPARENT, decode, encode } from './codec';
import {
  describeImport,
  fitCode,
  fitImport,
  nearestIn,
  ordinal,
  paletteRgb,
  plural,
  rgbOf,
  settleCode,
  snapToPalette
} from './artwork';
import { DOOR_ARROW_H, DOOR_ARROW_W, paintDoorArrow } from '../engine/glyphs';

// --- constants ---------------------------------------------------------------

const BASE = import.meta.env.BASE_URL;
const TILE = 16;
/** Head-room the engine's placeholder facade draws above the footprint. */
const OVERHEAD = 20;
/** The plaque the engine draws beside every door (engine/art.ts plaqueArt). */
const PLAQUE_W = 6;
const PLAQUE_H = 5;
const PLAQUE_LIFT = 4;
/** How far the arrow's bottom edge sits above the bottom of the doorstep tile
 *  — reference only, since the arrow itself (`engine/glyphs.ts`
 *  `paintDoorArrow`, also engine/art.ts `doorArrowArt`) lives on the tile
 *  rather than baked into the facade the way this preview is. */
const DOOR_ARROW_LIFT = 1;
/** Most spare rows of 16px an artist may add above the footprint. */
const MAX_EXTRA_ROWS = 3;
const DEFAULT_EXTRA_ROWS = 1;
const UNDO_LIMIT = 60;
const SUBMIT_ADDRESS = 'tom.hennen+mainstreet@gmail.com';
/** Above this many characters of encoded body, a mailto stops being reliable. */
const MAILTO_BUDGET = 1800;
/**
 * The same for a webmail compose link, which is an ordinary https URL and so
 * carries a great deal more than a mailto ever will. Deliberately well under
 * what any browser would actually refuse.
 */
const WEBMAIL_BUDGET = 6000;
/**
 * Webmail "start a new message" links, for the many desktop browsers with no
 * mail app to hand a mailto: to. Neither company documents these, so they are
 * offered beside the address in plain text rather than instead of it — if one
 * of them ever stops working, copying the message still sends the drawing.
 */
const GMAIL_COMPOSE = 'https://mail.google.com/mail/?view=cm&fs=1';
const OUTLOOK_COMPOSE = 'https://outlook.live.com/mail/0/deeplink/compose';
/** Below this share of painted pixels, submitting gets a gentle reminder. */
const LIGHT_PAINT_SHARE = 0.02;
/** The "what you'll send" preview never gets wider than this on screen. */
const PREVIEW_MAX_WIDTH = 260;
/**
 * The door and plaque markers. Deliberately not palette colours: a marker has
 * to look like a marker and never like something somebody painted.
 */
const DOOR_MARK = '#ffd166';
const PLAQUE_MARK = '#8fd6a8';
/**
 * Height of the little strip of draggable markers under the canvas, in CSS
 * pixels: trim under a mouse, and a full 44 where a finger has to land on it.
 */
const MARKER_STRIP = 24;
const MARKER_STRIP_TOUCH = 44;
/** Where style.css draws the line between a phone and a desk, in one place. */
const PHONE = '(pointer: coarse), (max-width: 719px)';

function onAPhone(): boolean {
  return window.matchMedia(PHONE).matches;
}

function stripHeight(): number {
  return onAPhone() ? MARKER_STRIP_TOUCH : MARKER_STRIP;
}

/** The closest the canvas will come: screen pixels per drawing pixel. */
const MAX_ZOOM = 12;

type Tool = 'pencil' | 'fill' | 'eraser' | 'eyedropper' | 'line' | 'rect';
type BrushSize = 1 | 2 | 3;
type Marker = 'door' | 'plaque';

const CONSENT =
  "I made this, I'm happy for it to appear in mainstreet with credit to the " +
  'name above, and I license it under the terms on the contributing page.';

const GUIDANCE = "Draw the storefront as you remember it; please don't paste a logo.";

const GESTURES =
  'One finger paints; two fingers zoom and pan, and so does ctrl with a mouse ' +
  'wheel. Lock the canvas when you would rather a finger scrolled the page past it.';

/**
 * What the status line says when a tool is chosen — the same courtesy the
 * eyedropper has always had, now given to all six, so choosing a tool on a
 * phone tells you what you have in your hand without scrolling anywhere.
 */
const TOOL_SAID: Record<Tool, string> = {
  pencil: 'Pencil. One finger paints, and a drag draws a line.',
  fill: 'Fill. Tap a patch and the whole of it takes the colour.',
  eraser: 'Eraser. Tap or drag to take the paint back off.',
  eyedropper: 'Pick. Tap a pixel to borrow its colour.',
  line: 'Line. Drag from one end of it to the other.',
  rect: 'Rect. Drag out a box — Filled makes it solid.'
};

/** The most colours the palette bar keeps beside the one in hand. */
const RECENT_SHOWN = 7;

/**
 * Colour families for the full palette, worked out from the colours themselves
 * at runtime (hue and saturation, below) rather than from any world's palette
 * order — so grouping them costs no world its own arrangement, and hard rule 1
 * holds.
 */
const FAMILIES = ['Neutrals', 'Reds', 'Oranges and yellows', 'Greens', 'Blues', 'Purples and pinks'];

const LOCK_ON = 'Locked, so a finger can scroll the page past the drawing. Two fingers still zoom and pan.';

const LOCK_OFF = 'Unlocked — one finger paints again.';

const CANNOT_READ =
  "That file would not open here as a picture, and it may well be nothing you did. " +
  'A PNG saved straight out of a pixel editor usually goes in first time — and if this one ' +
  'stays stubborn, emailing it to us works just as well.';

const IMPROVE_SUCCESS =
  "Here's the painting as it is in the game. Change whatever you like; the rest stays.";

const IMPROVE_FAILURE =
  "Couldn't fetch the current painting just now, so this starts from the guide instead.";

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
  plaque?: [number, number] | false;
  /** Map id of this building's interior, if it has one yet — engine/schema.ts. */
  interior?: string;
}

/**
 * Where the engine hangs this building's plaque — a small copy of
 * engine/schema.ts's rule, because the Studio reads world packs rather than
 * importing the engine. Right of the door, or left of it when the door is
 * already in the building's right-most column; `false` means no plaque.
 */
function plaqueTile(placement: Placement): [number, number] | null {
  if (placement.plaque === false) return null;
  if (placement.plaque) return placement.plaque;
  const rightMost = placement.pos[0] + placement.size[0] - 1;
  return [placement.door[0] + (placement.door[0] >= rightMost ? -1 : 1), placement.door[1]];
}

interface MapDef {
  name: string;
  buildings?: Placement[];
}

/**
 * Where this world's finished art goes (engine/schema.ts `Submit`). The form
 * and every field id are the world pack's, never the Studio's: a world that
 * configures one gets a Send that opens that form's own page, prefilled, in a
 * new tab; a world that doesn't gets the older email route. No address of
 * either kind is written here.
 */
interface SubmitArt {
  /** The form's post address — a Google Form's own `formResponse` URL. */
  form: string;
  /** The form's own page to open, if it isn't `form` with `/formResponse`
   *  swapped for `/viewform` (see `viewformUrl`). */
  page?: string;
  fields: { building: string; world: string; credit: string; code: string; notes?: string };
}

interface World {
  id: string;
  title: string;
  subtitle?: string;
  submit?: { art?: SubmitArt };
  palette?: string;
  /** What this world's palette is called, and where it lives, if the pack says
   *  — for anyone painting in an editor that can fetch a palette by name. */
  paletteName?: string;
  paletteLink?: string;
  buildings: Record<string, BuildingDef>;
  maps: Record<string, MapDef>;
}

interface Entry {
  placement: Placement;
  def: BuildingDef;
  /** The map the building stands on, for grouping the picker by village. */
  mapId: string;
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

/**
 * The contributing page lives one level up from the studio, wherever we are.
 * `anchor`, when given, points at one heading on it by id (scripts/build-
 * site.mjs gives every heading one) — a page and a spot on it in one link.
 */
function contributingUrl(anchor?: string): string {
  const url = new URL('../contributing/', new URL(BASE, location.href));
  if (anchor) url.hash = anchor;
  return url.href;
}

/**
 * The game itself, sibling to wherever the Studio is running (dev and built
 * both serve `/<world>/` and `/studio/` side by side — see
 * scripts/build-site.mjs and vite.config.ts's worldPacks plugin). Tom's
 * playtest feedback: painters were leaving the game to paint and not finding
 * their way back, so the Studio's own header now points here rather than at
 * the building picker.
 */
function gameUrl(worldId: string): string {
  return new URL(`../${worldId}/`, new URL(BASE, location.href)).href;
}

/**
 * The Studio's header, once a world is known: `home` goes back to the game
 * itself, and a second link keeps the picker — every building in this world —
 * one tap away, which is what `home` used to do on its own.
 */
function setHeader(world: World): void {
  home.href = gameUrl(world.id);
  home.textContent = `Back to ${world.title}`;
  const all = document.getElementById('allbuildings') as HTMLAnchorElement | null;
  if (all) {
    all.href = `?world=${encodeURIComponent(world.id)}`;
    all.hidden = false;
  }
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

/**
 * A colour's lightness, 0 to 1 — the ordering inside a family, so a wall grey
 * and a shadow grey are not the same distance apart on screen as in the file.
 */
function lightnessOf(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/**
 * Which of FAMILIES a colour belongs in, measured from the colour itself: a
 * washed-out or nearly black/white one is a neutral, and everything else falls
 * where its hue falls. Nothing about any particular palette is written down
 * here, so a world that ships a different one is grouped just as sensibly
 * (hard rule 1).
 */
function hueFamily(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  if (saturation < 0.18 || light < 0.07 || light > 0.95) return 0;

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;

  if (hue < 20 || hue >= 330) return 1;
  if (hue < 70) return 2;
  if (hue < 165) return 3;
  if (hue < 260) return 4;
  return 5;
}

// --- the placeholder facade, as a faint reference ----------------------------

/**
 * A rough redrawing of the engine's unpainted facade (engine/art.ts) at the
 * same scale, so an artist can see where the door and the sign sit today. It
 * is a reference, not a template: nobody has to keep any of it — except the
 * plaque, which the engine draws over the finished art either way.
 *
 * `doorCol` and `plaqueCol` are tile columns across the front of the building,
 * counting from 0 at its left edge — wherever the artist has put the markers,
 * which is where the town will end up putting them too. `plaqueCol` is null
 * for a building that has no plaque. `hasInterior` adds the door arrow a
 * door with an interior gets (DESIGN.md §2); the marker doesn't move, since
 * nothing here drags it.
 */
function referenceCanvas(
  placement: Placement,
  def: BuildingDef,
  width: number,
  height: number,
  doorCol: number,
  plaqueCol: number | null,
  hasInterior: boolean
): HTMLCanvasElement {
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

  const doorX = doorCol * TILE;
  ctx.fillStyle = '#3a2c1e';
  ctx.fillRect(doorX + 3, top + OVERHEAD + bodyH - 14, 10, 14);

  // The engine hangs its own little plaque here, over whatever is painted
  // beneath it, so nobody has to draw one.
  if (plaqueCol !== null) {
    const plaqueX = plaqueCol * TILE + (TILE - PLAQUE_W) / 2;
    const plaqueY = height - PLAQUE_LIFT - PLAQUE_H;
    ctx.fillStyle = '#8a6a35';
    ctx.fillRect(plaqueX, plaqueY, PLAQUE_W, PLAQUE_H);
    ctx.fillStyle = '#d8b268';
    ctx.fillRect(plaqueX, plaqueY, PLAQUE_W, 1);
  }

  // A door with an interior gets the engine's own arrow on its doorstep,
  // pointing up into the door — over whatever is painted beneath, so nobody
  // has to draw one (DESIGN.md §2). The door still reads the standing sign
  // to an A press or a tap; it grows no second marker.
  if (hasInterior) {
    const arrowX = doorX + (TILE - DOOR_ARROW_W) / 2;
    const arrowY = height - DOOR_ARROW_LIFT - DOOR_ARROW_H;
    // engine/glyphs.ts paintDoorArrow, so the two can never drift apart.
    paintDoorArrow(ctx, arrowX, arrowY);
  }

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
  setHeader(world);

  const card = (entry: Entry) => {
    const [w, h] = entry.placement.size;
    const state = entry.painted
      ? '<span class="tag painted">already painted — repaints welcome</span>'
      : '<span class="tag">waiting for paint</span>';
    return `
      <li>
        <a href="?world=${encodeURIComponent(world.id)}&amp;building=${encodeURIComponent(entry.placement.id)}">
          <strong>${esc(entry.def.name)}</strong>
          ${state}
          <span class="quiet">${w * TILE} pixels across · ${esc(plural(w, 'tile', 'tiles'))} wide,
            ${esc(plural(h, 'tile', 'tiles'))} deep</span>
        </a>
      </li>`;
  };

  // One heading per village, in the order the world pack lists them, with the
  // buildings still waiting for paint first — the person we most hope for is
  // someone from one of these places, looking for the shop they walk past.
  const villages = Object.keys(world.maps ?? {})
    .map((mapId) => {
      const mine = entries.filter((entry) => entry.mapId === mapId);
      if (!mine.length) return '';
      const waiting = mine.filter((entry) => !entry.painted);
      const painted = mine.filter((entry) => entry.painted);
      return `
      <section class="village">
        <h2>${esc(mine[0].mapName)}</h2>
        <ul class="cards">${[...waiting, ...painted].map(card).join('')}</ul>
      </section>`;
    })
    .join('');

  app.innerHTML = `
    <section class="masthead">
      <h1>Paint a building in ${esc(world.title)}</h1>
      <p class="lede">Pick one you know and paint the front of it. ${esc(GUIDANCE)}</p>
      <p class="quiet">Rather draw in an app? Any pixel-art app works with
        ${
          world.paletteName
            ? world.paletteLink
              ? `the <a class="link" href="${esc(world.paletteLink)}" rel="noreferrer">${esc(world.paletteName)}</a> palette.`
              : `the ${esc(world.paletteName)} palette.`
            : 'our palette.'
        }
        <a class="link" href="${esc(contributingUrl('apps'))}">Which apps?</a></p>
    </section>
    ${villages}
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
  /** Colours lately painted with, newest first — the palette bar's short row. */
  recent: number[];
  tool: Tool;
  brushSize: BrushSize;
  rectFilled: boolean;
  mirror: boolean;
  zoom: number;
  showGrid: boolean;
  showReference: boolean;
  /** Locked: one finger scrolls the page past the canvas instead of painting. */
  locked: boolean;
  /** Tile column the door goes in, counting from 0 at the building's left edge. */
  doorCol: number;
  /** The same for the plaque, or null for a building that has none. */
  plaqueCol: number | null;
  /** Where the town has them today, so "Reset" and the code both know. */
  defaultDoorCol: number;
  defaultPlaqueCol: number | null;
  /** Whether this building has an interior yet — the door arrow the
   *  reference draws only for one that does (DESIGN.md §2). */
  hasInterior: boolean;
  undo: Uint8Array[];
  redo: Uint8Array[];
  /**
   * The URL asked for `?improve=1` (or bare `?improve`) — run the same load
   * "Improve it?" does, once, right after `wireEditor` finishes setting up.
   * Ignored on a building with no shipped facade (DESIGN.md §2).
   */
  autoImprove: boolean;
}

/**
 * Which columns a code should carry: both of them once either has been moved,
 * and neither while they are still where the town put them — an untouched
 * drawing sends exactly the code it always did.
 */
function placedColumns(state: EditorState): { door?: number; plaque?: number } {
  const doorMoved = state.doorCol !== state.defaultDoorCol;
  const plaqueMoved = state.plaqueCol !== null && state.plaqueCol !== state.defaultPlaqueCol;
  if (!doorMoved && !plaqueMoved) return {};
  if (state.plaqueCol === null) return { door: state.doorCol };
  return { door: state.doorCol, plaque: state.plaqueCol };
}

/** The whole drawing as the codec wants it — the one place that assembles it. */
function drawingOf(state: EditorState): Parameters<typeof encode>[0] {
  return {
    world: state.world.id,
    building: state.entry.placement.id,
    width: state.width,
    height: state.height,
    pixels: state.pixels,
    ...placedColumns(state)
  };
}

/**
 * Takes the door and plaque columns a code carries, if it carries any. A code
 * written before this part of the format existed says nothing about them, and
 * the markers simply stay where the town has them.
 */
function adoptColumns(state: EditorState, drawing: { door?: number; plaque?: number }): boolean {
  const columns = state.entry.placement.size[0];
  const fits = (col: number | undefined): col is number =>
    col !== undefined && Number.isInteger(col) && col >= 0 && col < columns;
  if (!fits(drawing.door)) return false;

  state.doorCol = drawing.door;
  if (state.plaqueCol !== null && fits(drawing.plaque) && drawing.plaque !== drawing.door) {
    state.plaqueCol = drawing.plaque;
  }
  // The codec never hands back two markers on one column, but a plaque left
  // sitting under the door would be a confusing thing to draw, so it steps
  // aside rather than doubling up.
  if (state.plaqueCol === state.doorCol) {
    const aside = state.doorCol > 0 ? state.doorCol - 1 : 1;
    state.plaqueCol = aside < columns ? aside : null;
  }
  return true;
}

/** "3rd column from the left" — how a person would say where a marker is. */
function whereIs(col: number): string {
  return `${ordinal(col + 1)} column from the left`;
}

function draftKey(worldId: string, buildingId: string): string {
  return `mainstreet.studio.v1.${worldId}.${buildingId}`;
}

function blankPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  pixels.fill(TRANSPARENT);
  return pixels;
}

function renderEditor(world: World, entry: Entry, palette: (string | null)[], autoImprove: boolean): void {
  const { placement, def } = entry;
  const footW = placement.size[0] * TILE;
  const footH = placement.size[1] * TILE;
  const columns = placement.size[0];

  // Where the town has the door and the plaque today. A plaque that this world
  // has switched off, or has deliberately hung somewhere off the front of the
  // building, gets no marker and is left exactly as it is.
  const inFront = (tile: [number, number] | null): number | null => {
    if (!tile) return null;
    const col = tile[0] - placement.pos[0];
    return col >= 0 && col < columns ? col : null;
  };
  const doorCol = inFront(placement.door) ?? 0;
  const plaqueDefault = columns > 1 ? inFront(plaqueTile(placement)) : null;
  const hasInterior = Boolean(placement.interior);

  const state: EditorState = {
    world,
    entry,
    palette,
    width: footW,
    height: footH + DEFAULT_EXTRA_ROWS * TILE,
    extraRows: DEFAULT_EXTRA_ROWS,
    pixels: blankPixels(footW, footH + DEFAULT_EXTRA_ROWS * TILE),
    colour: palette.findIndex((c) => c !== null),
    recent: [],
    tool: 'pencil',
    brushSize: 1,
    rectFilled: false,
    mirror: false,
    zoom: 4,
    showGrid: true,
    showReference: false,
    locked: false,
    doorCol,
    plaqueCol: plaqueDefault,
    defaultDoorCol: doorCol,
    defaultPlaqueCol: plaqueDefault,
    hasInterior,
    undo: [],
    redo: [],
    autoImprove
  };
  if (state.colour < 0) state.colour = 0;

  restoreDraft(state);

  here.textContent = def.name;
  setHeader(world);

  // Named in the world pack, never here (hard rule 1): a world that says what
  // its palette is called gets a line about it, and one that doesn't, doesn't.
  const paletteNamed = world.paletteName
    ? ` The palette is called ${esc(world.paletteName)}` +
      (world.paletteLink
        ? `, and it lives at <a class="link" href="${esc(world.paletteLink)}" rel="noreferrer">${esc(world.paletteLink)}</a>.`
        : '.')
    : '';

  const usable = palette.filter((colour) => colour !== null).length;

  const swatch = (index: number, colour: string) =>
    `<button class="swatch" data-colour="${index}" style="background:${esc(colour)}"
       title="Colour ${index}" aria-label="Colour ${index}, ${esc(colour)}"></button>`;

  // The whole palette, in families worked out from the colours themselves
  // (hueFamily, above) and lightest first inside each — a finding order rather
  // than the ramp order a palette file is written in. No world's palette is
  // named or reordered on disk by any of this.
  const families = FAMILIES.map((label, family) => {
    const members = palette
      .map((colour, index) => ({ colour, index }))
      .filter((entry): entry is { colour: string; index: number } => entry.colour !== null)
      .filter((entry) => hueFamily(entry.colour) === family)
      .sort((a, b) => lightnessOf(b.colour) - lightnessOf(a.colour));
    if (!members.length) return '';
    return `<div class="palettegroup"><span class="quiet">${esc(label)}</span>
        <div class="palette">${members.map((entry) => swatch(entry.index, entry.colour)).join('')}</div>
      </div>`;
  }).join('');

  // Where this world's finished art goes, if the pack says (hard rule 1). With
  // a form, Send posts to it and that is the whole of the journey; without one,
  // Send hands the drawing to the painter's own email app as it always has.
  const art = world.submit?.art ?? null;

  const notesField = art?.fields.notes
    ? `<label class="field">
        <span>Anything you'd like to say with it? (optional)</span>
        <textarea id="notes" rows="2" spellcheck="true"
          placeholder="Which corner it is on, what you remember about it — anything at all."></textarea>
      </label>`
    : '';

  // Shown once Send has actually gone somewhere — the game itself, one tap
  // away, so painting a building never costs anyone their place in it (Tom's
  // playtest note: people were leaving the game to paint and not finding
  // their way back). The same pair appears after every kind of send.
  const afterSend = `
      <div class="row" id="backtogamerow" hidden>
        <a class="button" id="backtogame" href="${esc(gameUrl(world.id))}">Back to the game</a>
      </div>
      <p class="quiet" id="aftersendnote" hidden>Your building will be painted in the
        game once Tom has it; the plaque beside its door will say who painted it.</p>`;

  const sendStep = art
    ? `<div class="row sendrow">
        <button id="send" class="primary">Send it to the town</button>
        <button id="copycode" hidden>Copy the code</button>
      </div>
      <p class="statusline" id="sendstatus" role="status" aria-live="polite">&nbsp;</p>
      ${afterSend}

      <!--
        The real link Send activates — a plain <a target="_blank"
        rel="noopener">, so a pop-up blocker never eats it and there is still
        exactly one pointer path (CLAUDE.md #4). It carries nobody anywhere
        until Send sets its href and clicks it, in the same gesture.
      -->
      <a id="sendform" class="offscreen" href="#" target="_blank" rel="noopener"
         tabindex="-1" aria-hidden="true">Open the form</a>

      <!--
        Pressing Submit on Google's own page is between the painter and
        Google — the studio cannot see it happen, any more than it could read
        a cross-origin post's answer. So there is still one small insurance
        policy tucked under here — the code, and an address to paste it to.
      -->
      <details class="elsewhere" id="insurance" hidden>
        <summary>Didn't go through?</summary>
        <div class="elsewhere-body">
          <p class="quiet">Paste the code into a note to
            <strong class="address">${esc(SUBMIT_ADDRESS)}</strong> and it lands in the same place.</p>
          <div class="row">
            <button id="copy" data-status="fallbackstatus">Copy the code</button>
          </div>
          <p class="statusline" id="fallbackstatus" role="status" aria-live="polite">&nbsp;</p>
        </div>
      </details>`
    : `<div class="row sendrow">
        <button id="send" class="primary">Open an email with my drawing</button>
        <button id="copy">Copy the code</button>
      </div>
      <p class="statusline" id="sendstatus" role="status" aria-live="polite">&nbsp;</p>
      ${afterSend}

      <!--
        Shown after every send, never only after a failed one. A mailto: click
        that goes nowhere — which is what a desktop browser with no mail app
        does — looks exactly like one that worked, so the studio cannot claim
        it worked. The address sits here as plain, selectable text: whatever
        else on this panel a browser declines to do, that always sends.
      -->
      <div class="fallback" id="fallback" hidden>
        <p class="quiet" id="fallbacknote"></p>
        <p class="address">Send it to <strong>${esc(SUBMIT_ADDRESS)}</strong></p>
        <div class="row">
          <button id="copymessage" class="primary">Copy the whole message</button>
          <button id="fallbackcode">Copy just the code</button>
          <button id="attachexport">Download the PNG</button>
        </div>
        <p class="quiet" id="webmailnote">Or open a new message in your webmail,
          with the address, the subject and the drawing already written in:</p>
        <div class="row">
          <a class="button" id="gmail" href="#" target="_blank" rel="noreferrer">Gmail</a>
          <a class="button" id="outlook" href="#" target="_blank" rel="noreferrer">Outlook on the web</a>
          <a class="button" id="sendmail" href="#">Your own email app</a>
        </div>
        <p class="statusline" id="fallbackstatus" role="status" aria-live="polite">&nbsp;</p>
      </div>`;

  const howItWorks = art
    ? `<p><strong>How this works:</strong> your drawing becomes a short line of
        text, and Send opens a short form in a new tab with it already filled
        in, alongside the name you would like on it. You press Submit there
        yourself, on Google's own page — no account, no email app, and
        nothing leaves this page until you press Send.</p>`
    : `<p><strong>How this works:</strong> your drawing becomes a short line of
        text, and the studio hands it to you in a message ready to send — to
        your own email app, to your webmail, or on the clipboard if you would
        rather paste it somewhere yourself. Nothing leaves this page until you
        send it.</p>`;

  app.innerHTML = `
    <section class="masthead">
      <h1>${esc(def.name)}</h1>
      <p class="where" id="shape"></p>
    </section>

    <!-- Zoom and Lock ride on the canvas frame, since both are about the
         canvas rather than about the drawing. -->
    <div class="frame">
      <div class="framebar">
        <button id="zoomout" aria-label="Zoom out">−<kbd>[</kbd></button>
        <span class="quiet zoomlevel" id="zoomlevel">×4</span>
        <button id="zoomin" aria-label="Zoom in">+<kbd>]</kbd></button>
        <span class="framespacer"></span>
        <button id="lock" class="toggle" aria-pressed="false"
          aria-label="Lock the canvas, so a finger scrolls the page past it">Lock<kbd>K</kbd></button>
      </div>
      <div class="stage" id="stage">
        <div class="canvasstack">
          <canvas id="view" role="img" aria-label="The drawing, ${esc(def.name)}"></canvas>
          <canvas id="markers" aria-hidden="true"></canvas>
        </div>
      </div>
    </div>

    <p class="statusline" id="status" role="status" aria-live="polite">&nbsp;</p>

    <section class="tools" id="tools">
      <div class="row" id="toolrow">
        <button class="tool" data-tool="pencil">Pencil<kbd>B</kbd></button>
        <button class="tool" data-tool="fill">Fill<kbd>F</kbd></button>
        <button class="tool" data-tool="eraser">Eraser<kbd>E</kbd></button>
        <button class="tool" data-tool="eyedropper">Pick<kbd>I</kbd></button>
        <button id="undo">Undo<kbd>⌘Z</kbd></button>
        <button id="redo">Redo<kbd>⇧⌘Z</kbd></button>
        <button id="moretoggle" class="toggle" aria-expanded="false" aria-controls="more">More ▾</button>
      </div>

      <!-- Everything a first facade never needs, one press away. Open to start
           with on a wide screen, where there is room for all of it. -->
      <div class="more" id="more" hidden>
        <div class="row" id="shaperow">
          <button class="tool" data-tool="line">Line<kbd>L</kbd></button>
          <button class="tool" data-tool="rect">Rect<kbd>R</kbd></button>
          <button id="rectfilled" class="toggle">Filled</button>
          <button id="mirror" class="toggle">Mirror<kbd>M</kbd></button>
        </div>
        <div class="row" id="sizerow">
          <span class="quiet">Brush</span>
          <button class="size" data-size="1">1<kbd>1</kbd></button>
          <button class="size" data-size="2">2<kbd>2</kbd></button>
          <button class="size" data-size="3">3<kbd>3</kbd></button>
          <button id="grid" class="toggle">Grid<kbd>G</kbd></button>
          <button id="reference" class="toggle">Reference<kbd>V</kbd></button>
        </div>
        <div class="row rows">
          <span class="quiet" id="rowslabel"></span>
          <button id="fewerrows">Fewer rows above</button>
          <button id="morerows">More rows above</button>
        </div>
        <p class="quiet" id="rowsnote"></p>
        <div class="row marker" id="doorrow">
          <span class="marker-key" style="background:${DOOR_MARK}" aria-hidden="true"></span>
          <span class="marker-name" id="doorname">Door</span>
          <button id="doorleft" aria-label="Move the door one column left"
            aria-describedby="doorwhere">◀</button>
          <span class="marker-where" id="doorwhere"></span>
          <button id="doorright" aria-label="Move the door one column right"
            aria-describedby="doorwhere">▶</button>
          <button id="doorreset" aria-label="Put the door back where the town has it">Reset</button>
        </div>
        <div class="row marker" id="plaquerow">
          <span class="marker-key" style="background:${PLAQUE_MARK}" aria-hidden="true"></span>
          <span class="marker-name" id="plaquename">Plaque</span>
          <button id="plaqueleft" aria-label="Move the plaque one column left"
            aria-describedby="plaquewhere">◀</button>
          <span class="marker-where" id="plaquewhere"></span>
          <button id="plaqueright" aria-label="Move the plaque one column right"
            aria-describedby="plaquewhere">▶</button>
          <button id="plaquereset" aria-label="Put the plaque back where the town has it">Reset</button>
        </div>
        <p class="quiet" id="markernote">The game knocks here and hangs your plaque
          here — drag the chips under the drawing if they are wrong.</p>
        <p class="quiet" id="gesturenote">${esc(GESTURES)}</p>
        <p class="quiet" id="guidenote" hidden>Guide only. It isn't part of your drawing.</p>
      </div>

      <!-- The colour in hand, then the last few, then all of them. -->
      <div class="row palettebar">
        <span class="swatch current" id="currentcolour" aria-hidden="true"></span>
        <div class="recents" id="recents"></div>
        <button id="allcolours" aria-expanded="false" aria-controls="palette">All ${usable} colours</button>
      </div>
      <div id="palette" hidden>${families}</div>
    </section>

    <section class="preview">
      <canvas id="previewcanvas" role="img" aria-label="What you'll send"></canvas>
      <p class="quiet">What you'll send: just what you drew.</p>
      <p class="quiet" id="sendcolumns" hidden></p>
    </section>

    <section class="send">
      <label class="field">
        <span>Name for the credit</span>
        <input id="credit" type="text" autocomplete="name" placeholder="However you'd like to be thanked" />
      </label>
      ${notesField}
      <p class="quiet">${esc(GUIDANCE)}</p>
      <label class="consent">
        <input id="consent" type="checkbox" />
        <span>${esc(CONSENT)}</span>
      </label>
      <p class="quiet" id="submitnote" hidden></p>
      ${sendStep}
    </section>

    <!--
      Tom's note: this used to be buried three "elsewhere" disclosures down.
      One line, right above the Files row, with the two things anybody
      reaching for a real app actually wants: a way in for the PNG they'll
      bring back, and where to read about which app.
    -->
    <section class="appcard" id="appcard">
      <p class="quiet">Rather draw in an app? Any pixel-art app works with
        ${
          world.paletteName
            ? world.paletteLink
              ? `the <a class="link" href="${esc(world.paletteLink)}" rel="noreferrer">${esc(world.paletteName)}</a> palette.`
              : `the ${esc(world.paletteName)} palette.`
            : 'our palette.'
        } Then bring the PNG here.</p>
      <div class="row">
        <button id="appimport">Import a PNG</button>
        <a class="link" id="whichapps" href="${esc(contributingUrl('apps'))}">Which apps?</a>
      </div>
    </section>

    <section class="files">
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
        ${
          entry.painted
            ? '<button id="improveit" title="Brings in the painting as it stands in the game today, to carry on from">Improve it?</button>'
            : ''
        }
        <button id="fromguide" title="Turns the faint guide into real pixels you can edit and send">Start from the guide</button>
        <button id="clear" title="Clears the canvas — undo brings it all back">Start again</button>
      </div>
      <p class="quiet">Painted somewhere else, or carrying on from a code you
        kept? Import the PNG, or paste the code back in. Your drawing is saved
        on this device as you go, either way.</p>

      <div class="paste" id="pastepanel" hidden>
        <label class="field" for="codebox">
          <span>Paste the code — line breaks and all, they don't matter</span>
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
        <summary>What we need</summary>
        <div class="elsewhere-body">
          <p class="quiet" id="elsewheresize"></p>
          <p class="quiet">A PNG with a transparent background and no smoothing —
            pixel art likes hard, clean edges.</p>
          <p class="quiet">Only the palette colours, which you are very welcome to take away:</p>
          <p class="quiet">The .hex file is one colour per line, which
            Aseprite, Piskel and Lospec all read straight in.${paletteNamed}</p>
          <div class="row">
            <a class="button" id="downloadpalette" href="#" download>Download the palette PNG</a>
            <button id="downloadhex">Download the palette as .hex</button>
          </div>
        </div>
      </details>
    </section>

    <footer class="how">
      ${howItWorks}
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

  const strip = el<HTMLCanvasElement>('markers');

  const pix = document.createElement('canvas');
  let reference = buildReference();
  let saveTimer = 0;

  /** The faint guide, redrawn whenever the canvas or a marker moves. */
  function buildReference(): HTMLCanvasElement {
    return referenceCanvas(
      state.entry.placement,
      state.entry.def,
      state.width,
      state.height,
      state.doorCol,
      state.plaqueCol,
      state.hasInterior
    );
  }

  function say(message: string): void {
    status.textContent = message || ' ';
  }

  function saySend(message: string): void {
    sendStatus.textContent = message || ' ';
  }

  /** Reveals "Back to the game" and the note beside it — once, the first time
   *  anything actually goes out, whichever of the ways it went. */
  function showAfterSend(): void {
    const row = document.getElementById('backtogamerow');
    const note = document.getElementById('aftersendnote');
    if (row) row.hidden = false;
    if (note) note.hidden = false;
  }

  /** Where style.css puts the tools beside the drawing instead of under it. */
  function wideScreen(): boolean {
    return window.matchMedia('(min-width: 900px)').matches;
  }

  /**
   * The tool in hand, said out loud. The eyedropper has always told the status
   * line what it did; now all six do, so choosing one on a phone never means
   * scrolling back to see which button went orange.
   */
  function pickTool(tool: Tool): void {
    state.tool = tool;
    refreshChrome();
    say(TOOL_SAID[tool]);
  }

  /**
   * A colour, chosen. The palette bar keeps the last few beside the one in
   * hand, so the commonest thing anybody does on a phone — change colour —
   * costs a tap rather than a hunt through all of them.
   */
  function useColour(index: number): void {
    state.colour = index;
    state.recent = [index, ...state.recent.filter((colour) => colour !== index)].slice(0, RECENT_SHOWN + 1);
    if (state.tool === 'eraser' || state.tool === 'eyedropper') state.tool = 'pencil';
    // On a phone the full grid has done its job the moment a colour is picked;
    // on a wide screen it is a column of its own and stays open.
    if (!wideScreen()) showColours(false);
    refreshChrome();
    saveDraft(state);
  }

  /** The colour in hand, and the ones lately in hand, under the tools. */
  function renderPaletteBar(): void {
    el<HTMLElement>('currentcolour').style.background = state.palette[state.colour] ?? 'transparent';
    const recents = state.recent.filter((colour) => colour !== state.colour).slice(0, RECENT_SHOWN);
    el<HTMLElement>('recents').innerHTML = recents
      .map((index) => {
        const colour = state.palette[index];
        return colour
          ? `<button class="swatch" data-colour="${index}" style="background:${esc(colour)}"
               title="Colour ${index}" aria-label="Colour ${index}, ${esc(colour)}"></button>`
          : '';
      })
      .join('');
  }

  const moreToggle = el<HTMLButtonElement>('moretoggle');
  const morePanel = el<HTMLDivElement>('more');

  function showMore(open: boolean): void {
    morePanel.hidden = !open;
    moreToggle.textContent = open ? 'More \u25b4' : 'More \u25be';
    moreToggle.classList.toggle('on', open);
    moreToggle.setAttribute('aria-expanded', String(open));
  }

  const coloursToggle = el<HTMLButtonElement>('allcolours');
  const colourGrid = el<HTMLDivElement>('palette');

  function showColours(open: boolean): void {
    colourGrid.hidden = !open;
    coloursToggle.classList.toggle('on', open);
    coloursToggle.setAttribute('aria-expanded', String(open));
  }

  moreToggle.addEventListener('click', () => showMore(morePanel.hidden));
  coloursToggle.addEventListener('click', () => showColours(colourGrid.hidden));

  // A wide screen has room for all of it at once, which is the layout the
  // critique liked; a phone opens with the short version of both.
  showMore(wideScreen());
  showColours(wideScreen());

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

    drawMarkers(ctx, h);
    renderStrip();
    renderPreview();
  }

  /**
   * The door and the plaque, outlined on the bottom row of the canvas — the
   * outline alone, since the chips on the strip below already say which is
   * which and saying it twice, six pixels apart, only crowded the drawing.
   * They are drawn here, on the view, and nowhere else: `pix` — which the preview, the
   * exported PNG and the code all read from — never sees them, so a marker
   * cannot end up in somebody's drawing.
   */
  function drawMarkers(ctx: CanvasRenderingContext2D, h: number): void {
    const tile = TILE * state.zoom;
    const inset = Math.min(2.5, Math.max(1.5, state.zoom / 2));
    for (const mark of markerList()) {
      const x = mark.col * tile;
      const y = h - tile;
      const box: [number, number, number, number] = [x + inset, y + inset, tile - inset * 2, tile - inset * 2];
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(18,22,15,.7)';
      ctx.strokeRect(...box);
      ctx.lineWidth = 1;
      ctx.strokeStyle = mark.colour;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(...box);
      ctx.setLineDash([]);
    }
  }

  /**
   * The strip of markers just under the canvas: one chip per marker, sitting
   * over its column, and the thing a finger actually drags. Keeping it off the
   * drawing surface means dragging a marker can never be mistaken for a brush
   * stroke, and a brush stroke along the bottom row can never nudge a marker.
   */
  function renderStrip(): void {
    const w = state.width * state.zoom;
    const height = stripHeight();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    strip.width = Math.round(w * dpr);
    strip.height = Math.round(height * dpr);
    strip.style.width = `${w}px`;
    strip.style.height = `${height}px`;
    const ctx = strip.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);

    // A chip is at least 44 across on a phone, and the stem above it is part of
    // the same target, so a fingertip has somewhere comfortable to land.
    const stem = 6;
    const least = onAPhone() ? MARKER_STRIP_TOUCH : 34;
    const tile = TILE * state.zoom;
    ctx.font = 'bold 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const mark of markerList()) {
      const centre = mark.col * tile + tile / 2;
      const chip = Math.min(w, Math.max(least, ctx.measureText(mark.label).width + 14));
      const left = Math.max(0, Math.min(w - chip, centre - chip / 2));
      ctx.fillStyle = mark.colour;
      ctx.fillRect(centre - 1, 0, 2, stem);
      ctx.fillRect(left, stem - 1, chip, height - stem + 1);
      ctx.fillStyle = '#12160f';
      ctx.fillText(mark.label, left + chip / 2, stem + (height - stem) / 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** The markers there are to draw, in the order they are drawn. */
  function markerList(): { which: Marker; col: number; colour: string; label: string }[] {
    const list = [{ which: 'door' as Marker, col: state.doorCol, colour: DOOR_MARK, label: 'Door' }];
    if (state.plaqueCol !== null) {
      list.push({ which: 'plaque' as Marker, col: state.plaqueCol, colour: PLAQUE_MARK, label: 'Plaque' });
    }
    return list;
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
    // One line above the canvas: where the building is and how big the canvas
    // is. Everything else about the shape belongs beside the control for it.
    el<HTMLElement>('shape').textContent =
      `${state.entry.mapName} · ${state.width} × ${state.height} px · ${plural(tw, 'tile', 'tiles')} wide`;

    el<HTMLElement>('rowslabel').textContent = `${plural(rows, 'row', 'rows')} above the footprint`;
    el<HTMLElement>('rowsnote').textContent =
      rows === 0
        ? 'The drawing stops at the roofline just now. Add a row for a roof, an awning or a sign.'
        : `${plural(rows, 'spare row', 'spare rows')} of 16 pixels above the footprint, ` +
          'which is where a roof, an awning or a sign goes.';

    const footH = th * TILE;
    const heights: number[] = [];
    for (let h = footH; h <= footH + MAX_EXTRA_ROWS * TILE; h += TILE) heights.push(h);
    el<HTMLElement>('elsewheresize').textContent =
      `Exactly ${state.width} pixels wide, and ${heights.slice(0, -1).join(', ')} or ` +
      `${heights[heights.length - 1]} pixels tall — import any of those heights and the canvas follows it.`;
  }

  function refreshChrome(): void {
    renderPaletteBar();
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
    const lock = el<HTMLButtonElement>('lock');
    lock.classList.toggle('on', state.locked);
    lock.setAttribute('aria-pressed', String(state.locked));
    // Locked, one-finger gestures go back to the browser, which scrolls the
    // stage and then the page with them; unlocked, they are the studio's own.
    view.style.touchAction = state.locked ? 'pan-y' : 'none';
    el<HTMLElement>('zoomlevel').textContent = `×${state.zoom}`;
    el<HTMLButtonElement>('undo').disabled = state.undo.length === 0;
    el<HTMLButtonElement>('redo').disabled = state.redo.length === 0;
    el<HTMLButtonElement>('fewerrows').disabled = state.extraRows <= 0;
    el<HTMLButtonElement>('morerows').disabled = state.extraRows >= MAX_EXTRA_ROWS;
    refreshMarkers();
    describeShape();
  }

  /** The two marker rows, and the quiet line about what goes in the email. */
  function refreshMarkers(): void {
    const columns = state.entry.placement.size[0];
    const row = (which: Marker, col: number | null) => {
      const wrap = el<HTMLDivElement>(`${which}row`);
      wrap.hidden = col === null;
      if (col === null) return;
      el<HTMLElement>(`${which}where`).textContent = `${ordinal(col + 1)} of ${columns}`;
      el<HTMLButtonElement>(`${which}left`).disabled = col <= 0;
      el<HTMLButtonElement>(`${which}right`).disabled = col >= columns - 1;
      const home = which === 'door' ? state.defaultDoorCol : state.defaultPlaqueCol;
      el<HTMLButtonElement>(`${which}reset`).disabled = col === home;
    };
    row('door', state.doorCol);
    row('plaque', state.plaqueCol);

    const note = el<HTMLElement>('sendcolumns');
    const moved = placedColumns(state);
    if (moved.door === undefined) {
      note.hidden = true;
      return;
    }
    const where =
      moved.plaque === undefined
        ? `the door in the ${whereIs(moved.door)}`
        : `the door in the ${whereIs(moved.door)} and the plaque in the ${whereIs(moved.plaque)}`;
    note.textContent = `The code carries where you put them too: ${where}.`;
    note.hidden = false;
  }

  /**
   * Moves one marker to a column, and lets the other one step into the space it
   * has left if that is where it was standing — so the two always have a column
   * each, whichever way anyone drags or steps them.
   */
  function moveMarker(which: Marker, to: number): boolean {
    const columns = state.entry.placement.size[0];
    const from = which === 'door' ? state.doorCol : state.plaqueCol;
    if (from === null) return false;
    const col = Math.max(0, Math.min(columns - 1, to));
    if (col === from) return false;

    const other = which === 'door' ? state.plaqueCol : state.doorCol;
    if (other === col) {
      if (which === 'door') state.plaqueCol = from;
      else state.doorCol = from;
    }
    if (which === 'door') state.doorCol = col;
    else state.plaqueCol = col;

    reference = buildReference();
    changed();
    return true;
  }

  function sayMarkers(): void {
    const parts = markerList().map((mark) => `the ${mark.label.toLowerCase()} in the ${whereIs(mark.col)}`);
    say(`That puts ${parts.join(', and ')}.`);
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

  /**
   * Every finger and every mouse on the canvas, by pointerId — one path,
   * pointer events only, no touch handlers anywhere (hard rule 4). One pointer
   * draws. A second turns the whole gesture into a pinch: zoom about the point
   * between the fingers, and pan with it, until every pointer has lifted.
   */
  const pointers = new Map<number, { x: number; y: number }>();
  let strokeSnapshot: Uint8Array | null = null;
  let last: { x: number; y: number } | null = null;
  let shapeStart: { x: number; y: number } | null = null;
  /** The one pointer that is drawing, while one is. */
  let drawingWith: number | null = null;
  /** A pinch under way: the drawing point the fingers came down on, how far
   *  apart they were, and the zoom they started from. */
  let pinch: { anchor: { x: number; y: number }; spread: number; zoom: number } | null = null;
  /** The last point between the fingers, so the snap on release lands there. */
  let pinchMid = { x: 0, y: 0 };

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

  /** How far apart the two fingers are, in screen pixels; never zero. */
  function spread(): number {
    const points = Array.from(pointers.values());
    if (points.length < 2) return 1;
    return Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
  }

  /** Screen pixels per drawing pixel as the canvas stands right now — a whole
   *  number, except part-way through a pinch. */
  function shownZoom(): number {
    const rect = view.getBoundingClientRect();
    return rect.width > 0 ? rect.width / state.width : state.zoom;
  }

  /** Where a point on the screen lands in the drawing, in fractional pixels. */
  function drawingPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = view.getBoundingClientRect();
    const zoom = shownZoom();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }

  /**
   * Scrolls the stage until a point in the drawing sits under a point on the
   * screen. It is how a pinch keeps whatever is between the fingers between
   * them, and how the zoom buttons keep the middle of the view still. When the
   * drawing is smaller than the stage there is nothing to scroll and it simply
   * stays centred, which is where it wants to be then anyway.
   */
  function anchorAt(point: { x: number; y: number }, clientX: number, clientY: number): void {
    const rect = view.getBoundingClientRect();
    const zoom = shownZoom();
    stage.scrollLeft += rect.left + point.x * zoom - clientX;
    stage.scrollTop += rect.top + point.y * zoom - clientY;
  }

  /**
   * The canvas at a part-way zoom, without redrawing a pixel: the bitmap stays
   * exactly as it is and the browser scales it, which is what keeps a pinch
   * smooth on a phone. The marker strip is stretched by the same amount so its
   * chips stay over their columns. render() puts both back on a whole number.
   */
  function showAtZoom(zoom: number): void {
    view.style.width = `${state.width * zoom}px`;
    view.style.height = `${state.height * zoom}px`;
    strip.style.width = `${state.width * zoom}px`;
  }

  /**
   * Holding on to a pointer so its moves keep coming even if it wanders off the
   * canvas. A pointer that has already been let go of cannot be captured, and
   * that is not worth an exception: the handlers below cope either way.
   */
  function capture(pointerId: number): void {
    try {
      view.setPointerCapture(pointerId);
    } catch {
      // Nothing to hold on to; carry on.
    }
  }

  function beginPinch(): void {
    pinchMid = centroid();
    pinch = { anchor: drawingPoint(pinchMid.x, pinchMid.y), spread: spread(), zoom: shownZoom() };
  }

  function movePinch(): void {
    if (!pinch) return;
    pinchMid = centroid();
    const zoom = Math.min(MAX_ZOOM, Math.max(1, (pinch.zoom * spread()) / pinch.spread));
    showAtZoom(zoom);
    anchorAt(pinch.anchor, pinchMid.x, pinchMid.y);
    // The readout keeps up with the fingers, and refreshChrome() puts the
    // settled number back the moment they lift.
    el<HTMLElement>('zoomlevel').textContent = `×${Math.round(zoom)}`;
  }

  /** A finger has lifted: settle on the nearest whole zoom, still looking at
   *  whatever the pinch was looking at. */
  function endPinch(): void {
    if (!pinch) return;
    const { anchor } = pinch;
    pinch = null;
    state.zoom = Math.min(MAX_ZOOM, Math.max(1, Math.round(shownZoom())));
    render();
    refreshChrome();
    anchorAt(anchor, pinchMid.x, pinchMid.y);
  }

  /**
   * Every zoom that isn't a pinch comes through here — the buttons, the
   * keyboard and a ctrl-wheel — so they all agree with each other and all keep
   * a point of the drawing under the same spot on the screen.
   */
  function setZoom(next: number, at?: { x: number; y: number }): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, Math.round(next)));
    if (zoom === state.zoom) return;
    const box = stage.getBoundingClientRect();
    const spot = at ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const anchor = drawingPoint(spot.x, spot.y);
    state.zoom = zoom;
    changed();
    anchorAt(anchor, spot.x, spot.y);
  }

  view.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      // A second finger means "move the canvas", never "paint". Whatever the
      // first finger had started goes back the way it was, and nothing paints
      // again until every pointer has lifted.
      abortStroke();
      drawingWith = null;
      capture(event.pointerId);
      beginPinch();
      return;
    }

    // Locked, the canvas is something to scroll past rather than draw on: the
    // gesture stays the browser's, and preventDefault() is never called, so the
    // page scrolls. The pointer is still held on to, and still counted, so that
    // a second finger arriving is a pinch and a first finger leaving is heard
    // wherever it happens to be by then.
    capture(event.pointerId);
    if (state.locked) return;

    event.preventDefault();
    drawingWith = event.pointerId;
    const cell = cellAt(event);
    if (!cell) return;

    if (state.tool === 'eyedropper') {
      const value = state.pixels[cell.y * state.width + cell.x];
      if (value === TRANSPARENT) {
        state.tool = 'eraser';
        say('That spot is empty, so the eraser is ready instead.');
      } else {
        useColour(value);
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
      movePinch();
      return;
    }
    if (drawingWith !== event.pointerId) return;
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
    if (view.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId);
    if (pinch && pointers.size < 2) endPinch();
    if (pointers.size > 0) return;
    drawingWith = null;
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

  // A wheel with ctrl or ⌘ held is what a trackpad pinch sends, and what every
  // other pixel editor takes as zoom. A plain wheel belongs to the page, and
  // is left well alone so the rest of the studio scrolls as it always did.
  view.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(state.zoom + (event.deltaY < 0 ? 1 : -1), { x: event.clientX, y: event.clientY });
    },
    { passive: false }
  );

  // --- canvas size, zoom, toggles ---------------------------------------

  /**
   * The zoom a drawing opens at, and goes back to whenever its size changes:
   * the biggest whole number of screen pixels per drawing pixel that still
   * shows the whole drawing inside the stage. On a phone the width is what
   * decides it — an 80-pixel facade opens filling the screen across — and the
   * height only comes into it on a stage too short to hold the result. Never
   * less than 1, so there is always something to see and pinch into.
   */
  function fitZoom(): number {
    const wide = Math.max(1, Math.floor((stage.clientWidth - 8) / state.width));
    // The strip of markers shares the stage with the canvas, so it gets its
    // height out of the way first (plus the 4px gap between the two).
    const tall = Math.max(1, Math.floor((stage.clientHeight - 12 - stripHeight()) / state.height));
    return Math.min(MAX_ZOOM, Math.max(1, Math.min(wide, tall)));
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
    reference = buildReference();
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

  // --- the door and the plaque ------------------------------------------

  /**
   * The strip listens to pointer events and nothing else, exactly as the canvas
   * does (hard rule 4): one finger, one marker, no touch handlers anywhere. A
   * tap on a column takes the nearer marker straight there, which on a phone is
   * often quicker than dragging it.
   */
  let dragging: Marker | null = null;
  /** Where both markers stood when the drag began, so the other one can step
   *  aside while it is stood on and go back the moment it isn't. */
  let dragFrom: { moving: number; other: number | null } | null = null;

  function columnAt(clientX: number): number {
    const rect = strip.getBoundingClientRect();
    const columns = state.entry.placement.size[0];
    const col = Math.floor(((clientX - rect.left) / rect.width) * columns);
    return Math.max(0, Math.min(columns - 1, col));
  }

  /** Whichever marker is already on that column, or else the nearer one. */
  function markerNear(col: number): Marker {
    const marks = markerList();
    const on = marks.find((mark) => mark.col === col);
    if (on) return on.which;
    let best = marks[0];
    for (const mark of marks) {
      if (Math.abs(mark.col - col) < Math.abs(best.col - col)) best = mark;
    }
    return best.which;
  }

  /**
   * A marker under a finger. The other marker only steps aside while the one
   * being dragged is actually standing on it, and is back where it was as soon
   * as the drag moves on — so passing over the plaque on the way somewhere else
   * leaves it exactly where its owner put it.
   */
  function dragTo(which: Marker, col: number): void {
    if (!dragFrom) return;
    const columns = state.entry.placement.size[0];
    const target = Math.max(0, Math.min(columns - 1, col));
    const other = dragFrom.other === null ? null : target === dragFrom.other ? dragFrom.moving : dragFrom.other;

    if (which === 'door') {
      state.doorCol = target;
      if (other !== null) state.plaqueCol = other;
    } else {
      state.plaqueCol = target;
      if (other !== null) state.doorCol = other;
    }
    reference = buildReference();
    changed();
  }

  strip.addEventListener('pointerdown', (event) => {
    if (dragging) return;
    event.preventDefault();
    strip.setPointerCapture(event.pointerId);
    const col = columnAt(event.clientX);
    dragging = markerNear(col);
    dragFrom =
      dragging === 'door'
        ? { moving: state.doorCol, other: state.plaqueCol }
        : { moving: state.plaqueCol ?? 0, other: state.doorCol };
    dragTo(dragging, col);
  });

  strip.addEventListener('pointermove', (event) => {
    if (!dragging || !strip.hasPointerCapture(event.pointerId)) return;
    dragTo(dragging, columnAt(event.clientX));
  });

  function dropMarker(event: PointerEvent): void {
    if (!dragging) return;
    if (strip.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId);
    dragging = null;
    dragFrom = null;
    sayMarkers();
  }

  strip.addEventListener('pointerup', dropMarker);
  strip.addEventListener('pointercancel', dropMarker);

  // The same two markers by button, for a keyboard, a screen reader, or anyone
  // who would rather tap than drag. A <button> on `click` is one path as well.
  for (const which of ['door', 'plaque'] as Marker[]) {
    const at = () => (which === 'door' ? state.doorCol : state.plaqueCol) ?? 0;
    el<HTMLButtonElement>(`${which}left`).addEventListener('click', () => {
      if (moveMarker(which, at() - 1)) sayMarkers();
    });
    el<HTMLButtonElement>(`${which}right`).addEventListener('click', () => {
      if (moveMarker(which, at() + 1)) sayMarkers();
    });
    el<HTMLButtonElement>(`${which}reset`).addEventListener('click', () => {
      const home = which === 'door' ? state.defaultDoorCol : state.defaultPlaqueCol;
      if (home === null) return;
      moveMarker(which, home);
      say(`Back where the town has it. ${markerList().map((m) => `The ${m.label.toLowerCase()} is in the ${whereIs(m.col)}.`).join(' ')}`);
    });
  }

  /**
   * One click handler for every control beside the drawing — a tool, a brush
   * size or a colour — since they all live in the same section now. A
   * <button> on `click` is one path for a finger, a mouse and a keyboard
   * alike (hard rule 4).
   */
  el<HTMLElement>('tools').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const tool = target.closest<HTMLButtonElement>('.tool');
    if (tool?.dataset.tool) {
      pickTool(tool.dataset.tool as Tool);
      return;
    }
    const size = target.closest<HTMLButtonElement>('.size');
    if (size?.dataset.size) {
      state.brushSize = Number(size.dataset.size) as BrushSize;
      refreshChrome();
      return;
    }
    const swatch = target.closest<HTMLButtonElement>('.swatch');
    if (swatch?.dataset.colour) useColour(Number(swatch.dataset.colour));
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
    reference = buildReference();
    state.zoom = fitZoom();
  }

  el<HTMLButtonElement>('undo').addEventListener('click', undo);
  el<HTMLButtonElement>('redo').addEventListener('click', redo);
  el<HTMLButtonElement>('zoomin').addEventListener('click', () => setZoom(state.zoom + 1));
  el<HTMLButtonElement>('zoomout').addEventListener('click', () => setZoom(state.zoom - 1));
  /**
   * Lock: the canvas stops taking one finger as a brush and hands the gesture
   * back to the browser, so the page scrolls past a big drawing the way every
   * other page does. Two fingers still zoom and pan, and the tools, the
   * buttons and the keyboard are all untouched by it.
   */
  function setLocked(on: boolean): void {
    if (state.locked === on) return;
    state.locked = on;
    abortStroke();
    refreshChrome();
    say(on ? LOCK_ON : LOCK_OFF);
  }

  el<HTMLButtonElement>('lock').addEventListener('click', () => setLocked(!state.locked));

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
  // Only the email route has a "Download the PNG" of its own to wire up.
  document.getElementById('attachexport')?.addEventListener('click', download);

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
  // The appcard's "Import a PNG" is the same control, one tap higher up the
  // page — not a second importer to keep in step with the first.
  document.getElementById('appimport')?.addEventListener('click', () => importInput.click());

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
  async function openPicture(blob: Blob): Promise<Picture> {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none'
        });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch {
        // An older browser may not take a Blob here, or may not know those
        // options. An <img> reads the same picture; it is only colour-managed,
        // and snapping to the palette takes care of that.
      }
    }

    const url = URL.createObjectURL(blob);
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

  /**
   * The one place a decoded picture becomes palette-indexed pixels sized for
   * this building's canvas — used by both "Import a PNG" and "Improve it?",
   * so there is exactly one importer rather than two that could drift apart.
   * Throws (with a message worth reading) when the picture's size can't
   * become this canvas; never touches `state`.
   */
  function snapPicture(picture: Picture): ReturnType<typeof snapToPalette> {
    if (!picture.width || !picture.height) throw new Error(CANNOT_READ);
    const outcome = fitImport(picture.width, picture.height, {
      width: state.entry.placement.size[0] * TILE,
      height: state.entry.placement.size[1] * TILE,
      tile: TILE,
      maxExtraRows: MAX_EXTRA_ROWS
    });
    if (!outcome.ok) throw new Error(outcome.message);
    return snapToPalette(pixelsOf(picture), picture.width, outcome.fit, paletteRgbs);
  }

  async function importPicture(file: File): Promise<void> {
    const picture = await openPicture(file);
    let report;
    try {
      report = snapPicture(picture);
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

  /**
   * "Improve it?" — only offered when this building already has a shipped
   * facade (see main()'s HEAD probe). Fetches that PNG and loads it as real,
   * editable pixels through the same import machinery a hand-picked file
   * goes through, so a touch-up starts from the painting as it ships today
   * rather than from the placeholder guide. Any failure — the fetch, the
   * decode, or a picture that somehow doesn't fit this canvas — leaves the
   * drawing exactly as it was and says so kindly; it never falls back to
   * partial pixels.
   */
  async function improvePicture(): Promise<void> {
    const url = packUrl(state.world.id, `assets/buildings/${state.entry.placement.id}.png`);
    let report;
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error('missing');
      const picture = await openPicture(await response.blob());
      try {
        report = snapPicture(picture);
      } finally {
        picture.release();
      }
    } catch {
      say(IMPROVE_FAILURE);
      return;
    }

    pushUndo();
    state.pixels = report.pixels;
    fixHeight();
    changed();
    say(IMPROVE_SUCCESS);
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

  // Only rendered at all when this building already has a shipped facade
  // (renderEditor, from main()'s HEAD probe), so a missing element here just
  // means an unpainted building and there is nothing to wire up.
  const improveButton = document.getElementById('improveit') as HTMLButtonElement | null;
  improveButton?.addEventListener('click', () => {
    say('Fetching the painting as it is in the game…');
    void improvePicture();
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
    // A code that says where the door and the plaque went brings the markers
    // back with it; one that says nothing leaves them where they are.
    const carriedColumns = adoptColumns(state, drawing);
    reference = buildReference();
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
    if (carriedColumns) {
      notes.push(
        `It says where the door goes — the ${whereIs(state.doorCol)} — so the markers moved to match.`
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
    return encode(drawingOf(state));
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
      note.textContent = 'Just a reminder: only what you drew is sent; the faint building is a guide.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  /** Puts a string on the clipboard, by whichever of the two ways works. */
  async function putOnClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard permission, an old browser, or an insecure origin. Fall back
      // to the oldest trick there is.
    }
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', 'readonly');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    box.remove();
    return copied;
  }

  // "Copy the code" sits beside Send on a world that sends by email, and inside
  // the "Didn't go through?" note on a world with a form. `data-status` says
  // which status line it should speak into, so one handler serves both.
  const copyButton = el<HTMLButtonElement>('copy');
  copyButton.addEventListener('click', () => {
    maybeReminder();
    void (async () => {
      const copied = await putOnClipboard(currentCode());
      const message = copied
        ? 'Copied. Paste it anywhere you like — a text, an email, a note to yourself.'
        : 'This browser keeps the clipboard to itself. Downloading the PNG and attaching it works just as well.';
      const line = document.getElementById(copyButton.dataset.status ?? 'sendstatus');
      if (line) line.textContent = message;
    })();
  });

  function subjectLine(): string {
    return `mainstreet art: ${state.entry.placement.id} (${state.world.id})`;
  }

  function mailtoFor(body: string): string {
    return `mailto:${SUBMIT_ADDRESS}?subject=${encodeURIComponent(subjectLine())}&body=${encodeURIComponent(body)}`;
  }

  function gmailFor(body: string): string {
    return (
      `${GMAIL_COMPOSE}&to=${encodeURIComponent(SUBMIT_ADDRESS)}` +
      `&su=${encodeURIComponent(subjectLine())}&body=${encodeURIComponent(body)}`
    );
  }

  function outlookFor(body: string): string {
    return (
      `${OUTLOOK_COMPOSE}?to=${encodeURIComponent(SUBMIT_ADDRESS)}` +
      `&subject=${encodeURIComponent(subjectLine())}&body=${encodeURIComponent(body)}`
    );
  }

  function bodyLines(name: string): string[] {
    const lines = [
      `Name for the credit: ${name}`,
      '',
      CONSENT,
      '',
      `Building: ${state.entry.def.name} (${state.entry.placement.id}) in ${state.world.title}`,
      `Canvas: ${state.width} by ${state.height} pixels`
    ];
    // Only when they have been moved, and in the same words the code uses, so
    // whoever opens the email can read it either way round — this is the one
    // line that matters when the drawing comes as an attached PNG instead.
    const moved = placedColumns(state);
    if (moved.door !== undefined) {
      const pairs = [`door=${moved.door}`];
      if (moved.plaque !== undefined) pairs.push(`plaque=${moved.plaque}`);
      lines.push(
        `Door and plaque: ${pairs.join(', ')} — that is the ${whereIs(moved.door)}` +
          (moved.plaque === undefined ? '' : ` and the ${whereIs(moved.plaque)}`) +
          ' (columns across the front, counting from 0 at the left edge).'
      );
    }
    lines.push('');
    return lines;
  }

  /** The message the two copy buttons put on the clipboard, once Send has
   *  been pressed and there is a credit name to write into it. */
  let copyable = '';

  function sayFallback(message: string): void {
    el<HTMLParagraphElement>('fallbackstatus').textContent = message || ' ';
  }

  /**
   * The message a link will carry: with the drawing's code written into it
   * when a URL that long is still reliable, and asking for the PNG as an
   * attachment when it is not. `budget` is what that particular kind of link
   * can take — a mailto very little, a webmail compose URL a great deal more
   * — so the same drawing can travel whole by one route and as a PNG by
   * another, rather than every route being held to the shortest one.
   */
  function messageFor(name: string, code: string, budget: number): { body: string; whole: boolean } {
    const whole = [...bodyLines(name), 'Here is the drawing, as a code:', '', code, ''].join('\n');
    if (encodeURIComponent(whole).length <= budget) return { body: whole, whole: true };
    return { body: [...bodyLines(name), 'My PNG is attached to this email.', ''].join('\n'), whole: false };
  }

  /**
   * The form's own page to open, prefilled — `art.page` when the pack gives
   * one, or else `art.form` (a Google Form's `formResponse` address) with the
   * trailing `/formResponse` swapped for `/viewform`, its own page for the
   * same set of fields.
   */
  function viewformUrl(form: SubmitArt): string {
    return form.page ?? form.form.replace(/\/formResponse\/?$/, '/viewform');
  }

  /**
   * Above this many characters, a URL stops being something every browser and
   * OS will open reliably from a plain click — comfortably under the roughly
   * 8,000-character ceiling a few of them impose, and past everything but a
   * fully painted, finished-size facade's code.
   */
  const PREFILL_URL_BUDGET = 7000;

  /**
   * The prefilled link Send opens: Google's own "prefilled link" convention
   * — `usp=pp_url` plus one query parameter per field id, so the painter
   * lands on the form itself with everything the Studio knows already
   * written in. `code` is `null` for the one case where it is left out on
   * purpose (see `openForm`).
   */
  function prefillUrl(form: SubmitArt, name: string, notes: string, code: string | null): string {
    const params = new URLSearchParams();
    params.set('usp', 'pp_url');
    if (form.fields.building) params.set(form.fields.building, state.entry.placement.id);
    if (form.fields.world) params.set(form.fields.world, state.world.id);
    params.set(form.fields.credit, name);
    if (code !== null) params.set(form.fields.code, code);
    if (form.fields.notes && notes) params.set(form.fields.notes, notes);
    return `${viewformUrl(form)}?${params.toString()}`;
  }

  /** The code `openForm` last opened a form without — set only on the path
   *  where the code was left out of the link and offered to copy instead. */
  let formCode = '';

  /**
   * A world that carries a `submit.art` block sends the painter to that
   * form's own page instead of posting anything itself (hard rules 1 and 7:
   * the URL and every field id are the pack's, and none of them appears in
   * this file). The link is opened by clicking a real `<a target="_blank"
   * rel="noopener">` in the same gesture as the button press, so no pop-up
   * blocker gets in the way and there is still exactly one pointer path
   * (hard rule 4). Google's own page then takes it from there: its own
   * Submit button, its own confirmation, nothing the Studio has to guess at.
   *
   * A finished-size facade can make a URL too long to open reliably (see
   * `PREFILL_URL_BUDGET`) — everything else still opens prefilled, and the
   * code goes to the clipboard instead, to paste in by hand.
   */
  function openForm(form: SubmitArt, name: string, code: string): void {
    const notes = (document.getElementById('notes') as HTMLTextAreaElement | null)?.value.trim() ?? '';
    const anchor = document.getElementById('sendform') as HTMLAnchorElement | null;
    const insurance = el<HTMLDetailsElement>('insurance');
    const copyCode = document.getElementById('copycode') as HTMLButtonElement | null;
    if (!anchor) return;

    const whole = prefillUrl(form, name, notes, code);
    if (whole.length <= PREFILL_URL_BUDGET) {
      anchor.href = whole;
      anchor.click();
      if (copyCode) copyCode.hidden = true;
      insurance.hidden = false;
      showAfterSend();
      saySend("The form opened in a new tab with everything filled in. Press Submit there and you're done.");
      return;
    }

    anchor.href = prefillUrl(form, name, notes, null);
    anchor.click();
    insurance.hidden = false;
    showAfterSend();
    formCode = code;
    if (copyCode) copyCode.hidden = false;
    void (async () => {
      const copied = await putOnClipboard(code);
      saySend(
        copied
          ? 'The form opened in a new tab. Your code is copied; paste it into the box that says code, then press Submit.'
          : 'The form opened in a new tab, but this browser would not copy the code on its own. Press ' +
            '"Copy the code" below, then paste it into the box that says code, and press Submit.'
      );
    })();
  }

  el<HTMLButtonElement>('send').addEventListener('click', () => {
    maybeReminder();
    const name = el<HTMLInputElement>('credit').value.trim();
    const consented = el<HTMLInputElement>('consent').checked;

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

    const form = state.world.submit?.art;
    if (form) {
      openForm(form, name, code);
      return;
    }

    // No form in the pack: the older route. Every way of sending gets filled
    // in, every time, and the panel below always opens — a mailto: that goes
    // nowhere is indistinguishable from one that worked, so the studio offers
    // the other ways rather than assuming.
    const mail = messageFor(name, code, MAILTO_BUDGET);
    const web = messageFor(name, code, WEBMAIL_BUDGET);
    // The clipboard has no length to run out of, so the copied message always
    // carries the drawing, however detailed it is.
    copyable = [...bodyLines(name), 'Here is the drawing, as a code:', '', code, ''].join('\n');

    el<HTMLAnchorElement>('sendmail').href = mailtoFor(mail.body);
    el<HTMLAnchorElement>('gmail').href = gmailFor(web.body);
    el<HTMLAnchorElement>('outlook').href = outlookFor(web.body);
    el<HTMLElement>('webmailnote').textContent = web.whole
      ? 'Or open a new message in your webmail, with the address, the subject and the drawing already written in:'
      : `Or open a new message in your webmail — it will be addressed and written out, and the PNG goes on as an attachment:`;
    el<HTMLElement>('fallbacknote').textContent = mail.whole
      ? "If your email app opened, everything is in it already and you just press send. Plenty of desktop browsers " +
        'have no email app to open, though, so here is the same message every other way.'
      : 'This one is too detailed to fit in an email link, which is a lovely problem to have. Download the PNG ' +
        'below and attach it to a message — or copy the whole message, which carries the drawing whatever its size.';
    el<HTMLDivElement>('fallback').hidden = false;
    showAfterSend();
    sayFallback('');

    if (mail.whole) el<HTMLAnchorElement>('sendmail').click();
    saySend(
      mail.whole
        ? 'Your email app should be opening. Thank you — this really does make the town. If nothing opened, everything you need is just below.'
        : `Everything you need to send it is just below. Thank you — this really does make the town.`
    );
  });

  // The "Copy the code" button that appears right beside Send when a
  // finished-size drawing left its code out of the form link (see
  // `openForm`). `formCode` is the code that link went without.
  document.getElementById('copycode')?.addEventListener('click', () => {
    void (async () => {
      const copied = await putOnClipboard(formCode);
      saySend(
        copied
          ? 'Copied. Paste it into the box that says code, then press Submit.'
          : 'This browser keeps the clipboard to itself. Copy the code from "Didn\'t go through?" below instead.'
      );
    })();
  });

  document.getElementById('copymessage')?.addEventListener('click', () => {
    void (async () => {
      const copied = await putOnClipboard(copyable);
      sayFallback(
        copied
          ? `Copied — the whole message. Paste it into a new email to ${SUBMIT_ADDRESS} and send it.`
          : 'This browser keeps the clipboard to itself. Downloading the PNG and attaching it works just as well.'
      );
    })();
  });

  document.getElementById('fallbackcode')?.addEventListener('click', () => {
    void (async () => {
      const copied = await putOnClipboard(currentCode());
      sayFallback(
        copied
          ? 'Copied — just the drawing code. Do add the name you would like credited when you paste it in.'
          : 'This browser keeps the clipboard to itself. Downloading the PNG and attaching it works just as well.'
      );
    })();
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
        pickTool('pencil');
        return;
      case 'f':
        pickTool('fill');
        return;
      case 'e':
        pickTool('eraser');
        return;
      case 'i':
        pickTool('eyedropper');
        return;
      case 'l':
        pickTool('line');
        return;
      case 'r':
        pickTool('rect');
        return;
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
        setZoom(state.zoom + 1);
        return;
      case '[':
      case '-':
        setZoom(state.zoom - 1);
        return;
      case 'k':
        setLocked(!state.locked);
        return;
      default:
        return;
    }
    refreshChrome();
  });

  // A turn of the phone, or a window dragged wider: the drawing goes back to
  // fitting the room it now has.
  window.addEventListener('resize', () => {
    state.zoom = fitZoom();
    render();
    refreshChrome();
  });

  state.zoom = fitZoom();
  changed();

  // A painted building's plaque links here with `?improve=1` (engine/paint.ts
  // improveUrl, DESIGN.md §2): run the same load "Improve it?" does, right on
  // open, so the canvas starts from the shipped painting instead of a blank
  // one. An unpainted building has nothing to fetch, so the parameter is
  // simply ignored and the usual greeting stands.
  if (state.autoImprove && state.entry.painted) {
    say('Fetching the painting as it is in the game…');
    void improvePicture();
  } else {
    say(
      `Pencil ready, and ${plural(state.palette.filter((c) => c !== null).length, 'colour', 'colours')} ` +
        'to paint with. Take your time.'
    );
  }
}

// --- drafts ------------------------------------------------------------------

function saveDraft(state: EditorState): void {
  try {
    localStorage.setItem(
      draftKey(state.world.id, state.entry.placement.id),
      JSON.stringify({ saved: Date.now(), code: encode(drawingOf(state)), recent: state.recent })
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
    const saved = JSON.parse(raw) as { code?: string; recent?: number[] };
    // The colours this painter was last reaching for, so the palette bar picks
    // up where they left off. Anything odd in there is simply not restored.
    if (Array.isArray(saved.recent)) {
      state.recent = saved.recent
        .filter((index) => Number.isInteger(index) && index >= 0 && index < state.palette.length)
        .slice(0, RECENT_SHOWN + 1);
    }
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
    adoptColumns(state, drawing);
  } catch {
    // An unreadable draft is simply not restored; the blank canvas is fine.
  }
}

// --- boot --------------------------------------------------------------------

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const worldId = params.get('world');
  // `improve=1` or bare `improve` both count — the plaque's link only ever
  // sends `improve=1`, but presence is what matters, per improveUrl.
  const autoImprove = params.has('improve');

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

  // Kept in the pack's own map order, so the picker's villages come out in the
  // order the world lists them; the names inside a village are sorted, which is
  // how anyone looks for a shop they know.
  const entries: Entry[] = [];
  for (const [mapId, map] of Object.entries(world.maps ?? {})) {
    for (const placement of map.buildings ?? []) {
      const def = world.buildings?.[placement.id];
      if (!def) continue;
      entries.push({ placement, def, mapId, mapName: map.name, painted: false });
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

  // Same HEAD probe the building picker uses (`exists`, above), just for the
  // one building this page is about — going straight to a building's editor
  // by URL skips the picker entirely, so nothing else has checked yet.
  entry.painted = await exists(packUrl(worldId, `assets/buildings/${entry.placement.id}.png`));

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

  renderEditor(world, entry, palette, autoImprove);
}

void main().catch((error: unknown) => {
  kindly(
    'Something went sideways getting the studio ready, and that is on us.',
    error instanceof Error ? error.message : String(error)
  );
});
