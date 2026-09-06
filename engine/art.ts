import Phaser from 'phaser';
import { FACINGS } from './schema';
import { TILE } from './tiled';
import type { BuildingDef, BuildingPlacement, Facing, GameMap } from './schema';
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
 * One tile of the fallback tileset, drawn from the recipe its Tiled entry
 * carries. `style` is a shape, not a meaning: the meaning is the tile's class.
 * Every shape stays inside its own 16x16 cell so a tile looks the same whether
 * it is drawn here or blitted out of the tileset image.
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

    case 'flower':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 5, py + 5, 3, 3);
      ctx.fillRect(px + 10, py + 9, 2, 2);
      break;

    case 'prop':
      ctx.fillStyle = c[0];
      ctx.fillRect(px + 1, py + 6, 14, 5);
      ctx.fillRect(px + 2, py + 11, 2, 4);
      ctx.fillRect(px + 12, py + 11, 2, 4);
      ctx.fillStyle = c[1] ?? c[0];
      ctx.fillRect(px + 1, py + 6, 14, 2);
      break;

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

/** The whole map baked into one texture — it is small, and it scrolls for free. */
export function mapTexture(scene: Phaser.Scene, mapId: string, map: GameMap, painted: Set<string>): string {
  const key = `map:${mapId}`;
  if (scene.textures.exists(key)) return key;

  const { texture, ctx } = canvas(scene, key, map.width * TILE, map.height * TILE);

  const sheets = new Map<string, CanvasImageSource>();
  for (const tileset of map.tilesets) {
    const sheetKey = tilesetTexture(scene, tileset, painted.has(tileset.name));
    sheets.set(tileset.name, scene.textures.get(sheetKey).getSourceImage() as CanvasImageSource);
  }

  // Tile layers paint bottom-up, in the order the Tiled file lists them.
  for (const layer of map.layers) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const def = layer.cells[y * map.width + x];
        const sheet = def && sheets.get(def.tileset);
        if (def && sheet) ctx.drawImage(sheet, def.sx, def.sy, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
      }
    }
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

/**
 * Unpainted building: flat facade, roof band, door, and a sign with the real
 * name. Content ships before art, so this has to look deliberate rather than
 * broken.
 */
export function buildingArt(
  scene: Phaser.Scene,
  placement: BuildingPlacement,
  def: BuildingDef,
  paintedKey: string | null
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

  const key = `unpainted:${placement.id}`;
  if (!scene.textures.exists(key)) {
    const probe = document.createElement('canvas').getContext('2d');
    if (probe) probe.font = `8px ${MONO}`;
    const signW = Math.ceil((probe?.measureText(def.name).width ?? def.name.length * 5) + 8);

    const texW = Math.max(bodyW, signW);
    const texH = bodyH + OVERHEAD;
    const left = Math.floor((texW - bodyW) / 2);
    const { texture, ctx } = canvas(scene, key, texW, texH);

    // roof band, overhanging the wall top
    ctx.fillStyle = def.roof;
    ctx.fillRect(left - 2, OVERHEAD - 8, bodyW + 4, 12);

    ctx.fillStyle = def.wall;
    ctx.fillRect(left, OVERHEAD + 4, bodyW, bodyH - 4);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(left, OVERHEAD + bodyH - 3, bodyW, 3);

    ctx.fillStyle = '#f5e6b8';
    for (let i = 0; i < placement.size[0] - 1; i += 2) {
      ctx.fillRect(left + 8 + i * TILE, OVERHEAD + 12, 8, 8);
    }

    const doorX = left + (placement.door[0] - placement.pos[0]) * TILE;
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(doorX + 3, OVERHEAD + bodyH - 14, 10, 14);

    ctx.font = `8px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(30,25,18,.85)';
    ctx.fillRect(texW / 2 - signW / 2, 0, signW, 10);
    ctx.fillStyle = '#f3ead8';
    ctx.fillText(def.name, texW / 2, 7.5);

    texture.refresh();
  }

  const texture = scene.textures.get(key);
  const left = Math.floor((texture.getSourceImage().width - bodyW) / 2);
  return {
    key,
    x: placement.pos[0] * TILE - left,
    y: placement.pos[1] * TILE - OVERHEAD,
    painted: false
  };
}

// --- characters --------------------------------------------------------------

function drawFigure(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  dir: Facing,
  step: number,
  accent: string
): void {
  const skin = '#e8c39a';
  const hair = '#3a2c1e';
  const legs = '#33404f';
  const swing = step === 1 ? 1 : step === 2 ? -1 : 0;

  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(ox + 3, oy + 29, 10, 3);

  ctx.fillStyle = legs;
  ctx.fillRect(ox + 4, oy + 24, 3, 7 + swing);
  ctx.fillRect(ox + 9, oy + 24, 3, 7 - swing);

  ctx.fillStyle = accent;
  ctx.fillRect(ox + 4, oy + 15, 8, 10);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(ox + 3, oy + 16, 1, 7);
  ctx.fillRect(ox + 12, oy + 16, 1, 7);

  ctx.fillStyle = skin;
  ctx.fillRect(ox + 4, oy + 7, 8, 8);

  ctx.fillStyle = hair;
  ctx.fillRect(ox + 4, oy + 5, 8, 4);
  if (dir === 'up') ctx.fillRect(ox + 4, oy + 5, 8, 8);
  if (dir === 'left') ctx.fillRect(ox + 9, oy + 5, 3, 6);
  if (dir === 'right') ctx.fillRect(ox + 4, oy + 5, 3, 6);

  if (dir !== 'up') {
    const eye = dir === 'left' ? 4 : dir === 'right' ? 8 : 6;
    ctx.fillStyle = '#2a231a';
    ctx.fillRect(ox + eye, oy + 11, 1, 1);
    ctx.fillRect(ox + eye + 3, oy + 11, 1, 1);
  }
}

/**
 * Generic townsperson in a per-character accent colour, laid out exactly like a
 * real sheet (DESIGN.md §4: 4 directions down/left/right/up x 3 frames) so a
 * dropped-in PNG uses the same frame indices.
 */
export function characterTexture(scene: Phaser.Scene, accent: string): string {
  const key = `townsperson:${accent}`;
  if (scene.textures.exists(key)) return key;

  const { texture, ctx } = canvas(scene, key, CHAR_W * 3, CHAR_H * FACINGS.length);
  FACINGS.forEach((dir, row) => {
    for (let step = 0; step < 3; step++) {
      drawFigure(ctx, step * CHAR_W, row * CHAR_H, dir, step, accent);
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

export function dashTexture(scene: Phaser.Scene): string {
  const key = 'prop:dash';
  if (scene.textures.exists(key)) return key;
  const { texture, ctx } = canvas(scene, key, 24, 6);
  ctx.fillStyle = '#b7a081';
  ctx.fillRect(0, 0, 14, 6);
  texture.refresh();
  return key;
}
