import Phaser from 'phaser';
import { drawFigure, figureKey } from './figure';
import { FACINGS, plaqueTile } from './schema';
import { TILE } from './tiled';
import type { BuildingDef, BuildingPlacement, Facing, Fixture, FixtureKind, GameMap, Look, Vec2 } from './schema';
import type { TileDef, TilesetDef } from './tiled';

/**
 * Engine-built fallback art (DESIGN.md §2). None of this is per-world: it is
 * drawn from the colours and names in the world pack, so a world is playable
 * with zero PNGs and each painted asset simply replaces one of these.
 */

/** Re-exported so scenes take the grid and the art that sits on it together. */
export { TILE };
/** Head-room above a building footprint for its roof band and name sign. */
export const OVERHEAD = 20;
export const CHAR_W = 16;
export const CHAR_H = 32;

const MONO = 'ui-monospace, Menlo, Consolas, monospace';

function canvas(scene: Phaser.Scene, key: string, width: number, height: number) {
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) throw new Error(`could not create canvas texture "${key}"`);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;
  return { texture, ctx };
}

// --- tiles -------------------------------------------------------------------

/**
 * How far down a cell the styles that stand on a raised surface — `disc`,
 * `rim`, `umbrella` — draw, shadows included. Below it is where a tile's
 * `edge` paints the front face of whatever they are standing on, so a table
 * on the near row of a deck keeps the deck's lip in front of it.
 */
const PROP_FLOOR = 12;

/**
 * One tile of the fallback tileset, drawn from the recipe its Tiled entry
 * carries. `style` is a shape, not a meaning: the meaning is the tile's class.
 * Every shape stays inside its own 16x16 cell so a tile looks the same whether
 * it is drawn here or blitted out of the tileset image.
 *
 * The town is lit from the top left, which is why anything meant to stand
 * above the ground plane gets the same three cues: a lighter top face, a
 * darker face towards the viewer, and a short cast shadow down and to the
 * right. Shading is painted as translucent black or white over the tile's own
 * colours, so one recipe works for every palette a world hands it.
 */
function drawTile(ctx: CanvasRenderingContext2D, def: TileDef, px: number, py: number): void {
  const c = def.colors;

  if (def.base) {
    ctx.fillStyle = def.base;
    ctx.fillRect(px, py, TILE, TILE);
  }

  switch (def.style) {
    case 'flat':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      break;

    case 'speck':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 4, py + 6, 3, 2);
      break;

    case 'ripple':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 5, 6, 1);
      break;

    case 'tree':
      ctx.fillStyle = c[2] ?? c[0];
      ctx.fillRect(px + 6, py + 9, 4, 6);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 2, py, 12, 10);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 4, py + 2, 8, 5);
      break;

    // Two blooms on short stems. Sparse on purpose: a patch is a run of these.
    case 'flower':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 6, py + 8, 1, 3);
      ctx.fillRect(px + 10, py + 11, 1, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 9, 2, 2);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(px + 5, py + 5, 2, 1);
      ctx.fillRect(px + 10, py + 9, 1, 1);
      break;

    // A low box on legs: a bench, a chest cooler, a crate.
    case 'prop':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 14, 13, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 1, py + 6, 14, 5);
      ctx.fillRect(px + 2, py + 11, 2, 4);
      ctx.fillRect(px + 12, py + 11, 2, 4);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 1, py + 9, 14, 2);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 1, py + 6, 14, 2);
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(px + 1, py + 6, 14, 1);
      break;

    // A round top on a pedestal with something small set on it: a cafe table,
    // a stool, a barrel.
    case 'disc':
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 4, py + 9, 10, 3);
      ctx.fillRect(px + 3, py + 10, 12, 1);
      // pedestal and foot, a darkened cut of the top's own colour
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 5, py + 10, 6, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(px + 7, py + 7, 2, 4);
      ctx.fillRect(px + 5, py + 10, 6, 1);
      // the top, foreshortened: wider than it is deep
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 1, 10, 7);
      ctx.fillRect(px + 2, py + 2, 12, 5);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(px + 4, py + 2, 8, 2);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(px + 2, py + 6, 12, 1);
      ctx.fillRect(px + 3, py + 7, 10, 1);
      // whatever is set on it, with a saucer's worth of contact shadow
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(px + 5, py + 5, 6, 1);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 6, py + 2, 3, 3);
      ctx.fillRect(px + 9, py + 3, 1, 1);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(px + 6, py + 2, 3, 1);
      break;

    // A container of soil with something growing out of it: a planter, a tub,
    // a window box. The planting breaks the rim, which is what makes it read
    // as a box rather than a bench.
    case 'rim': {
      const leaf = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 10, 12, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 2, py + 3, 12, 7);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 2, py + 8, 12, 2);
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.fillRect(px + 2, py + 3, 12, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(px + 3, py + 4, 10, 2);
      // Sprigs, not a cushion: a ragged top edge is what says "growing".
      ctx.fillStyle = leaf;
      ctx.fillRect(px + 4, py, 2, 3);
      ctx.fillRect(px + 9, py, 2, 4);
      ctx.fillRect(px + 6, py + 1, 2, 2);
      ctx.fillRect(px + 3, py + 2, 10, 4);
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.fillRect(px + 4, py, 2, 2);
      ctx.fillRect(px + 4, py + 3, 3, 1);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 9, py + 2, 1, 4);
      ctx.fillRect(px + 4, py + 5, 8, 1);
      break;
    }

    // A canopy on a pole: a sun umbrella, a parasol, a market awning. A round
    // canopy in four panels that alternate the two colours, lit from the top
    // left, with the pole and its shadow showing below.
    case 'umbrella': {
      const alt = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 5, py + 9, 9, 3);
      ctx.fillRect(px + 4, py + 10, 11, 1);
      // Row spans make the canopy round without an arc call.
      const span = [
        [5, 6],
        [3, 10],
        [2, 12],
        [1, 14],
        [1, 14],
        [1, 14],
        [2, 12],
        [3, 10],
        [5, 6]
      ];
      span.forEach(([x, w], y) => {
        ctx.fillStyle = c[0];
        ctx.fillRect(px + x, py + y, w, 1);
        // opposite quadrants in the second colour: far-left and near-right
        ctx.fillStyle = alt;
        if (y < 4) ctx.fillRect(px + x, py + y, Math.min(w, 8 - x), 1);
        if (y > 4) ctx.fillRect(px + Math.max(x, 8), py + y, x + w - Math.max(x, 8), 1);
      });
      // the rib across the canopy, the lit crown, and the shaded near rim
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.fillRect(px + 1, py + 4, 14, 1);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(px + 4, py + 1, 3, 1);
      ctx.fillRect(px + 3, py + 2, 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 3, py + 7, 10, 1);
      ctx.fillRect(px + 5, py + 8, 6, 1);
      // the pole, below the canopy's near edge
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(px + 7, py + 9, 2, 3);
      break;
    }

    // An upright slab on a plinth, with a lighter face set into it: a memorial
    // stone, a boundary marker, a village monument. Tall and narrow, so it
    // reads as standing up out of the ground rather than lying on it.
    case 'stele': {
      const face = c[1] ?? c[0];
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px + 3, py + 13, 11, 2);
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 11, 10, 3);
      ctx.fillRect(px + 5, py + 2, 6, 10);
      ctx.fillRect(px + 6, py + 1, 4, 1);
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(px + 5, py + 2, 1, 10);
      ctx.fillRect(px + 6, py + 1, 3, 1);
      ctx.fillRect(px + 3, py + 11, 10, 1);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(px + 10, py + 2, 1, 10);
      ctx.fillRect(px + 3, py + 13, 10, 1);
      ctx.fillStyle = face;
      ctx.fillRect(px + 6, py + 4, 4, 5);
      ctx.fillStyle = 'rgba(0,0,0,.20)';
      ctx.fillRect(px + 6, py + 8, 4, 1);
      break;
    }

    case 'block':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px, py, TILE, 5);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(px, py + TILE - 3, TILE, 3);
      break;

    case 'shelf':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 3, py + 4, 10, 6);
      break;

    case 'mat':
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      break;

    // Four boards across the cell, alternating two values and closed with a
    // seam, so a run of them reads as decking rather than as one flat fill.
    // The pattern repeats every cell, which keeps the boards continuous.
    case 'planks': {
      const alt = c[1] ?? c[0];
      const seam = c[2] ?? c[0];
      ctx.fillStyle = c[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = alt;
      ctx.fillRect(px, py + 4, TILE, 3);
      ctx.fillRect(px, py + 12, TILE, 3);
      ctx.fillStyle = seam;
      for (let y = 3; y < TILE; y += 4) ctx.fillRect(px, py + y, TILE, 1);
      break;
    }

    // Flagstones on a grout bed: a paved patio, a stone path, a terrace. Four
    // slabs of four different sizes in two courses, with the joints of one
    // course offset from the other's and the course line stepping a pixel where
    // it crosses a slab. Each course has a slab that runs off the cell and
    // wraps round to the far side, so the same slab carries on into the next
    // tile and no grout line ever lands on a cell boundary — a run of these
    // reads as one paved surface rather than as a grid of tiles.
    case 'pavers': {
      const grout = def.base ?? c[0];
      const tone = [c[0], c[1] ?? c[0], c[2] ?? c[1] ?? c[0]];
      ctx.fillStyle = grout;
      ctx.fillRect(px, py, TILE, TILE);

      // A rectangle in cell coordinates, clipped to the cell so a slab that
      // overhangs never paints into the tile beside it on the sheet.
      const rect = (x: number, y: number, w: number, h: number, fill: string) => {
        const x0 = Math.max(0, x);
        const y0 = Math.max(0, y);
        const x1 = Math.min(TILE, x + w);
        const y1 = Math.min(TILE, y + h);
        if (x1 <= x0 || y1 <= y0) return;
        ctx.fillStyle = fill;
        ctx.fillRect(px + x0, py + y0, x1 - x0, y1 - y0);
      };

      // x, y, width, height, which stone value. Anything past the right or
      // bottom edge is drawn again a cell earlier, which is the wrap.
      const slabs = [
        [3, 6, 6, 6, 0],
        [10, 7, 8, 5, 2],
        [5, 13, 9, 8, 1],
        [15, 14, 5, 7, 0]
      ];
      for (const [x, y, w, h, value] of slabs) {
        for (const ox of [0, -TILE]) {
          for (const oy of [0, -TILE]) {
            rect(x + ox, y + oy, w, h, tone[value]);
            // Each slab sits a hair proud of the bed: lit along its top, in
            // its own shadow along the bottom.
            rect(x + ox, y + oy, w, 1, 'rgba(255,255,255,.10)');
            rect(x + ox, y + oy + h - 1, w, 1, 'rgba(0,0,0,.18)');
          }
        }
      }
      break;
    }

    // A short bar along one axis, drawn over `base`. Tiling it leaves a gap
    // between bars, so a run of them reads as a dashed line.
    case 'stripe-h':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 3, py + 7, 10, 2);
      break;

    case 'stripe-v':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 7, py + 3, 2, 10);
      break;
  }

  // The front face of a raised surface, last so it stays in front of anything
  // standing on the tile — including a prop the map put on a layer above this
  // one, which is why those styles keep clear of it (see PROP_FLOOR).
  if (def.edge) {
    ctx.fillStyle = def.edge;
    ctx.fillRect(px, py + PROP_FLOOR, TILE, TILE - PROP_FLOOR);
    // the lit nose of the surface, then the shadow it drops on the ground
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillRect(px, py + PROP_FLOOR, TILE, 1);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(px, py + TILE - 1, TILE, 1);
  }
}

/**
 * The tileset image. If the world pack ships a PNG for this tileset the loader
 * has it under `art:tiles:<name>` and it is used as-is; otherwise the engine
 * paints the placeholder recipes into a texture the same size and shape, so a
 * world plays identically before and after an artist fills the sheet in
 * (CLAUDE.md hard rule 3).
 */
export function tilesetTexture(scene: Phaser.Scene, tileset: TilesetDef, painted: boolean): string {
  const paintedKey = `art:tiles:${tileset.name}`;
  if (painted && scene.textures.exists(paintedKey)) return paintedKey;

  const key = `tiles:${tileset.name}`;
  if (scene.textures.exists(key)) return key;

  const { texture, ctx } = canvas(scene, key, tileset.imagewidth, tileset.imageheight);
  for (const def of tileset.tiles.values()) drawTile(ctx, def, def.sx, def.sy);
  texture.refresh();
  return key;
}

/** Every tileset a map draws from, as something a canvas can blit out of. */
function mapSheets(scene: Phaser.Scene, map: GameMap, painted: Set<string>): Map<string, CanvasImageSource> {
  const sheets = new Map<string, CanvasImageSource>();
  for (const tileset of map.tilesets) {
    const sheetKey = tilesetTexture(scene, tileset, painted.has(tileset.name));
    sheets.set(tileset.name, scene.textures.get(sheetKey).getSourceImage() as CanvasImageSource);
  }
  return sheets;
}

/** One cell of the layer stack, bottom-up, as `mapTexture` paints the lot. */
function drawCell(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  sheets: Map<string, CanvasImageSource>,
  x: number,
  y: number
): void {
  for (const layer of map.layers) {
    const def = layer.cells[y * map.width + x];
    const sheet = def && sheets.get(def.tileset);
    if (def && sheet) ctx.drawImage(sheet, def.sx, def.sy, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
  }
}

/**
 * Repaints a handful of cells on a map already baked (DESIGN.md §3). A flag
 * has changed and an overlay has come on or gone off, and the ground under it
 * has to follow: the whole stack for each of those cells is drawn again from
 * the map handed in, which by then is the map *with* whatever overlays are on
 * (engine/overlay.ts `withOverlays`). Painting a few tiles rather than the
 * whole town is the point — a village is a big texture and a chalkboard is one
 * square of it.
 *
 * A cell that no overlay covers any more is repainted the same way, off the
 * plain map, which is what puts the ordinary ground back.
 */
export function patchMapTiles(
  scene: Phaser.Scene,
  mapId: string,
  map: GameMap,
  painted: Set<string>,
  cells: Iterable<Vec2>
): void {
  const key = `map:${mapId}`;
  if (!scene.textures.exists(key)) return;
  const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
  const ctx = texture.getContext();
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const sheets = mapSheets(scene, map, painted);

  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    ctx.clearRect(x * TILE, y * TILE, TILE, TILE);
    drawCell(ctx, map, sheets, x, y);
  }
  texture.refresh();
}

/** The whole map baked into one texture — it is small, and it scrolls for free. */
export function mapTexture(scene: Phaser.Scene, mapId: string, map: GameMap, painted: Set<string>): string {
  const key = `map:${mapId}`;
  if (scene.textures.exists(key)) return key;

  const { texture, ctx } = canvas(scene, key, map.width * TILE, map.height * TILE);

  const sheets = mapSheets(scene, map, painted);

  // Tile layers paint bottom-up, in the order the Tiled file lists them.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) drawCell(ctx, map, sheets, x, y);
  }

  // Village names sit in the ground layer so they stay crisp at any zoom.
  ctx.font = `8px ${MONO}`;
  ctx.textAlign = 'center';
  for (const label of map.labels) {
    const lx = label.pos[0] * TILE;
    const ly = label.pos[1] * TILE;
    ctx.fillStyle = 'rgba(30,25,18,.55)';
    ctx.fillText(label.text, lx + 1, ly + 1);
    ctx.fillStyle = 'rgba(243,234,216,.9)';
    ctx.fillText(label.text, lx, ly);
  }

  texture.refresh();
  return key;
}

// --- buildings ---------------------------------------------------------------

export interface BuildingArt {
  key: string;
  /** Where to place the image, in pixels, with origin (0, 0). */
  x: number;
  y: number;
  painted: boolean;
}

/** Height of the floating name-plate box, placeholder or painted. */
const SIGN_H = 10;
/** Clearance kept between the plate and a painted facade's top edge. */
const SIGN_GAP = 2;

/** The sign box a building's name plate is drawn into — same look everywhere. */
function drawSign(ctx: CanvasRenderingContext2D, name: string, cx: number, w: number): void {
  ctx.font = `8px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(30,25,18,.85)';
  ctx.fillRect(cx - w / 2, 0, w, SIGN_H);
  ctx.fillStyle = '#f3ead8';
  ctx.fillText(name, cx, 7.5);
}

function signWidth(name: string): number {
  const probe = document.createElement('canvas').getContext('2d');
  if (probe) probe.font = `8px ${MONO}`;
  return Math.ceil((probe?.measureText(name).width ?? name.length * 5) + 8);
}

/** The rectangle a name plate occupies, in world pixels. */
export interface PlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far a building's name plate has to be raised to clear the plates already
 * placed on this map, in pixels — 0 for the usual case of a plate with the sky
 * to itself.
 *
 * Storefronts on a main street touch, and a long name makes a plate wider than
 * the shop front under it, so two neighbours can land their plates on the same
 * strip and read as one sign. Rather than making the map author space
 * buildings out, the second plate stacks above the first. `placed` is the
 * caller's running list of plates on this map, appended to here, so the answer
 * depends only on the order the placements are drawn in — first come, lowest
 * plate.
 */
export function plateLift(
  scene: Phaser.Scene,
  placement: BuildingPlacement,
  def: BuildingDef,
  paintedKey: string | null,
  placed: PlateBox[]
): number {
  if (placement.label === false) return 0;
  const bodyW = placement.size[0] * TILE;
  const bodyH = placement.size[1] * TILE;
  const footprintTop = placement.pos[1] * TILE;
  const w = signWidth(def.name);

  // The same two rules namePlateArt and buildingArt place a plate by: OVERHEAD
  // above the footprint, or clear of a painted facade that is taller than it.
  let y = footprintTop - OVERHEAD;
  if (paintedKey && scene.textures.exists(paintedKey)) {
    const artTop = footprintTop + bodyH - scene.textures.get(paintedKey).getSourceImage().height;
    if (artTop < footprintTop) y = artTop - SIGN_H - SIGN_GAP;
  }
  const x = placement.pos[0] * TILE + (bodyW - w) / 2;

  const step = SIGN_H + SIGN_GAP;
  let lift = 0;
  const clashes = (top: number) =>
    placed.some((p) => p.x < x + w && x < p.x + p.w && p.y < top + SIGN_H && top < p.y + p.h);
  // A handful of storeys is a stack; past that something else is wrong, and a
  // plate marching off the top of the screen helps nobody.
  while (lift < step * 4 && clashes(y - lift)) lift += step;

  placed.push({ x, y: y - lift, w, h: SIGN_H });
  return lift;
}

/**
 * Unpainted building: flat facade, roof band, door, and a sign with the real
 * name. Content ships before art, so this has to look deliberate rather than
 * broken. `lift` raises the sign clear of a neighbour's (see plateLift); the
 * facade itself never moves.
 */
export function buildingArt(
  scene: Phaser.Scene,
  placement: BuildingPlacement,
  def: BuildingDef,
  paintedKey: string | null,
  lift = 0
): BuildingArt {
  const bodyW = placement.size[0] * TILE;
  const bodyH = placement.size[1] * TILE;

  if (paintedKey) {
    // A facade is footprint-wide but may be taller; the extra rows (roof, sign)
    // hang above it. Anchor to the bottom of the footprint so dropping in art
    // never shifts the building (DESIGN.md §4).
    const painted = scene.textures.get(paintedKey).getSourceImage();
    return {
      key: paintedKey,
      x: placement.pos[0] * TILE,
      y: placement.pos[1] * TILE + bodyH - painted.height,
      painted: true
    };
  }

  const key = lift ? `unpainted:${placement.id}:${lift}` : `unpainted:${placement.id}`;
  if (!scene.textures.exists(key)) {
    const label = placement.label !== false;
    const signW = label ? signWidth(def.name) : 0;

    const texW = Math.max(bodyW, signW);
    const texH = bodyH + OVERHEAD + lift;
    const left = Math.floor((texW - bodyW) / 2);
    // The sign stays at the top of the texture and the facade drops by `lift`,
    // so raising the sign leaves the building exactly where it was.
    const head = OVERHEAD + lift;
    const { texture, ctx } = canvas(scene, key, texW, texH);

    // roof band, overhanging the wall top
    ctx.fillStyle = def.roof;
    ctx.fillRect(left - 2, head - 8, bodyW + 4, 12);

    ctx.fillStyle = def.wall;
    ctx.fillRect(left, head + 4, bodyW, bodyH - 4);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(left, head + bodyH - 3, bodyW, 3);

    ctx.fillStyle = '#f5e6b8';
    for (let i = 0; i < placement.size[0] - 1; i += 2) {
      ctx.fillRect(left + 8 + i * TILE, head + 12, 8, 8);
    }

    const doorX = left + (placement.door[0] - placement.pos[0]) * TILE;
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(doorX + 3, head + bodyH - 14, 10, 14);

    if (label) drawSign(ctx, def.name, texW / 2, signW);

    texture.refresh();
  }

  const texture = scene.textures.get(key);
  const left = Math.floor((texture.getSourceImage().width - bodyW) / 2);
  return {
    key,
    x: placement.pos[0] * TILE - left,
    y: placement.pos[1] * TILE - OVERHEAD - lift,
    painted: false
  };
}

export interface NamePlateArt {
  key: string;
  x: number;
  y: number;
}

/**
 * Floating name plate for a *painted* building. The placeholder bakes its
 * sign straight into `buildingArt`'s texture; a painted facade is a plain PNG
 * with nothing to bake it into, so this draws the same box in its own small
 * texture. It sits the same distance above the footprint's top as the
 * placeholder's sign does — unless the art is taller than the footprint, in
 * which case it moves up to clear the art's top edge instead, so a tall
 * facade never gets its roofline covered (CLAUDE.md hard rule 3, DESIGN.md §2).
 * `placement.label === false` opts a building out of the plate entirely;
 * callers should skip calling this at all in that case. `lift` raises the
 * plate clear of a neighbour's (see plateLift).
 */
export function namePlateArt(
  scene: Phaser.Scene,
  placement: BuildingPlacement,
  def: BuildingDef,
  artTop: number,
  lift = 0
): NamePlateArt {
  const key = `nameplate:${placement.id}`;
  if (!scene.textures.exists(key)) {
    const signW = signWidth(def.name);
    const { texture, ctx } = canvas(scene, key, signW, SIGN_H);
    drawSign(ctx, def.name, signW / 2, signW);
    texture.refresh();
  }

  const width = scene.textures.get(key).getSourceImage().width;
  const footprintTop = placement.pos[1] * TILE;
  const footprintLeft = placement.pos[0] * TILE;
  const bodyW = placement.size[0] * TILE;
  const defaultTop = footprintTop - OVERHEAD;
  const top = artTop < footprintTop ? artTop - SIGN_H - SIGN_GAP : defaultTop;

  return { key, x: footprintLeft + (bodyW - width) / 2, y: top - lift };
}

// --- the plaque beside the door ----------------------------------------------

/** The little plaque, in pixels. Small on purpose: it is a detail, not a sign. */
const PLAQUE_W = 6;
const PLAQUE_H = 5;
/** How far its bottom edge sits above the ground line at the facade's foot. */
const PLAQUE_LIFT = 4;

export interface PlaqueArt {
  key: string;
  x: number;
  y: number;
}

/**
 * A small brass plaque on the wall beside the door, over whatever is behind
 * it — the engine draws this on every building, painted or not, so no artist
 * ever has to paint one and every building has somewhere to thank its painter
 * (DESIGN.md §2/§4). Returns null when the placement has opted out.
 *
 * It hangs at the foot of the facade, centred on the tile the player reads it
 * from, so wall art and plaque never fight over the same pixels for long.
 */
export function plaqueArt(scene: Phaser.Scene, placement: BuildingPlacement): PlaqueArt | null {
  const tile = plaqueTile(placement);
  if (!tile) return null;

  const key = 'prop:plaque';
  if (!scene.textures.exists(key)) {
    const { texture, ctx } = canvas(scene, key, PLAQUE_W, PLAQUE_H);
    ctx.fillStyle = '#8a6a35';
    ctx.fillRect(0, 0, PLAQUE_W, PLAQUE_H);
    ctx.fillStyle = '#d8b268';
    ctx.fillRect(0, 0, PLAQUE_W, 1);
    texture.refresh();
  }

  const groundY = (placement.pos[1] + placement.size[1]) * TILE;
  return {
    key,
    x: tile[0] * TILE + (TILE - PLAQUE_W) / 2,
    y: groundY - PLAQUE_LIFT - PLAQUE_H
  };
}

// --- street fixtures ---------------------------------------------------------

/** The suggestion box, in pixels. Small: it is a thing on a sidewalk. */
const FIXTURE_W = 8;
const FIXTURE_H = 10;
/** How far its foot sits above the bottom edge of its tile. */
const FIXTURE_FOOT = 2;

export interface FixtureArt {
  key: string;
  x: number;
  y: number;
  /** Draw at this depth so a player standing behind it passes behind it. */
  depth: number;
}

/**
 * A little post box on a leg: two colours, engine-drawn, standing on its own
 * tile (DESIGN.md §2). Like the plaque it belongs to the engine rather than to
 * any world, so a town gets one by naming a tile in `world.json` and never by
 * painting anything.
 */
export function fixtureArt(scene: Phaser.Scene, fixture: Fixture): FixtureArt {
  const key = `prop:fixture:${fixture.kind}`;
  if (!scene.textures.exists(key)) drawFixture(scene, key, fixture.kind);

  const [tx, ty] = fixture.pos;
  return {
    key,
    x: tx * TILE + (TILE - FIXTURE_W) / 2,
    y: (ty + 1) * TILE - FIXTURE_FOOT - FIXTURE_H,
    depth: (ty + 1) * TILE
  };
}

function drawFixture(scene: Phaser.Scene, key: string, kind: FixtureKind): void {
  const { texture, ctx } = canvas(scene, key, FIXTURE_W, FIXTURE_H);
  // One shape so far. Lit from the top left like everything else in town.
  const body = '#3f5f4c';
  const trim = '#d8b268';

  switch (kind) {
    case 'suggestion-box':
    default:
      ctx.fillStyle = body;
      ctx.fillRect(0, 0, FIXTURE_W, 7); // the box
      ctx.fillRect(3, 7, 2, FIXTURE_H - 7); // the post it stands on
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(FIXTURE_W - 1, 1, 1, 6); // the shaded side
      ctx.fillStyle = trim;
      ctx.fillRect(0, 0, FIXTURE_W, 1); // the lid
      ctx.fillRect(2, 3, 4, 1); // the slot
      break;
  }

  texture.refresh();
}

// --- characters --------------------------------------------------------------

/**
 * Generic townsperson drawn from a `look` (DESIGN.md §4), laid out exactly like
 * a real sheet (4 directions down/left/right/up x 3 frames) so a dropped-in
 * PNG uses the same frame indices. The recipe itself lives in engine/figure.ts,
 * which needs no browser; this wraps it in a Phaser texture.
 */
export function characterTexture(scene: Phaser.Scene, look: Look): string {
  const key = `townsperson:${figureKey(look)}`;
  if (scene.textures.exists(key)) return key;

  const { texture, ctx } = canvas(scene, key, CHAR_W * 3, CHAR_H * FACINGS.length);
  FACINGS.forEach((dir, row) => {
    for (let step = 0; step < 3; step++) {
      drawFigure(ctx, step * CHAR_W, row * CHAR_H, dir, step, look);
    }
  });
  texture.refresh();

  FACINGS.forEach((_, row) => {
    for (let step = 0; step < 3; step++) {
      texture.add(row * 3 + step, 0, step * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H);
    }
  });

  return key;
}

export function frameIndex(dir: Facing, step: number): number {
  return FACINGS.indexOf(dir) * 3 + step;
}

// --- small props -------------------------------------------------------------

export function itemTexture(scene: Phaser.Scene): string {
  const key = 'prop:item';
  if (scene.textures.exists(key)) return key;
  const { texture, ctx } = canvas(scene, key, TILE, TILE);
  ctx.fillStyle = 'rgba(255,230,109,.4)';
  ctx.fillRect(4, 4, 8, 8);
  ctx.fillStyle = '#ffe66d';
  ctx.fillRect(6, 6, 4, 4);
  texture.refresh();
  return key;
}

export function promptTexture(scene: Phaser.Scene, glyph: string): string {
  const key = `prompt:${glyph}`;
  if (scene.textures.exists(key)) return key;
  const { texture, ctx } = canvas(scene, key, TILE, 12);
  ctx.fillStyle = '#f3ead8';
  ctx.fillRect(2, 0, 12, 11);
  ctx.fillStyle = '#2a231a';
  ctx.font = `8px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(glyph, 8, 8);
  texture.refresh();
  return key;
}

/**
 * Where a tapped walk is headed: a small ring on the destination tile, hollow
 * so whatever the player tapped is still visible under it. Engine chrome like
 * the A prompt beside it — no world ever supplies one.
 */
export function markerTexture(scene: Phaser.Scene): string {
  const key = 'prop:marker';
  if (scene.textures.exists(key)) return key;
  const { texture, ctx } = canvas(scene, key, TILE, TILE);
  ctx.fillStyle = 'rgba(42,35,26,.55)';
  ctx.fillRect(4, 4, 8, 8);
  ctx.fillStyle = '#f3ead8';
  ctx.fillRect(5, 5, 6, 6);
  ctx.clearRect(6, 6, 4, 4);
  texture.refresh();
  return key;
}

export function dashTexture(scene: Phaser.Scene): string {
  const key = 'prop:dash';
  if (scene.textures.exists(key)) return key;
  const { texture, ctx } = canvas(scene, key, 24, 6);
  ctx.fillStyle = '#b7a081';
  ctx.fillRect(0, 0, 14, 6);
  texture.refresh();
  return key;
}
