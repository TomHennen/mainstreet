import Phaser from 'phaser';
import { bus, EV } from '../bus';
import type { SayRequest } from '../bus';
import {
  buildingArt,
  characterTexture,
  dashTexture,
  fixtureArt,
  frameIndex,
  itemTexture,
  mapTexture,
  markerTexture,
  namePlateArt,
  plateLift,
  plaqueArt,
  promptTexture,
  TILE
} from '../art';
import { publishDebug } from '../debug';
import { isHeld, onAction, onTap } from '../input';
import { feedbackUrl } from '../feedback';
import { paintUrl } from '../paint';
import { findPath, pathToTile } from '../path';
import { creditFor, dialogueFor, itemVisible, itemsOn, npcsOn, propSignsOn, session, signFor } from '../session';
import { isSolid } from '../validate';
import { plaqueTile } from '../schema';
import type { PlateBox } from '../art';
import type { BuildingPlacement, EpisodeItem, EpisodeSign, Facing, Fixture, GameMap, MapExit, Vec2 } from '../schema';

const SPEED = 102; // px/s — the prototype's 1.7px/frame at 60fps
const HITBOX = TILE;
const MARGIN = 4;
/** A map smaller than the view may be scaled up this far before it looks coarse. */
const MAX_ZOOM = 4;

// Reach in tiles. Interiors are tight, so an NPC behind a counter needs more.
// The plaque is the exception: it is read standing at it, on its own tile, so
// the building's sign keeps the rest of the front to itself.
// A fixture is solid, so unlike the plaque it is read from the tile beside it:
// far enough to take in a diagonal neighbour, not far enough to reach past one.
const REACH = { npcVillage: 2.0, npcInterior: 2.3, item: 2.0, door: 2.2, prop: 2.1, plaque: 0.75, fixture: 1.5 };
/** How long the travel card holds, by what we are walking through. */
const HOLD = { road: 900, enter: 500, exit: 400 };
const WALK_FRAME_MS = 133;

export interface MapSceneData {
  mapId: string;
  pos: Vec2;
  facing: Facing;
  intro?: boolean;
}

interface Target {
  kind: 'npc' | 'item' | 'prop' | 'enter' | 'sign' | 'plaque' | 'fixture';
  at: Vec2;
  npcIndex?: number;
  item?: EpisodeItem;
  sign?: EpisodeSign;
  building?: BuildingPlacement;
  fixture?: Fixture;
}

/**
 * Villages and interiors are the same thing: a tile grid with exits. Giving a
 * building an interior later is a world-data change with no engine change,
 * which is the point of DESIGN.md §2.
 */
export class MapScene extends Phaser.Scene {
  private mapId!: string;
  private map!: GameMap;
  private px = 0;
  private py = 0;
  private facing: Facing = 'down';
  private walkTime = 0;
  private moving = false;

  private player!: Phaser.GameObjects.Sprite;
  private prompt!: Phaser.GameObjects.Image;
  private marker!: Phaser.GameObjects.Image;
  private itemSprites = new Map<string, Phaser.GameObjects.Image>();
  private exitArmed = false;
  private enterArmed = false;
  private spawnX = 0;
  private spawnY = 0;
  private unbindAction: (() => void) | null = null;
  private unbindTap: (() => void) | null = null;

  /** Tiles still to walk, nearest first, while a tapped walk is running. */
  private walkPath: Vec2[] | null = null;
  private walkGoal: Vec2 | null = null;
  /** Whether arriving should read whatever was tapped, as if A had been pressed. */
  private walkReads = false;

  constructor() {
    super('Map');
  }

  init(data: MapSceneData): void {
    this.mapId = data.mapId;
    this.map = session().maps[data.mapId];
    this.px = data.pos[0] * TILE;
    this.py = data.pos[1] * TILE;
    this.spawnX = this.px;
    this.spawnY = this.py;
    this.facing = data.facing;
    this.exitArmed = false;
    this.enterArmed = false;
    this.itemSprites = new Map();
    this.walkPath = null;
    this.walkGoal = null;
    this.walkReads = false;
  }

  create(data: MapSceneData): void {
    const { world, assets } = session();

    this.add.image(0, 0, mapTexture(this, this.mapId, this.map, assets.tilesets)).setOrigin(0, 0).setDepth(-100);

    // Name plates are stacked rather than allowed to overlap, so two
    // storefronts that touch never read as one sign. The list is per map and
    // filled in placement order, which is what makes the stacking stable.
    const plates: PlateBox[] = [];
    for (const placement of this.map.buildings) {
      const def = world.buildings[placement.id];
      const paintedKey = assets.buildings.has(placement.id) ? `art:building:${placement.id}` : null;
      const lift = plateLift(this, placement, def, paintedKey, plates);
      const art = buildingArt(this, placement, def, paintedKey, lift);
      const depth = (placement.pos[1] + placement.size[1]) * TILE;
      this.add.image(art.x, art.y, art.key).setOrigin(0, 0).setDepth(depth);

      // Every building carries its plaque, painted or not: it is the engine's
      // own little fixture, sitting over the facade so no artist has to paint
      // one (DESIGN.md §2/§4).
      const plaque = plaqueArt(this, placement);
      if (plaque) {
        this.add.image(plaque.x, plaque.y, plaque.key).setOrigin(0, 0).setDepth(depth + 2);
      }

      if (art.painted) {
        // The placeholder bakes its name plate into the facade texture itself;
        // a painted PNG has nothing to bake it into, so it gets a plate of its
        // own here (issue #32), unless the placement opts out.
        if (placement.label !== false) {
          const plate = namePlateArt(this, placement, def, art.y, lift);
          this.add.image(plate.x, plate.y, plate.key).setOrigin(0, 0).setDepth(depth + 1);
        }
      } else {
        // "Needs an artist" shimmer — visible, claimable, and deliberate.
        const shimmer = this.add
          .rectangle(
            placement.pos[0] * TILE,
            placement.pos[1] * TILE,
            placement.size[0] * TILE,
            placement.size[1] * TILE,
            0xf3ead8
          )
          .setOrigin(0, 0)
          .setDepth(depth + 1)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setAlpha(0);
        this.tweens.add({
          targets: shimmer,
          alpha: 0.09,
          duration: 2600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    }

    // The engine's own street furniture: drawn on the tile it stands on, at
    // that tile's depth, so the player passes behind it going up the street
    // and in front of it coming down (DESIGN.md §2).
    for (const fixture of this.fixtures()) {
      const art = fixtureArt(this, fixture);
      this.add.image(art.x, art.y, art.key).setOrigin(0, 0).setDepth(art.depth);
    }

    const itemKey = itemTexture(this);
    for (const item of itemsOn(this.mapId)) {
      const sprite = this.add
        .image(item.pos[0] * TILE, item.pos[1] * TILE, itemKey)
        .setOrigin(0, 0)
        .setDepth(item.pos[1] * TILE);
      this.tweens.add({ targets: sprite, y: sprite.y - 3, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.itemSprites.set(item.id, sprite);
    }

    for (const npc of npcsOn(this.mapId)) {
      const key = assets.chars.has(npc.id) ? `art:char:${npc.id}` : characterTexture(this, npc.accent ?? '#7a7a6a');
      const dir = npc.facing ?? 'down';
      this.add
        .sprite(npc.pos[0] * TILE + TILE / 2, npc.pos[1] * TILE + TILE, key, frameIndex(dir, 0))
        .setOrigin(0.5, 1)
        .setDepth(npc.pos[1] * TILE + TILE);
    }

    const playerKey = assets.chars.has(world.player.id)
      ? `art:char:${world.player.id}`
      : characterTexture(this, world.player.accent);
    this.player = this.add.sprite(0, 0, playerKey, frameIndex(this.facing, 0)).setOrigin(0.5, 1);
    this.syncPlayerSprite();

    this.prompt = this.add.image(0, 0, promptTexture(this, 'A')).setOrigin(0.5, 1).setDepth(9000).setVisible(false);
    // Sits under the A prompt and over the town, so a destination behind a
    // porch roof is still findable while the player walks to it.
    this.marker = this.add.image(0, 0, markerTexture(this)).setOrigin(0, 0).setDepth(8500).setVisible(false);
    dashTexture(this); // warm the travel interstitial's texture while we have a scene

    this.applyCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyCamera, this);

    this.unbindAction = onAction(() => this.interact());
    this.unbindTap = onTap((x, y) => this.tap(x, y));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindAction?.();
      this.unbindAction = null;
      this.unbindTap?.();
      this.unbindTap = null;
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyCamera, this);
    });

    const state = session();
    if (data.intro && !state.introShown && state.copy.intro) {
      state.introShown = true;
      bus.emit(EV.say, { speaker: state.copy.intro.speaker, lines: state.copy.intro.lines });
    }
  }

  update(_time: number, delta: number): void {
    const state = session();
    this.armEnters();
    if (import.meta.env.DEV) {
      const view = this.cameras.main.worldView;
      publishDebug({
        map: this.mapId,
        x: this.px / TILE,
        y: this.py / TILE,
        facing: this.facing,
        dialogueOpen: state.dialogueOpen,
        locked: state.locked,
        walkTo: this.walkGoal ? [this.walkGoal[0], this.walkGoal[1]] : null,
        view: { x: view.x, y: view.y, width: view.width, height: view.height, tile: TILE },
        flags: state.flags.snapshot()
      });
    }
    if (state.locked || state.dialogueOpen) {
      // A card or a box means the trip is over: the walk does not pick itself
      // back up behind the player's back once they have read the line.
      this.stopWalk();
      this.moving = false;
      this.player.setFrame(frameIndex(this.facing, 0));
      this.updatePrompt();
      return;
    }

    let dx = 0;
    let dy = 0;
    if (isHeld('up')) dy = -1;
    else if (isHeld('down')) dy = 1;
    if (isHeld('left')) dx = -1;
    else if (isHeld('right')) dx = 1;

    // The d-pad and the movement keys always win: taking hold of a direction
    // calls off a tapped walk on the frame it is seen.
    if (dx !== 0 || dy !== 0) this.stopWalk();

    this.moving = dx !== 0 || dy !== 0;
    if (dx !== 0) this.facing = dx < 0 ? 'left' : 'right';
    else if (dy !== 0) this.facing = dy < 0 ? 'up' : 'down';

    if (this.moving) {
      // Diagonals cover two axes at once, so slow them to the same real speed.
      let step = (SPEED * delta) / 1000;
      if (dx !== 0 && dy !== 0) step /= Math.SQRT2;
      const nx = this.px + dx * step;
      const ny = this.py + dy * step;
      if (dx !== 0 && this.free(nx, this.py)) this.px = nx;
      if (dy !== 0 && this.free(this.px, ny)) this.py = ny;
    } else if (this.walkPath) {
      this.moving = this.followPath((SPEED * delta) / 1000);
    }

    if (this.moving) this.walkTime += delta;
    else this.walkTime = 0;

    this.player.setFrame(frameIndex(this.facing, this.moving ? 1 + (Math.floor(this.walkTime / WALK_FRAME_MS) % 2) : 0));
    this.syncPlayerSprite();
    this.refreshItems();
    this.updatePrompt();
    this.updateMarker();
    this.checkExits();
  }

  /**
   * Coming out of a door drops the player on the doorstep. Offering that door
   * straight back would send the next A press through it, so doors stay silent
   * until half a tile of daylight is between the player and where they landed.
   */
  private armEnters(): void {
    if (this.enterArmed) return;
    if (Math.hypot(this.px - this.spawnX, this.py - this.spawnY) >= TILE / 2) this.enterArmed = true;
  }

  private syncPlayerSprite(): void {
    this.player.setPosition(Math.round(this.px) + TILE / 2, Math.round(this.py) + HITBOX);
    this.player.setDepth(this.py + HITBOX);
  }

  private free(x: number, y: number): boolean {
    const lo = MARGIN;
    const hi = HITBOX - MARGIN;
    return (
      !this.solidPx(x + lo, y + lo) &&
      !this.solidPx(x + hi, y + lo) &&
      !this.solidPx(x + lo, y + hi) &&
      !this.solidPx(x + hi, y + hi)
    );
  }

  private solidPx(x: number, y: number): boolean {
    return this.solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  private fixtures(): Fixture[] {
    return this.map.fixtures ?? [];
  }

  private solidTile(tx: number, ty: number): boolean {
    // isSolid is shared with the validator, which has to be able to ask what
    // the tile under a fixture or an NPC is like, so neither is in there: the
    // player is stopped by them here instead.
    if (isSolid(this.map, tx, ty)) return true;
    if (this.fixtures().some((fixture) => fixture.pos[0] === tx && fixture.pos[1] === ty)) return true;
    return npcsOn(this.mapId).some((npc) => npc.pos[0] === tx && npc.pos[1] === ty);
  }

  private refreshItems(): void {
    for (const item of itemsOn(this.mapId)) {
      this.itemSprites.get(item.id)?.setVisible(itemVisible(item));
    }
  }

  /** Tile-space centre of the player, for reach tests. */
  private centre(): { x: number; y: number } {
    return { x: this.px / TILE + 0.5, y: this.py / TILE + 0.5 };
  }

  private distance(at: Vec2): number {
    const me = this.centre();
    return Math.hypot(me.x - (at[0] + 0.5), me.y - (at[1] + 0.5));
  }

  /**
   * Nearest candidate wins, each kind judged against its own reach. Standing
   * beside somebody must never swallow the door you are walking up to; ties go
   * to people first, then things, then buildings.
   */
  private findTarget(): Target | null {
    let best: Target | null = null;
    let bestDist = Infinity;
    let bestRank = Infinity;

    // `at` is where the bubble floats; `from` is what the reach is measured to.
    const consider = (target: Target, reach: number, rank: number, from: Vec2 = target.at) => {
      const dist = this.distance(from);
      if (dist > reach) return;
      if (dist < bestDist || (dist === bestDist && rank < bestRank)) {
        best = target;
        bestDist = dist;
        bestRank = rank;
      }
    };

    const npcReach = this.map.kind === 'interior' ? REACH.npcInterior : REACH.npcVillage;
    const npcs = npcsOn(this.mapId);
    for (let i = 0; i < npcs.length; i++) {
      consider({ kind: 'npc', at: npcs[i].pos, npcIndex: i }, npcReach, 0);
    }
    for (const item of itemsOn(this.mapId)) {
      if (itemVisible(item)) consider({ kind: 'item', at: item.pos, item }, REACH.item, 1);
    }
    for (const sign of propSignsOn(this.mapId)) {
      if (sign.pos) consider({ kind: 'prop', at: sign.pos, sign }, REACH.prop, 2);
    }
    for (const fixture of this.fixtures()) {
      consider({ kind: 'fixture', at: fixture.pos, fixture }, REACH.fixture, 2);
    }
    for (const building of this.map.buildings) {
      // The plaque is considered first so that standing exactly on the line
      // between it and the door still reads the plaque, as it looks like it
      // should. A building with an interior has one too: its door opens, and
      // the plaque beside it is still where its painter is thanked.
      const plaque = plaqueTile(building);
      if (plaque) {
        consider({ kind: 'plaque', at: [plaque[0], plaque[1] - 1], building }, REACH.plaque, 3, plaque);
      }
      const kind: Target['kind'] = building.interior ? 'enter' : 'sign';
      if (kind === 'enter' && !this.enterArmed) continue;
      consider({ kind, at: [building.door[0], building.door[1] - 1], building }, REACH.door, 3, building.door);
    }
    return best;
  }

  // --- tap to walk -----------------------------------------------------------

  /**
   * A tap or click on the town: walk there. Tapping a person, a door, a plaque,
   * a sign or something lying about walks to where it is read from and reads it
   * on arrival — the same thing A does, without the trip being the player's
   * job. Everything below is engine-level: it asks the map and the episode
   * where things are, never what they are (hard rule 1).
   */
  private tap(clientX: number, clientY: number): void {
    const state = session();
    if (state.locked || state.dialogueOpen) return;

    const tile = this.tileAt(clientX, clientY);
    if (!tile) return;

    const readable = this.readableAt(tile[0], tile[1]);
    const goal = readable?.at ?? tile;
    const start = this.startTile();
    const walkable = this.walkableTo(goal);
    let route = pathToTile(start, goal, walkable);
    if (!route && readable) {
      // Somebody behind a counter has no free tile beside them, and is still
      // perfectly easy to talk to across it. Failing that, stand anywhere the
      // A button would reach them from — the same reach findTarget() uses.
      route = findPath(start, (x, y) => Math.hypot(x - goal[0], y - goal[1]) <= readable.reach, walkable);
    }
    if (!route?.length) {
      this.refuse(tile);
      return;
    }

    this.walkPath = route;
    this.walkGoal = route[route.length - 1];
    this.walkReads = readable !== null;
    this.tweens.killTweensOf(this.marker);
    this.marker.setPosition(this.walkGoal[0] * TILE, this.walkGoal[1] * TILE).setAlpha(1).setVisible(true);
  }

  /** Client pixels to a tile, through the canvas box and the camera. */
  private tileAt(clientX: number, clientY: number): Vec2 | null {
    const rect = this.game.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const { width, height } = this.scale.gameSize;
    const point = this.cameras.main.getWorldPoint((x * width) / rect.width, (y * height) / rect.height);
    return [Math.floor(point.x / TILE), Math.floor(point.y / TILE)];
  }

  /**
   * The tile a walk starts from. The player is rarely tile-aligned, so this is
   * the nearest of the tiles their hitbox is over that they could stand on.
   */
  private startTile(): Vec2 {
    const cx = this.px + TILE / 2;
    const cy = this.py + TILE / 2;
    let best: Vec2 = [Math.round(this.px / TILE), Math.round(this.py / TILE)];
    let bestDist = Infinity;
    for (const ox of [MARGIN, HITBOX - MARGIN]) {
      for (const oy of [MARGIN, HITBOX - MARGIN]) {
        const tx = Math.floor((this.px + ox) / TILE);
        const ty = Math.floor((this.py + oy) / TILE);
        if (this.solidTile(tx, ty)) continue;
        const dist = Math.hypot(cx - (tx * TILE + TILE / 2), cy - (ty * TILE + TILE / 2));
        if (dist < bestDist) {
          bestDist = dist;
          best = [tx, ty];
        }
      }
    }
    return best;
  }

  /**
   * What a route may cross. Solid tiles and people are out, and so are the
   * exits: walking over one is a trip to the next village, and a tap on this
   * side of town never asked for that. The tapped tile itself is always fair
   * game, which is how a tap on the road out still takes it.
   */
  private walkableTo(goal: Vec2): (x: number, y: number) => boolean {
    return (x, y) => {
      if (this.solidTile(x, y)) return false;
      if (x === goal[0] && y === goal[1]) return true;
      return !this.exitAt(x, y);
    };
  }

  private exitAt(x: number, y: number): MapExit | undefined {
    return this.map.exits.find(
      (exit) => x >= exit.at[0] && x < exit.at[0] + exit.at[2] && y >= exit.at[1] && y < exit.at[1] + exit.at[3]
    );
  }

  /**
   * What the player tapped, if it was something readable, and the tile the
   * reading is done from. Order matches findTarget()'s: people, then things,
   * then buildings. People are drawn two tiles tall, so their head counts as
   * them; a building answers for its door tile, the doorway above it, and its
   * plaque.
   */
  private readableAt(tx: number, ty: number): { at: Vec2; reach: number } | null {
    const npcReach = this.map.kind === 'interior' ? REACH.npcInterior : REACH.npcVillage;
    for (const npc of npcsOn(this.mapId)) {
      if (npc.pos[0] === tx && (npc.pos[1] === ty || npc.pos[1] - 1 === ty)) return { at: npc.pos, reach: npcReach };
    }
    for (const item of itemsOn(this.mapId)) {
      if (itemVisible(item) && item.pos[0] === tx && item.pos[1] === ty) return { at: item.pos, reach: REACH.item };
    }
    for (const sign of propSignsOn(this.mapId)) {
      if (sign.pos && sign.pos[0] === tx && sign.pos[1] === ty) return { at: sign.pos, reach: REACH.prop };
    }
    for (const building of this.map.buildings) {
      const plaque = plaqueTile(building);
      if (plaque && plaque[0] === tx && plaque[1] === ty) return { at: plaque, reach: REACH.plaque };
      if (building.door[0] === tx && (building.door[1] === ty || building.door[1] - 1 === ty)) {
        return { at: building.door, reach: REACH.door };
      }
    }
    return null;
  }

  /**
   * Walks the route with the same step and the same speed as a held direction,
   * so a tapped walk and a d-pad walk look like the same walk. Returns whether
   * the player moved this frame.
   */
  private followPath(budget: number): boolean {
    const path = this.walkPath;
    if (!path) return false;
    let moved = false;

    while (budget > 0.0001 && path.length) {
      const [tx, ty] = path[0];
      const gx = tx * TILE;
      const gy = ty * TILE;
      const dx = gx - this.px;
      const dy = gy - this.py;
      const len = Math.hypot(dx, dy);
      if (len < 0.0001) {
        path.shift();
        continue;
      }

      // The facing turns with the leg being walked, exactly as it does under a
      // thumb — including the little sidestep onto the first tile.
      if (Math.abs(dx) >= Math.abs(dy)) this.facing = dx < 0 ? 'left' : 'right';
      else this.facing = dy < 0 ? 'up' : 'down';

      const use = Math.min(budget, len);
      const nx = this.px + (dx / len) * use;
      const ny = this.py + (dy / len) * use;
      if (!this.free(nx, ny)) {
        // Somebody stepped into the route after it was found. Stop rather than
        // lean on them.
        this.stopWalk();
        return moved;
      }
      this.px = nx;
      this.py = ny;
      budget -= use;
      moved = true;
      if (use >= len - 0.0001) {
        this.px = gx;
        this.py = gy;
        path.shift();
      }
    }

    if (!path.length) {
      const reads = this.walkReads;
      this.stopWalk();
      // The arrival press, once. interact() is guarded against firing mid-walk,
      // so this is the only place a tapped walk ever reads anything.
      if (reads) this.interact();
    }
    return moved;
  }

  private stopWalk(): void {
    this.walkPath = null;
    this.walkGoal = null;
    this.walkReads = false;
    this.marker.setVisible(false);
  }

  /** Nowhere to go: the marker blinks once where the tap landed and fades. */
  private refuse(tile: Vec2): void {
    this.tweens.killTweensOf(this.marker);
    this.marker.setPosition(tile[0] * TILE, tile[1] * TILE).setAlpha(0.85).setVisible(true);
    this.tweens.add({
      targets: this.marker,
      alpha: 0,
      duration: 320,
      onComplete: () => {
        if (!this.walkPath) this.marker.setVisible(false);
      }
    });
  }

  private updateMarker(): void {
    if (!this.walkPath) return;
    this.marker.setAlpha(0.72 + Math.sin(this.time.now / 190) * 0.28);
  }

  private updatePrompt(): void {
    const state = session();
    if (state.dialogueOpen || state.locked) {
      this.prompt.setVisible(false);
      return;
    }
    const target = this.findTarget();
    // Props are found by looking, not by a bubble: the room stays uncluttered.
    if (!target || target.kind === 'prop') {
      this.prompt.setVisible(false);
      return;
    }
    const glyph = target.kind === 'enter' ? '⌂' : 'A';
    const bob = Math.sin(this.time.now / 167) * 1.5;
    // People are two tiles tall and stand on the tile they occupy, so their
    // head fills the tile above it; props and doors sit inside their own tile.
    const lift = target.kind === 'npc' ? TILE : 0;
    this.prompt.setTexture(promptTexture(this, glyph));
    this.prompt.setPosition(target.at[0] * TILE + TILE / 2, target.at[1] * TILE - 2 - lift + bob);
    this.prompt.setVisible(true);
  }

  private interact(): void {
    const state = session();
    // The dialogue overlay owns the action button while it is open, and for a
    // beat after it closes, so dismissing a line can never re-trigger a talk.
    if (state.locked || state.dialogueOpen || performance.now() - state.lastDialogueClose < 200) return;
    // A tapped walk is a promise to arrive. A press part-way there would either
    // strand the player or strike up a conversation with somebody they were
    // only walking past, so A waits until the walk is done — and the walk
    // presses A itself if the tap was on something to read.
    if (this.walkPath) return;

    const target = this.findTarget();
    if (!target) return;

    if (target.kind === 'npc') {
      const npc = npcsOn(this.mapId)[target.npcIndex ?? 0];
      const entry = dialogueFor(npc);
      if (!entry) return;
      bus.emit(EV.say, {
        speaker: npc.name,
        lines: entry.lines,
        effects: entry.effects,
        portrait: state.assets.portraits.has(npc.id) ? `art:portrait:${npc.id}` : undefined
      });
      return;
    }

    if (target.kind === 'item' && target.item) {
      bus.emit(EV.say, {
        speaker: state.copy.ui.narrator,
        lines: target.item.lines,
        effects: target.item.effects
      });
      return;
    }

    if (target.kind === 'prop' && target.sign) {
      bus.emit(EV.say, { speaker: state.copy.ui.narrator, lines: target.sign.lines });
      return;
    }

    if (target.kind === 'fixture' && target.fixture) {
      // The one thing in town that is the game talking to the player about the
      // game. Every word of it is world copy; the engine only knows there is a
      // box here, and where the world said to write (DESIGN.md §2).
      const suggest = state.copy.ui.suggest;
      if (!suggest?.lines.length) return;
      const url = feedbackUrl(state.world.feedback, suggest.body);
      const link = url && suggest.link ? { url, label: suggest.link } : undefined;
      bus.emit(EV.say, { speaker: state.copy.ui.narrator, lines: suggest.lines, link });
      return;
    }

    if (target.kind === 'plaque' && target.building) {
      const building = target.building;
      const name = state.world.buildings[building.id].name;
      const painted = state.assets.buildings.has(building.id);
      const credit = creditFor(building.id);
      const plaque = state.copy.ui.plaque;
      let link: SayRequest['link'];

      // The one place in the game that talks about the art, so the sign box
      // can stay entirely story (DESIGN.md §2/§4). A painted building thanks
      // whoever painted it; an unpainted one asks, with the way in riding
      // alongside every page rather than taking a line of its own.
      let template = painted ? (credit ? plaque?.painted : plaque?.anonymous) : plaque?.unpainted;
      if (!painted) {
        const url = paintUrl(state.world.contribute, building.id);
        if (url && state.copy.ui.paint) link = { url, label: state.copy.ui.paint };
      }
      if (!template) return;

      template = template.replace(/\{building\}/g, name).replace(/\{credit\}/g, credit ?? '');
      bus.emit(EV.say, { speaker: name, lines: [template], link });
      return;
    }

    if (target.kind === 'sign' && target.building) {
      const building = target.building;
      const sign = signFor(building.id);
      const name = state.world.buildings[building.id].name;
      const lines = sign ? [...sign.lines] : [];

      // Nothing about the art joins the words: a sign says what is going on at
      // a place, and meta text in the middle of it gets in the way of reading
      // (DESIGN.md §2/§4). Thanks and invitation both live on the plaque
      // beside the door, so the sign carries no link at all.
      if (!lines.length && !state.assets.buildings.has(building.id)) {
        // With no sign copy this episode the box would open empty, so one
        // short, kind line stands in for it.
        lines.push(
          state.copy.ui.unpainted.replace('{building}', name).replace('{contribute}', state.world.contribute ?? '')
        );
      }

      if (lines.length) bus.emit(EV.say, { speaker: name, lines });
      return;
    }

    if (target.kind === 'enter' && target.building?.interior && target.building.enter) {
      this.leave({
        style: 'door',
        hold: HOLD.enter,
        copyKey: `enter:${target.building.id}`,
        to: target.building.interior,
        spawn: target.building.enter,
        facing: 'up'
      });
    }
  }

  private checkExits(): void {
    const tx = Math.floor((this.px + TILE / 2) / TILE);
    const ty = Math.floor((this.py + TILE / 2) / TILE);
    const on = this.exitAt(tx, ty);

    // Arriving on top of an exit must not immediately bounce back through it.
    if (!on) {
      this.exitArmed = true;
      return;
    }
    if (!this.exitArmed) return;

    this.leave({
      style: on.style,
      hold: on.style === 'road' ? HOLD.road : HOLD.exit,
      copyKey: on.id,
      to: on.to,
      spawn: on.spawn,
      facing: on.facing
    });
  }

  private leave(opts: {
    style: 'road' | 'door';
    hold: number;
    copyKey: string;
    to: string;
    spawn: Vec2;
    facing: Facing;
  }): void {
    const state = session();
    state.locked = true;
    const copy = state.copy.transitions[opts.copyKey] ?? { big: state.world.maps[opts.to].name.toUpperCase() };
    this.scene.launch('Travel', {
      style: opts.style,
      hold: opts.hold,
      big: copy.big,
      small: copy.small ?? '',
      to: opts.to,
      spawn: opts.spawn,
      facing: opts.facing
    });
  }

  private applyCamera(): void {
    const camera = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    let zoom = Math.max(2, Math.floor(Math.min(width / (17 * TILE), height / (13 * TILE))));

    const mapW = this.map.width * TILE;
    const mapH = this.map.height * TILE;

    // A map smaller than the budget — an interior, say — would sit marooned in
    // black at the base zoom, so spend every whole step it can still fit in.
    const fits = Math.min(Math.floor(width / mapW), Math.floor(height / mapH));
    if (fits > zoom) zoom = Math.min(fits, MAX_ZOOM);
    camera.setZoom(zoom);

    // Per axis, because a map can overflow one and not the other. Padding the
    // bounds out to the view on an axis that fits centres the map there:
    // Phaser's clampX/clampY pin a bound narrower than the view to its own
    // left/top edge, which is what left the black band down one side.
    const viewW = width / zoom;
    const viewH = height / zoom;
    camera.setBounds(
      mapW < viewW ? (mapW - viewW) / 2 : 0,
      mapH < viewH ? (mapH - viewH) / 2 : 0,
      Math.max(mapW, viewW),
      Math.max(mapH, viewH)
    );
    camera.startFollow(this.player, true, 1, 1);
  }
}
