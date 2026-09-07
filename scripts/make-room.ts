/**
 * A first-cut interior from a short spec: `scripts/make-room`.
 *
 * An interior is a Tiled map like any other (DESIGN.md §2) — four walls, a
 * floor, a gap for the door, and some solid furniture — so the fiddly part of
 * writing one by hand is the bookkeeping, not the design: 300-odd gids in a
 * row, a wall that has to stay solid all the way round, a counter an NPC has
 * to stay behind. This turns that into a spec an author can read:
 *
 *   npm run make-room -- route10 stamford-coffee-interior --spec <file.json>
 *   npm run make-room -- route10 stamford-coffee-interior --spec '{"size":…}'
 *
 * It writes `worlds/<world>/maps/<mapId>.json` and prints the matching
 * `maps.<mapId>` stanza for `world.json` on stdout (or into `--stanza <file>`),
 * along with the `enter` tile to put on the building's placement. Nothing is
 * pasted into `world.json` automatically: placements and the travel graph are
 * hand-authored data, and a script that rewrites them would be one more thing
 * to review on every run.
 *
 * The output is deterministic and idempotent — the same spec always writes the
 * same bytes, so re-running after an edit shows a real diff. Artists refine the
 * result in Tiled afterwards; the script is the first cut, not the owner of the
 * file.
 *
 * ## The spec
 *
 * ```jsonc
 * {
 *   "name": "Stamford Coffee",              // the map's name in world.json
 *   "size": [22, 14],                       // tiles, walls included
 *   "wall": 14,                             // tile id; default: the first "wall" tile
 *   "floor": [11, 24],                      // tile ids, scattered over the floor
 *   "door": { "side": "bottom", "column": 10, "width": 2 },
 *   "exit": { "id": "…-exit", "to": "stamford", "spawn": [89, 23], "facing": "down" },
 *   "props": [
 *     { "kind": "counter", "rect": [3, 2, 12, 1], "behind": "top" },
 *     { "kind": "table",   "at": [[4, 5], [7, 5]] }
 *   ]
 * }
 * ```
 *
 * `door.column` is the index along the wall it sits in — a column for a door on
 * the top or bottom edge, a row for one on the left or right. The convention is
 * `"bottom"`, which is what a doorway you walk down out of reads as; the other
 * three sides work but no world uses one yet. The exit trigger covers the gap,
 * and the spawn tile inside the room is the tile just in from it.
 *
 * Every prop covers either a `rect` (`[x, y, w, h]`) or a list of tiles (`at`),
 * and may name its own `tiles` (ids, cycled in order) instead of the default for
 * its kind:
 *
 * - `counter`, `bar` — a run of counter tiles with a staff strip behind it on
 *   the `behind` side, sealed at both ends the way Stewart's is, so somebody
 *   working back there stays back there.
 * - `shelf` — a run of shelving, cycling through `tiles` so a long run reads as
 *   separate bays.
 * - `table` — a round cafe table per tile.
 * - `stage` — a raised platform: planks, with the near row carrying the front
 *   face of the riser (`front`, default `"bottom"`).
 * - `mat`, `planter`, `sign` — a doormat, a pot with something growing in it,
 *   and a standing board a later episode can hang a prop sign on.
 *
 * Tile ids come from the world's own tileset — the script never invents one —
 * and the defaults are found by the tileset's kinds (`counter`, `shelf`,
 * `table`, `stage`, `mat`, `planter`, `board`), so a world with a different
 * tileset gets its own furniture with no change here (CLAUDE.md hard rule 1).
 *
 * `buildRoom` below is pure — spec in, grid out — and is what
 * `scripts/make-room.test.ts` exercises. Everything to do with files lives
 * under "the script" at the bottom.
 *
 * Runs under Node's built-in TypeScript type stripping like the other scripts
 * here, so relative imports carry an explicit ".ts" — see
 * scripts/validate-episodes.ts's header.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseTileset } from '../engine/tiled.ts';
import type { TilesetDef } from '../engine/tiled.ts';
import type { Facing, Fixture, MapExit, MapMeta, MapSign, Person, Rect, Vec2 } from '../engine/schema.ts';

// --- the spec ----------------------------------------------------------------

export type Side = 'top' | 'bottom' | 'left' | 'right';

export const PROP_KINDS = [
  'counter',
  'bar',
  'island',
  'shelf',
  'table',
  'stool',
  'foosball',
  'stage',
  'mat',
  'planter',
  'sign',
  'firepit',
  'hall',
  'door',
  'panel',
  'exit'
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** The kinds that go in a wall rather than on the floor. */
const WALL_KINDS: readonly PropKind[] = ['door', 'panel', 'exit'];

/**
 * The kinds that stand *on* the floor rather than being it. These go on the
 * map's second tile layer with the floor kept underneath, which is how the
 * tileset draws them: a table, a stool, a planter is a shape in the top of its
 * cell with nothing behind it, and on a layer of its own it has the room's own
 * floor behind it instead of a hole.
 */
const OVER_FLOOR: readonly PropKind[] = ['table', 'stool', 'foosball', 'planter', 'sign', 'firepit'];

export interface RoomProp {
  kind: PropKind;
  /** [x, y, w, h] in tiles. Either this, `at`, or both. */
  rect?: Rect;
  at?: Vec2[];
  /** Tile ids to use instead of the kind's default, cycled in place order. */
  tiles?: number[];
  /** `counter`/`bar`: which side the staff stands on. Default "top". */
  behind?: Side;
  /** `stage`: which side the riser's front face shows on. Default "bottom". */
  front?: Side;
  /** `island`: the side the staff get in by. Without one the loop is closed. */
  open?: Side;
  /** `island`: how wide that way in is, in tiles. Default 1. */
  gap?: number;
  /**
   * Ring this rectangle — or this earlier prop, by its index in `props` — with
   * one of these per tile, on every cell that faces something solid in it. A
   * counter gets its stools, a firepit gets its seats, and neither has to be
   * placed by hand.
   */
  around?: number | Rect;
  /** What the player reads here. One page per entry, like a sign anywhere. */
  lines?: string[];
  /** `exit` only: the way out this cuts, exactly as world.json states one. */
  to?: string;
  id?: string;
  spawn?: Vec2;
  facing?: Facing;
}

export interface RoomSpec {
  /** The map's name in world.json — the place, not the room. */
  name: string;
  size: Vec2;
  door: { side?: Side; column: number; width?: number };
  exit: { id: string; to: string; spawn: Vec2; facing: Facing };
  wall?: number;
  floor?: number[];
  props?: RoomProp[];
  /** People who belong to this room, passed straight to the map's stanza. */
  people?: Person[];
  /** Engine-drawn fixtures in it, likewise. */
  fixtures?: Fixture[];
}

/**
 * Which tile id stands for what, per kind. `buildRoom` takes this rather than a
 * tileset so it can be tested on its own; the script fills it in from the
 * world's tileset (`paletteOf`).
 */
export interface RoomPalette {
  wall: number;
  floor: number[];
  mat: number;
  counter: number;
  bar: number;
  shelf: number[];
  table: number;
  stool: number;
  foosball: number;
  stage: number;
  stageFront: number;
  planter: number;
  sign: number;
  firepit: number;
  door: number;
  panel: number;
}

export interface Room {
  width: number;
  height: number;
  /** Row-major tile *ids* (not gids). Every cell is filled. */
  tiles: number[];
  /** The layer over it: furniture that stands on the floor. `null` is empty. */
  props: (number | null)[];
  /** The spawn tile inside the room — the building placement's `enter`. */
  enter: Vec2;
  /** The `maps.<id>` stanza for world.json. */
  meta: MapMeta;
}

/**
 * Which kinds block the player. Solidity really lives on the tileset, but the
 * room checks below (is the staff strip sealed? can the player reach the whole
 * floor?) have to run inside the pure function, and every world's furniture of
 * these kinds is solid — that is what makes it furniture.
 */
const SOLID_KINDS: Record<PropKind, boolean> = {
  counter: true,
  bar: true,
  island: true,
  shelf: true,
  table: true,
  stool: true,
  foosball: true,
  stage: true,
  mat: false,
  planter: true,
  sign: true,
  firepit: true,
  hall: false,
  door: true,
  panel: true,
  exit: false
};

/** A tile id the world's tileset does not have. Reported when a prop asks for it. */
const MISSING = -1;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const STEP: Record<Side, Vec2> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

// --- spec -> grid ------------------------------------------------------------

export class RoomError extends Error {}

/**
 * A room from a spec. Throws `RoomError` with a readable message on anything
 * that would make an unplayable room: furniture in the wall, a door with no
 * way in, a staff strip that isn't sealed, floor the player can't reach.
 */
export function buildRoom(spec: RoomSpec, palette: RoomPalette): Room {
  const [width, height] = spec.size;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 5 || height < 5) {
    throw new RoomError(`size is ${width}×${height}; a room needs to be at least 5×5 including its walls`);
  }

  const need = (id: number, kind: string) => {
    if (id === MISSING) throw new RoomError(`the world's tileset has no "${kind}" tile to build that with`);
    return id;
  };
  const wall = need(spec.wall ?? palette.wall, 'wall');
  const floor = spec.floor ?? palette.floor;
  if (!floor.length) throw new RoomError('the room has no floor tiles');

  const tiles: number[] = new Array(width * height);
  const props: (number | null)[] = new Array(width * height).fill(null);
  const at = (x: number, y: number) => y * width + x;
  const onWall = (x: number, y: number) => x === 0 || y === 0 || x === width - 1 || y === height - 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[at(x, y)] = onWall(x, y) ? wall : floorAt(floor, x, y);
    }
  }

  // --- the door: a gap in one wall, matted, with the spawn tile just inside.
  const side = spec.door.side ?? 'bottom';
  if (!(side in STEP)) throw new RoomError(`door side "${side}" is not one of top, bottom, left, right`);
  const span = spec.door.width ?? 2;
  const along = spec.door.column;
  const alongMax = (side === 'top' || side === 'bottom' ? width : height) - 1;
  if (span < 1) throw new RoomError('the door is less than one tile wide');
  if (along < 1 || along + span > alongMax) {
    throw new RoomError(
      `the door runs from ${along} to ${along + span - 1} along a ${alongMax + 1}-tile wall — it would cut the corner`
    );
  }

  const gap: Vec2[] = [];
  for (let i = 0; i < span; i++) {
    gap.push(
      side === 'bottom'
        ? [along + i, height - 1]
        : side === 'top'
          ? [along + i, 0]
          : side === 'left'
            ? [0, along + i]
            : [width - 1, along + i]
    );
  }
  for (const [x, y] of gap) tiles[at(x, y)] = need(palette.mat, 'mat');
  // Every cell of the outer wall the player may walk through: the doorway
  // here, and any `exit` a prop cuts below.
  const doorway = new Set<number>(gap.map(([x, y]) => at(x, y)));

  const inward = STEP[OPPOSITE[side]];
  const enter: Vec2 = [gap[0][0] + inward[0], gap[0][1] + inward[1]];
  const trigger: Rect =
    side === 'bottom' || side === 'top'
      ? [gap[0][0], gap[0][1], span, 1]
      : [gap[0][0], gap[0][1], 1, span];

  // --- the furniture, in spec order: a later prop paints over an earlier one.
  const solid = new Set<number>();
  const staff = new Set<number>();
  const signs: MapSign[] = [];
  const extraExits: MapExit[] = [];
  /** Every prop's cells, so a later one can be placed `around` an earlier one. */
  const placed: Vec2[][] = [];

  for (const [index, prop] of (spec.props ?? []).entries()) {
    const where = `prop ${index} ("${prop.kind}")`;
    if (!(PROP_KINDS as readonly string[]).includes(prop.kind)) {
      throw new RoomError(`${where}: unknown kind — expected one of ${PROP_KINDS.join(', ')}`);
    }
    const onTheWall = WALL_KINDS.includes(prop.kind);
    const cells = prop.kind === 'stool' && prop.around !== undefined ? [] : cellsOf(prop, where);
    for (const [x, y] of cells) {
      if (onTheWall) {
        if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
          throw new RoomError(`${where} covers ${x},${y}, which is outside the room`);
        }
        if (tiles[at(x, y)] !== wall) {
          throw new RoomError(`${where} covers ${x},${y}, which is not a wall — a ${prop.kind} goes in one`);
        }
        if (prop.kind === 'exit' && !onWall(x, y)) {
          throw new RoomError(`${where} covers ${x},${y}, an inside wall — a way out has to be in an outside one`);
        }
        continue;
      }
      if (x < 1 || y < 1 || x > width - 2 || y > height - 2) {
        throw new RoomError(`${where} covers ${x},${y}, which is the wall or outside the room`);
      }
      if (gap.some(([gx, gy]) => gx === x && gy === y)) {
        throw new RoomError(`${where} covers the doorway at ${x},${y}`);
      }
    }

    const paint = (cell: Vec2, tile: number, isSolid: boolean) => {
      const i = at(cell[0], cell[1]);
      if (OVER_FLOOR.includes(prop.kind)) props[i] = tile;
      else tiles[i] = tile;
      if (isSolid) solid.add(i);
      else solid.delete(i);
    };

    if (prop.kind === 'counter' || prop.kind === 'bar') {
      const run = prop.tiles ?? [need(prop.kind === 'bar' ? palette.bar : palette.counter, 'counter')];
      cells.forEach((cell, i) => paint(cell, run[i % run.length], true));
      sealStrip(prop, cells, run[0], where);
    } else if (prop.kind === 'island') {
      island(prop, where, need(prop.tiles?.[0] ?? palette.bar, 'counter'), paint);
    } else if (prop.kind === 'hall') {
      corridor(prop, cells, where, paint);
    } else if (prop.kind === 'stage') {
      const body = prop.tiles?.[0] ?? need(palette.stage, 'stage');
      const nose = prop.tiles?.[1] ?? prop.tiles?.[0] ?? need(palette.stageFront, 'stage');
      const edgeOf = edgeCells(cells, prop.front ?? 'bottom', where);
      for (const cell of cells) {
        paint(cell, edgeOf.has(`${cell[0]},${cell[1]}`) ? nose : body, true);
      }
    } else if (prop.kind === 'exit') {
      const run = prop.tiles ?? [need(palette.mat, 'mat')];
      cells.forEach((cell, i) => paint(cell, run[i % run.length], false));
      for (const [x, y] of cells) doorway.add(at(x, y));
      extraExits.push(wayOut(prop, cells, where));
    } else {
      if (prop.kind === 'stool' && prop.around !== undefined) {
        cells.push(...ring(prop.around, index, placed, where));
      }
      const run = prop.tiles ?? defaultTiles(prop.kind, palette, need);
      if (!run.length) throw new RoomError(`${where}: no tile to place it with`);
      cells.forEach((cell, i) => paint(cell, run[i % run.length], SOLID_KINDS[prop.kind]));
    }

    placed.push(cells);
    if (prop.lines?.length) {
      if (!cells.length) throw new RoomError(`${where}: has lines to read but covers no tile`);
      const middle = cells[Math.floor(cells.length / 2)];
      signs.push({ pos: [middle[0], middle[1]], lines: [...prop.lines] });
    }
  }

  /**
   * A counter that closes on itself, with the staff strip inside it: the
   * customers stand all the way round the outside and whoever is working has
   * a walkway of their own in the middle. `open` leaves a way in on one side —
   * the flap in a real bar — and without one the loop is sealed and the strip
   * is somewhere only an NPC placed there can ever be.
   */
  function island(prop: RoomProp, where: string, tile: number, paint: (cell: Vec2, tile: number, isSolid: boolean) => void): void {
    if (!prop.rect) throw new RoomError(`${where}: an island needs a "rect" — it is a loop, not a list of tiles`);
    const [rx, ry, rw, rh] = prop.rect;
    if (rw < 3 || rh < 3) {
      throw new RoomError(`${where}: its rect is ${rw}×${rh}; an island needs at least 3×3 to have an inside`);
    }
    const edge = (x: number, y: number) => x === rx || y === ry || x === rx + rw - 1 || y === ry + rh - 1;

    let mouth: Vec2[] = [];
    if (prop.open) {
      if (!(prop.open in STEP)) {
        throw new RoomError(`${where}: "open" is "${prop.open}", not one of top, bottom, left, right`);
      }
      const span = prop.gap ?? 1;
      const along = prop.open === 'top' || prop.open === 'bottom' ? rw : rh;
      if (span < 1 || span > along - 2) {
        throw new RoomError(`${where}: a ${span}-tile way in does not fit in a ${along}-tile side without cutting a corner`);
      }
      const start = Math.floor((along - span) / 2);
      for (let i = 0; i < span; i++) {
        mouth.push(
          prop.open === 'top'
            ? [rx + start + i, ry]
            : prop.open === 'bottom'
              ? [rx + start + i, ry + rh - 1]
              : prop.open === 'left'
                ? [rx, ry + start + i]
                : [rx + rw - 1, ry + start + i]
        );
      }
    }
    const isMouth = (x: number, y: number) => mouth.some(([mx, my]) => mx === x && my === y);

    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        if (edge(x, y) && !isMouth(x, y)) paint([x, y], tile, true);
        else if (!prop.open) staff.add(at(x, y));
      }
    }
  }

  /**
   * A corridor cut off the room: a run of floor with a wall down each of its
   * long sides, open at both ends. What makes a hallway a hallway is the two
   * walls, and drawing them is the whole job — the room's own outer wall caps
   * whichever end reaches it.
   */
  function corridor(prop: RoomProp, cells: Vec2[], where: string, paint: (cell: Vec2, tile: number, isSolid: boolean) => void): void {
    if (!prop.rect) throw new RoomError(`${where}: a hall needs a "rect" — it is a run, not a list of tiles`);
    const [rx, ry, rw, rh] = prop.rect;
    for (const [x, y] of cells) paint([x, y], prop.tiles?.[0] ?? floorAt(floor, x, y), false);
    const sides: Vec2[] = [];
    if (rw >= rh) {
      for (let x = rx; x < rx + rw; x++) sides.push([x, ry - 1], [x, ry + rh]);
    } else {
      for (let y = ry; y < ry + rh; y++) sides.push([rx - 1, y], [rx + rw, y]);
    }
    for (const [x, y] of sides) {
      if (x < 1 || y < 1 || x > width - 2 || y > height - 2) continue;
      if (doorway.has(at(x, y))) {
        throw new RoomError(`${where}: its wall would land on the doorway at ${x},${y}`);
      }
      tiles[at(x, y)] = wall;
      solid.add(at(x, y));
    }
  }

  /** An `exit` prop's way out, in the same shape world.json states one in. */
  function wayOut(prop: RoomProp, cells: Vec2[], where: string): MapExit {
    if (!prop.id || !prop.to || !prop.spawn || !prop.facing) {
      throw new RoomError(`${where}: a way out needs an "id", a "to", a "spawn" and a "facing"`);
    }
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return {
      id: prop.id,
      at: [x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1],
      to: prop.to,
      spawn: [prop.spawn[0], prop.spawn[1]],
      facing: prop.facing,
      style: 'door'
    };
  }

  /**
   * The cells that face something solid in `what` from one tile outside it —
   * where a stool goes when the spec says to ring a counter or a fire with
   * them. Corners are left out (nothing is solid straight through a corner)
   * and so is anything already taken, so a ring never lands in a wall, on the
   * doormat or on top of the furniture it is meant to serve.
   */
  function ring(what: number | Rect, index: number, placed: Vec2[][], where: string): Vec2[] {
    let rect: Rect;
    if (typeof what === 'number') {
      if (!Number.isInteger(what) || what < 0 || what >= index) {
        throw new RoomError(`${where}: "around" is prop ${what}, which is not one of the props before it`);
      }
      const cells = placed[what];
      if (!cells.length) throw new RoomError(`${where}: prop ${what} covers no tile to go around`);
      const xs = cells.map(([x]) => x);
      const ys = cells.map(([, y]) => y);
      rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
    } else {
      rect = what;
    }
    const [rx, ry, rw, rh] = rect;
    const candidates: Vec2[] = [];
    for (let x = rx; x < rx + rw; x++) candidates.push([x, ry - 1], [x, ry + rh]);
    for (let y = ry; y < ry + rh; y++) candidates.push([rx - 1, y], [rx + rw, y]);

    const inside = (x: number, y: number) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;
    return candidates.filter(([x, y]) => {
      if (x < 1 || y < 1 || x > width - 2 || y > height - 2) return false;
      if (solid.has(at(x, y)) || staff.has(at(x, y)) || doorway.has(at(x, y))) return false;
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(
        ([nx, ny]) => inside(nx, ny) && solid.has(at(nx, ny))
      );
    });
  }

  /**
   * The pocket behind a counter, closed off so an NPC standing in it stays in
   * it: every cell around the strip that isn't the counter run, the strip
   * itself or the outer wall becomes another counter tile — the short returns
   * at the ends of Stewart's register counter, drawn for you.
   */
  function sealStrip(prop: RoomProp, cells: Vec2[], tile: number, where: string): void {
    const behind = prop.behind ?? 'top';
    if (!(behind in STEP)) throw new RoomError(`${where}: "behind" is "${behind}", not one of top, bottom, left, right`);
    const [dx, dy] = STEP[behind];
    const run = new Set(cells.map(([x, y]) => at(x, y)));
    const strip: Vec2[] = [];
    for (const [x, y] of cells) {
      const cell: Vec2 = [x + dx, y + dy];
      if (run.has(at(cell[0], cell[1]))) continue;
      if (cell[0] < 1 || cell[1] < 1 || cell[0] > width - 2 || cell[1] > height - 2) {
        throw new RoomError(`${where}: the staff strip behind it at ${cell} is in the wall — move the run in a tile`);
      }
      strip.push(cell);
    }
    const inStrip = new Set(strip.map(([x, y]) => at(x, y)));
    for (const [x, y] of strip) {
      staff.add(at(x, y));
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as Vec2[]) {
        const i = at(nx, ny);
        if (inStrip.has(i) || run.has(i) || onWall(nx, ny)) continue;
        tiles[i] = tile;
        solid.add(i);
      }
    }
  }

  // --- the checks that keep a generated room playable.
  if (solid.has(at(enter[0], enter[1]))) {
    throw new RoomError(`the spawn tile ${enter} is blocked by furniture — the player would arrive inside it`);
  }

  const walkable = (x: number, y: number) =>
    doorway.has(at(x, y)) || (!onWall(x, y) && !solid.has(at(x, y)));
  const reached = flood(enter, width, height, walkable);
  for (const i of staff) {
    if (reached.has(i)) {
      throw new RoomError(
        `the staff strip at ${i % width},${Math.floor(i / width)} is open to the room — an NPC there would wander out`
      );
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = at(x, y);
      if (solid.has(i) || staff.has(i) || reached.has(i)) continue;
      throw new RoomError(`the floor at ${x},${y} is walled off from the door — nobody can get to it`);
    }
  }

  for (const person of spec.people ?? []) {
    const [x, y] = person.pos;
    if (x < 1 || y < 1 || x > width - 2 || y > height - 2 || solid.has(at(x, y))) {
      throw new RoomError(`person "${person.id}" stands at ${person.pos}, where nobody can stand`);
    }
  }
  for (const fixture of spec.fixtures ?? []) {
    const [x, y] = fixture.pos;
    if (x < 1 || y < 1 || x > width - 2 || y > height - 2 || solid.has(at(x, y)) || staff.has(at(x, y))) {
      throw new RoomError(`the ${fixture.kind} at ${fixture.pos} is in the wall, the furniture or somewhere nobody can reach`);
    }
  }

  const exit: MapExit = {
    id: spec.exit.id,
    at: trigger,
    to: spec.exit.to,
    spawn: [spec.exit.spawn[0], spec.exit.spawn[1]],
    facing: spec.exit.facing,
    style: 'door'
  };

  // The way the player came in stays first: it is the way out, and every
  // caller from the playtest down reads `exits[0]` as that.
  const meta: MapMeta = {
    name: spec.name,
    kind: 'interior',
    buildings: [],
    labels: [],
    exits: [exit, ...extraExits]
  };
  if (spec.fixtures?.length) meta.fixtures = spec.fixtures.map((one) => ({ ...one }));
  if (signs.length) meta.signs = signs;
  if (spec.people?.length) meta.people = spec.people.map((one) => ({ ...one }));

  return { width, height, tiles, props, enter, meta };
}

/** A prop's cells, from its rect and its list, in a fixed order. */
function cellsOf(prop: RoomProp, where: string): Vec2[] {
  const out: Vec2[] = [];
  if (prop.rect) {
    const [x, y, w, h] = prop.rect;
    if (w < 1 || h < 1) throw new RoomError(`${where}: its rect is ${w}×${h} tiles`);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j]);
  }
  for (const cell of prop.at ?? []) out.push([cell[0], cell[1]]);
  if (!out.length) throw new RoomError(`${where}: needs a "rect", an "at" or an "around"`);
  return out;
}

/** The near row (or column) of a block of cells, on the given side. */
function edgeCells(cells: Vec2[], side: Side, where: string): Set<string> {
  if (!(side in STEP)) throw new RoomError(`${where}: "front" is "${side}", not one of top, bottom, left, right`);
  const pick =
    side === 'bottom'
      ? Math.max(...cells.map(([, y]) => y))
      : side === 'top'
        ? Math.min(...cells.map(([, y]) => y))
        : side === 'right'
          ? Math.max(...cells.map(([x]) => x))
          : Math.min(...cells.map(([x]) => x));
  const axis = side === 'bottom' || side === 'top' ? 1 : 0;
  return new Set(cells.filter((cell) => cell[axis] === pick).map((cell) => `${cell[0]},${cell[1]}`));
}

/** The tile ids a prop kind falls back to when the spec names none. */
function defaultTiles(kind: PropKind, palette: RoomPalette, need: (id: number, kind: string) => number): number[] {
  if (kind === 'shelf') return palette.shelf;
  if (kind === 'table') return [need(palette.table, 'table')];
  if (kind === 'stool') return [need(palette.stool, 'stool')];
  if (kind === 'foosball') return [need(palette.foosball, 'foosball')];
  if (kind === 'mat') return [need(palette.mat, 'mat')];
  if (kind === 'planter') return [need(palette.planter, 'planter')];
  if (kind === 'firepit') return [need(palette.firepit, 'firepit')];
  if (kind === 'door') return [need(palette.door, 'door')];
  if (kind === 'panel') return [need(palette.panel, 'panel')];
  return [need(palette.sign, 'board')];
}

/**
 * A fixed scatter of the floor tiles, so a plain room isn't a checkerboard and
 * isn't random either: the same cell always gets the same tile, which is what
 * makes re-running the script a no-op.
 */
function floorAt(floor: number[], x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return floor[((h >>> 16) & 0x7fff) % floor.length];
}

/** Every cell reachable on foot from `from`, four-way. */
function flood(from: Vec2, width: number, height: number, open: (x: number, y: number) => boolean): Set<number> {
  const seen = new Set<number>();
  const queue: Vec2[] = [from];
  seen.add(from[1] * width + from[0]);
  while (queue.length) {
    const [x, y] = queue.shift() as Vec2;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as Vec2[]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const i = ny * width + nx;
      if (seen.has(i) || !open(nx, ny)) continue;
      seen.add(i);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

// --- the Tiled file ----------------------------------------------------------

/**
 * The room as a Tiled map file, laid out exactly like a hand-authored one
 * (DESIGN.md §2): orthogonal, finite, one uncompressed `ground` layer, the
 * tileset by reference. Written with the data one map row per line, which is
 * the only thing here Tiled would reformat if it ever saves the file.
 */
/**
 * The room as a Tiled map file, laid out exactly like a hand-authored one
 * (DESIGN.md §2): orthogonal, finite, uncompressed layers, the tileset by
 * reference. There are two tile layers where the room has furniture standing
 * on its floor — `ground` for the room itself and `props` over it — because a
 * table or a stool is drawn as a shape in the top of its cell with nothing
 * behind it, and it wants the floor behind it rather than a hole. Written with
 * the data one map row per line, which is the only thing here Tiled would
 * reformat if it ever saves the file.
 */
export function tiledMap(room: Room, tilesetSource: string, firstgid = 1): string {
  const layer = (name: string, id: number, cells: (number | null)[]): string => {
    const rows: string[] = [];
    for (let y = 0; y < room.height; y++) {
      const row = cells.slice(y * room.width, (y + 1) * room.width).map((tile) => (tile === null ? 0 : tile + firstgid));
      rows.push(`        ${row.join(', ')}`);
    }
    return `    {
      "data": [
${rows.join(',\n')}
      ],
      "height": ${room.height},
      "id": ${id},
      "name": "${name}",
      "opacity": 1,
      "type": "tilelayer",
      "visible": true,
      "width": ${room.width},
      "x": 0,
      "y": 0
    }`;
  };

  // The second layer only exists where something stands on the floor, so a
  // room with none is byte-for-byte the file it was before there were two.
  const layers = [layer('ground', 1, room.tiles)];
  if (room.props.some((tile) => tile !== null)) layers.push(layer('props', 2, room.props));

  return `{
  "compressionlevel": -1,
  "height": ${room.height},
  "infinite": false,
  "layers": [
${layers.join(',\n')}
  ],
  "nextlayerid": ${layers.length + 1},
  "nextobjectid": 1,
  "orientation": "orthogonal",
  "renderorder": "right-down",
  "tiledversion": "1.10.2",
  "tileheight": 16,
  "tilesets": [
    {
      "firstgid": ${firstgid},
      "source": "${tilesetSource}"
    }
  ],
  "tilewidth": 16,
  "type": "map",
  "version": "1.10",
  "width": ${room.width}
}
`;
}

/**
 * The furniture a world's own tileset offers, by tile kind. A world with no
 * tile of some kind simply cannot use that prop, and says so when a spec asks
 * for one (CLAUDE.md hard rule 3: the engine never invents content).
 */
export function paletteOf(tileset: TilesetDef): RoomPalette {
  const ofKind = (kind: string) =>
    [...tileset.tiles.values()].filter((tile) => tile.kind === kind).sort((a, b) => a.id - b.id);
  const first = (kind: string) => ofKind(kind)[0]?.id ?? MISSING;
  const many = (kind: string) => ofKind(kind).map((tile) => tile.id);
  // A raised surface's near row is the one that carries a front face (`edge`),
  // which is how the tileset already tells the two deck tiles apart.
  const stage = ofKind('stage');
  const flat = stage.find((tile) => !tile.edge) ?? stage[0];
  const near = stage.find((tile) => tile.edge) ?? flat;

  return {
    wall: first('wall'),
    floor: many('floor'),
    mat: first('mat'),
    counter: first('counter'),
    bar: first('counter'),
    shelf: many('shelf'),
    table: first('table'),
    stool: first('stool'),
    foosball: first('foosball'),
    stage: flat?.id ?? MISSING,
    stageFront: near?.id ?? MISSING,
    planter: first('planter'),
    sign: first('board'),
    firepit: first('firepit'),
    door: first('door'),
    panel: first('panel')
  };
}

// --- the script --------------------------------------------------------------

function usage(): never {
  console.error(
    'usage: npm run make-room -- <world> <mapId> --spec <file.json|json> [--worlds <dir>] [--tileset <name>] [--stanza <file>]'
  );
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(argv: string[]): void {
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) i++;
    else positional.push(argv[i]);
  }
  const [worldId, mapId] = positional;
  const specArg = flag(argv, '--spec');
  if (!worldId || !mapId || !specArg) usage();

  const worldsRoot = flag(argv, '--worlds') ?? process.env.MAINSTREET_WORLDS_DIR ?? 'worlds';
  const pack = resolve(worldsRoot, worldId);
  const spec: RoomSpec = JSON.parse(specArg.trimStart().startsWith('{') ? specArg : readFileSync(specArg, 'utf8'));

  const tilesDir = join(pack, 'assets', 'tiles');
  const named = flag(argv, '--tileset');
  const sheets = readdirSync(tilesDir).filter((file) => file.endsWith('.json'));
  const sheet = named ? `${named}.json` : sheets[0];
  if (!sheet || (named && !sheets.includes(sheet))) {
    console.error(`✗ ${worldId}: no tileset ${named ?? ''} in ${tilesDir} (found: ${sheets.join(', ') || 'none'})`);
    process.exit(1);
  }
  if (!named && sheets.length > 1) {
    console.error(`✗ ${worldId}: ${sheets.length} tilesets in ${tilesDir} — say which with --tileset <name>`);
    process.exit(1);
  }
  const tileset = parseTileset(JSON.parse(readFileSync(join(tilesDir, sheet), 'utf8')), `${worldId}/${sheet}`);

  let room: Room;
  try {
    room = buildRoom(spec, paletteOf(tileset));
  } catch (error) {
    console.error(`✗ ${worldId}/${mapId}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const mapFile = join(pack, 'maps', `${mapId}.json`);
  writeFileSync(mapFile, tiledMap(room, `../assets/tiles/${sheet}`));

  const stanza = `${JSON.stringify({ [mapId]: room.meta }, null, 2)}\n`;
  const stanzaFile = flag(argv, '--stanza');
  if (stanzaFile) writeFileSync(stanzaFile, stanza);

  console.log(`wrote ${mapFile} (${room.width}×${room.height})`);
  console.log(`\nworld.json "maps" stanza${stanzaFile ? ` (also written to ${stanzaFile})` : ''}:\n`);
  console.log(stanza);
  console.log(`and on the building's placement:  "interior": "${mapId}", "enter": [${room.enter.join(', ')}]`);
}

// Only when run as a script, so the test can import the pure parts.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/make-room.ts')) main(process.argv.slice(2));
