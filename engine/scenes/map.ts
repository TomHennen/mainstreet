import Phaser from 'phaser';
import { bus, EV } from '../bus';
import {
  buildingArt,
  characterTexture,
  dashTexture,
  frameIndex,
  itemTexture,
  mapTexture,
  promptTexture,
  TILE
} from '../art';
import { publishDebug } from '../debug';
import { isHeld, onAction } from '../input';
import { dialogueFor, itemVisible, itemsOn, npcsOn, propSignsOn, session, signFor } from '../session';
import { isSolid } from '../validate';
import type { BuildingPlacement, EpisodeItem, EpisodeSign, Facing, GameMap, Vec2 } from '../schema';

const SPEED = 102; // px/s — the prototype's 1.7px/frame at 60fps
const HITBOX = TILE;
const MARGIN = 4;
/** A map smaller than the view may be scaled up this far before it looks coarse. */
const MAX_ZOOM = 4;

// Reach in tiles. Interiors are tight, so an NPC behind a counter needs more.
const REACH = { npcVillage: 2.0, npcInterior: 2.3, item: 2.0, door: 2.2, prop: 2.1 };
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
  kind: 'npc' | 'item' | 'prop' | 'enter' | 'sign';
  at: Vec2;
  npcIndex?: number;
  item?: EpisodeItem;
  sign?: EpisodeSign;
  building?: BuildingPlacement;
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
  private itemSprites = new Map<string, Phaser.GameObjects.Image>();
  private exitArmed = false;
  private enterArmed = false;
  private spawnX = 0;
  private spawnY = 0;
  private unbindAction: (() => void) | null = null;

  constructor() {
    super('Map');
  }

  init(data: MapSceneData): void {
    this.mapId = data.mapId;
    this.map = session().world.maps[data.mapId];
    this.px = data.pos[0] * TILE;
    this.py = data.pos[1] * TILE;
    this.spawnX = this.px;
    this.spawnY = this.py;
    this.facing = data.facing;
    this.exitArmed = false;
    this.enterArmed = false;
    this.itemSprites = new Map();
  }

  create(data: MapSceneData): void {
    const { world, assets } = session();

    this.add.image(0, 0, mapTexture(this, this.mapId, this.map)).setOrigin(0, 0).setDepth(-100);

    for (const placement of this.map.buildings) {
      const def = world.buildings[placement.id];
      const paintedKey = assets.buildings.has(placement.id) ? `art:building:${placement.id}` : null;
      const art = buildingArt(this, placement, def, paintedKey);
      const depth = (placement.pos[1] + placement.size[1]) * TILE;
      this.add.image(art.x, art.y, art.key).setOrigin(0, 0).setDepth(depth);

      if (!art.painted) {
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
    dashTexture(this); // warm the travel interstitial's texture while we have a scene

    this.applyCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyCamera, this);

    this.unbindAction = onAction(() => this.interact());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindAction?.();
      this.unbindAction = null;
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
      publishDebug({
        map: this.mapId,
        x: this.px / TILE,
        y: this.py / TILE,
        facing: this.facing,
        dialogueOpen: state.dialogueOpen,
        locked: state.locked,
        flags: state.flags.snapshot()
      });
    }
    if (state.locked || state.dialogueOpen) {
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
      this.walkTime += delta;
    } else {
      this.walkTime = 0;
    }

    this.player.setFrame(frameIndex(this.facing, this.moving ? 1 + (Math.floor(this.walkTime / WALK_FRAME_MS) % 2) : 0));
    this.syncPlayerSprite();
    this.refreshItems();
    this.updatePrompt();
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

  private solidTile(tx: number, ty: number): boolean {
    // isSolid is shared with the validator and only knows map data; NPCs are
    // episode data, so the player has to be stopped by them here.
    if (isSolid(this.map, tx, ty)) return true;
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
    for (const building of this.map.buildings) {
      const kind: Target['kind'] = building.interior ? 'enter' : 'sign';
      if (kind === 'enter' && !this.enterArmed) continue;
      consider({ kind, at: [building.door[0], building.door[1] - 1], building }, REACH.door, 3, building.door);
    }
    return best;
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

    if (target.kind === 'sign' && target.building) {
      const building = target.building;
      const sign = signFor(building.id);
      const name = state.world.buildings[building.id].name;
      if (sign) {
        bus.emit(EV.say, { speaker: name, lines: sign.lines });
      } else if (!state.assets.buildings.has(building.id)) {
        bus.emit(EV.say, {
          speaker: name,
          lines: [
            state.copy.ui.unpainted
              .replace('{building}', name)
              .replace('{contribute}', state.world.contribute ?? '')
          ]
        });
      }
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
    const on = this.map.exits.find(
      (exit) => tx >= exit.at[0] && tx < exit.at[0] + exit.at[2] && ty >= exit.at[1] && ty < exit.at[1] + exit.at[3]
    );

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

    const mapW = this.map.tiles[0].length * TILE;
    const mapH = this.map.tiles.length * TILE;

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
