/**
 * Tiled (mapeditor.org) JSON → the tile grid the engine draws and collides
 * against. Conventions are documented in DESIGN.md §2; the short version:
 *
 * - orthogonal, finite, 16×16 tiles, uncompressed `data` arrays;
 * - one tile layer named `ground` is required, further tile layers are drawn
 *   over it in file order and also contribute solidity;
 * - a tile is solid when its tileset entry carries `solid: true`;
 * - every tile a map uses carries the properties the engine needs to draw a
 *   placeholder for it (`style`, `colors`, optional `base` and `edge`) so a world is
 *   playable before its tileset PNG exists (CLAUDE.md hard rule 3);
 * - object layers are ignored: gameplay positions live in world.json.
 *
 * Nothing here knows about a specific world: names, kinds and colours all
 * arrive from the data.
 */

/** The engine's grid. Everything in a world pack is authored on it. */
export const TILE = 16;

/** Bits 30-32 of a Tiled gid are flip/rotation flags. */
const GID_MASK = 0x1fffffff;

/**
 * How the engine draws a tile when the tileset PNG is missing. These are
 * shapes, not meanings — the meaning is the tile's Tiled class (`kind`).
 */
export type TileStyle =
  | 'flat'
  | 'speck'
  | 'ripple'
  | 'tree'
  | 'flower'
  | 'prop'
  | 'disc'
  | 'rim'
  | 'umbrella'
  | 'block'
  | 'shelf'
  | 'mat'
  | 'planks'
  | 'stripe-h'
  | 'stripe-v';

const STYLES: readonly string[] = [
  'flat',
  'speck',
  'ripple',
  'tree',
  'flower',
  'prop',
  'disc',
  'rim',
  'umbrella',
  'block',
  'shelf',
  'mat',
  'planks',
  'stripe-h',
  'stripe-v'
];

export interface TileDef {
  /** The tile's Tiled class: grass, road, water, wall, floor, counter, mat … */
  kind: string;
  style: TileStyle;
  /** Painted under the style detail, for styles that sit on top of ground. */
  base?: string;
  /**
   * Front face colour for a tile whose surface is raised above the ground
   * plane — the near row of a deck, a porch, a stage. Drawn last, along the
   * bottom of the cell, so it stays in front of everything else in it.
   */
  edge?: string;
  colors: string[];
  solid: boolean;
  /** Which tileset this tile came from, and where it sits in that tileset. */
  tileset: string;
  id: number;
  sx: number;
  sy: number;
}

export interface TilesetDef {
  name: string;
  /** Image path as written in the tileset file, relative to it. */
  image: string;
  imagewidth: number;
  imageheight: number;
  columns: number;
  tilecount: number;
  margin: number;
  spacing: number;
  tiles: Map<number, TileDef>;
  /** Absolute URL of `image`, filled in by whoever loaded the tileset. */
  imageUrl?: string;
}

export interface TileLayer {
  name: string;
  /** Row-major, `width * height` long. `null` is an empty cell. */
  cells: (TileDef | null)[];
}

export interface TileGrid {
  width: number;
  height: number;
  layers: TileLayer[];
  /** The tilesets this map actually references, in firstgid order. */
  tilesets: TilesetDef[];
}

/** Resolves an external tileset reference (`"source"`) to a parsed tileset. */
export type TilesetResolver = (source: string) => TilesetDef | undefined;

// --- tiny typed readers ------------------------------------------------------

type Raw = Record<string, unknown>;

function obj(value: unknown, where: string): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where}: not a JSON object`);
  return value as Raw;
}

function str(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${where}: "${field}" must be a non-empty string`);
  return value;
}

function int(value: unknown, field: string, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${where}: "${field}" must be a whole number`);
  return value;
}

function arr(value: unknown, field: string, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: "${field}" must be an array`);
  return value;
}

/** Tiled writes custom properties as `[{ name, type, value }]`. */
function properties(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (entry && typeof entry === 'object' && typeof (entry as Raw).name === 'string') {
      out[(entry as Raw).name as string] = (entry as Raw).value;
    }
  }
  return out;
}

// --- tilesets ----------------------------------------------------------------

export function parseTileset(raw: unknown, where: string): TilesetDef {
  const src = obj(raw, where);
  if (src.type !== undefined && src.type !== 'tileset') {
    throw new Error(`${where}: expected a Tiled tileset, got type "${String(src.type)}"`);
  }

  const name = str(src.name, 'name', where);
  const tilewidth = int(src.tilewidth, 'tilewidth', where);
  const tileheight = int(src.tileheight, 'tileheight', where);
  if (tilewidth !== TILE || tileheight !== TILE) {
    throw new Error(`${where}: tiles are ${tilewidth}×${tileheight}; the engine's grid is ${TILE}×${TILE}`);
  }

  const columns = int(src.columns, 'columns', where);
  if (columns < 1) throw new Error(`${where}: "columns" must be at least 1`);
  const tilecount = int(src.tilecount, 'tilecount', where);
  if (tilecount < 1) throw new Error(`${where}: "tilecount" must be at least 1`);
  const margin = src.margin === undefined ? 0 : int(src.margin, 'margin', where);
  const spacing = src.spacing === undefined ? 0 : int(src.spacing, 'spacing', where);
  const image = str(src.image, 'image', where);

  const rows = Math.ceil(tilecount / columns);
  const imagewidth =
    src.imagewidth === undefined ? margin * 2 + columns * (TILE + spacing) - spacing : int(src.imagewidth, 'imagewidth', where);
  const imageheight =
    src.imageheight === undefined ? margin * 2 + rows * (TILE + spacing) - spacing : int(src.imageheight, 'imageheight', where);

  const tiles = new Map<number, TileDef>();
  for (const entry of arr(src.tiles ?? [], 'tiles', where)) {
    const tile = obj(entry, `${where}: tiles[]`);
    const id = int(tile.id, 'tiles[].id', where);
    if (id < 0 || id >= tilecount) throw new Error(`${where}: tile id ${id} is outside the tileset's ${tilecount} tiles`);

    const at = `${where}: tile ${id}`;
    const prop = properties(tile.properties);
    const style = str(prop.style, 'style', at);
    if (!STYLES.includes(style)) {
      throw new Error(`${at}: unknown style "${style}" — expected one of ${STYLES.join(', ')}`);
    }
    const colors = str(prop.colors, 'colors', at)
      .split(',')
      .map((color) => color.trim())
      .filter(Boolean);
    if (!colors.length) throw new Error(`${at}: "colors" is empty`);

    const column = id % columns;
    const row = Math.floor(id / columns);
    tiles.set(id, {
      kind: typeof tile.type === 'string' && tile.type ? tile.type : 'tile',
      style: style as TileStyle,
      base: typeof prop.base === 'string' && prop.base ? prop.base : undefined,
      edge: typeof prop.edge === 'string' && prop.edge ? prop.edge : undefined,
      colors,
      solid: prop.solid === true,
      tileset: name,
      id,
      sx: margin + column * (TILE + spacing),
      sy: margin + row * (TILE + spacing)
    });
  }

  return { name, image, imagewidth, imageheight, columns, tilecount, margin, spacing, tiles };
}

/**
 * The external tileset paths a map file references, as written in it. The
 * caller resolves them against the map file's own location and fetches them
 * before calling `parseTiledMap`.
 */
export function tilesetSources(raw: unknown, where: string): string[] {
  const src = obj(raw, where);
  const out: string[] = [];
  for (const entry of arr(src.tilesets ?? [], 'tilesets', where)) {
    const ref = obj(entry, `${where}: tilesets[]`);
    if (typeof ref.source === 'string') out.push(ref.source);
  }
  return out;
}

// --- maps --------------------------------------------------------------------

interface TilesetSlot {
  firstgid: number;
  tileset: TilesetDef;
}

export function parseTiledMap(raw: unknown, resolve: TilesetResolver, where: string): TileGrid {
  const src = obj(raw, where);
  if (src.type !== undefined && src.type !== 'map') {
    throw new Error(`${where}: expected a Tiled map, got type "${String(src.type)}"`);
  }
  if (src.orientation !== 'orthogonal') {
    throw new Error(`${where}: orientation is "${String(src.orientation)}" — the engine only draws orthogonal maps`);
  }
  if (src.infinite === true) throw new Error(`${where}: infinite maps are not supported — set a fixed map size in Tiled`);

  const tilewidth = int(src.tilewidth, 'tilewidth', where);
  const tileheight = int(src.tileheight, 'tileheight', where);
  if (tilewidth !== TILE || tileheight !== TILE) {
    throw new Error(`${where}: tiles are ${tilewidth}×${tileheight}; the engine's grid is ${TILE}×${TILE}`);
  }

  const width = int(src.width, 'width', where);
  const height = int(src.height, 'height', where);
  if (width < 1 || height < 1) throw new Error(`${where}: map is ${width}×${height} tiles`);

  const slots: TilesetSlot[] = [];
  for (const entry of arr(src.tilesets ?? [], 'tilesets', where)) {
    const ref = obj(entry, `${where}: tilesets[]`);
    const firstgid = int(ref.firstgid, 'tilesets[].firstgid', where);
    if (typeof ref.source === 'string') {
      const tileset = resolve(ref.source);
      if (!tileset) throw new Error(`${where}: tileset "${ref.source}" could not be loaded`);
      slots.push({ firstgid, tileset });
    } else {
      slots.push({ firstgid, tileset: parseTileset(ref, `${where}: embedded tileset`) });
    }
  }
  if (!slots.length) throw new Error(`${where}: the map references no tilesets`);
  // Highest firstgid first: a gid belongs to the last tileset that starts at or
  // below it, which is how Tiled assigns them.
  const lookup = [...slots].sort((a, b) => b.firstgid - a.firstgid);

  const tileFor = (gid: number): TileDef | null => {
    if (gid === 0) return null;
    for (const slot of lookup) {
      if (gid < slot.firstgid) continue;
      const id = gid - slot.firstgid;
      const tile = slot.tileset.tiles.get(id);
      if (!tile) {
        throw new Error(
          `${where}: tileset "${slot.tileset.name}" has no properties for tile ${id} — every tile a map uses needs style and colors`
        );
      }
      return tile;
    }
    throw new Error(`${where}: gid ${gid} is below every tileset's firstgid`);
  };

  const layers: TileLayer[] = [];
  collectTileLayers(arr(src.layers ?? [], 'layers', where), where, (layer) => {
    const name = str(layer.name, 'layers[].name', where);
    if (layer.encoding !== undefined && layer.encoding !== 'csv') {
      throw new Error(`${where}: layer "${name}" is "${String(layer.encoding)}" encoded — re-export it with CSV/uncompressed layer data`);
    }
    const data = arr(layer.data, `layer "${name}" data`, where);
    if (data.length !== width * height) {
      throw new Error(`${where}: layer "${name}" holds ${data.length} tiles, expected ${width * height} (${width}×${height})`);
    }
    const cells = data.map((value, index) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${where}: layer "${name}" cell ${index} is not a gid`);
      }
      return tileFor(value & GID_MASK);
    });
    layers.push({ name, cells });
  });

  if (!layers.some((layer) => layer.name === 'ground')) {
    throw new Error(`${where}: no visible tile layer named "ground"`);
  }

  const used = new Set(layers.flatMap((layer) => layer.cells).map((cell) => cell?.tileset));
  return {
    width,
    height,
    layers,
    tilesets: slots.filter((slot) => used.has(slot.tileset.name)).map((slot) => slot.tileset)
  };
}

/** Visible tile layers, in file order, descending into any layer groups. */
function collectTileLayers(raw: unknown[], where: string, visit: (layer: Raw) => void): void {
  for (const entry of raw) {
    const layer = obj(entry, `${where}: layers[]`);
    if (layer.visible === false) continue;
    if (layer.type === 'group') {
      collectTileLayers(arr(layer.layers ?? [], 'layers', where), where, visit);
    } else if (layer.type === 'tilelayer') {
      visit(layer);
    }
    // Object, image and any future layer types are ignored on purpose: every
    // gameplay position lives in world.json (DESIGN.md §2).
  }
}

/** The tile at a cell on a given layer stack, topmost non-empty first. */
export function tileAt(grid: TileGrid, x: number, y: number): TileDef | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  const index = y * grid.width + x;
  for (let i = grid.layers.length - 1; i >= 0; i--) {
    const cell = grid.layers[i].cells[index];
    if (cell) return cell;
  }
  return null;
}
