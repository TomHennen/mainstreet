import Phaser from 'phaser';
import { bus, EV } from '../bus';
import type { SayRequest } from '../bus';
import {
  buildingArt,
  characterTexture,
  dashTexture,
  doormatArt,
  fixtureArt,
  frameIndex,
  itemTexture,
  mapTexture,
  markerTexture,
  namePlateArt,
  patchMapTiles,
  plateLift,
  plaqueArt,
  promptTexture,
  signBoardArt,
  TILE,
  vehicleFrame,
  vehicleTexture
} from '../art';
import { currentDialogue, currentToast, publishDebug, publishFlagSetter } from '../debug';
import { edgeAt, roadEndLine } from '../edges';
import { isHeld, onAction, onTap } from '../input';
import { feedbackUrl } from '../feedback';
import { improveUrl, paintUrl } from '../paint';
import { Lighting } from '../lighting';
import { hashId, Mover, STROLL_FACTOR } from '../mover';
import { patchFor, withOverlays } from '../overlay';
import { Driver, DRIVE_FACTOR } from '../vehicle';
import { findPath, pathToTile } from '../path';
import { autosave } from '../progress';
import { introLineFor } from '../season';
import { SceneRunner, sceneTriggered } from '../scene';
import type { SceneDriver } from '../scene';
import {
  creditFor,
  dialogueFor,
  hasSmallTalk,
  itemVisible,
  itemsOn,
  npcsOn,
  overlaysOn,
  peopleOn,
  propSignsOn,
  session,
  signLinesFor,
  smallTalkFor,
  vehiclesOn
} from '../session';
import { driveable, isSolid, moverWalkable } from '../validate';
import { lookOf, plaqueTile, SCENE_PLAYER, SCENE_VEHICLE, signBoardTile } from '../schema';
import type { PlateBox } from '../art';
import type {
  BuildingPlacement,
  EpisodeItem,
  EpisodeNpc,
  EpisodeScene,
  EpisodeSign,
  Facing,
  MapSign,
  Fixture,
  GameMap,
  LightSpec,
  MapExit,
  Person,
  Vec2
} from '../schema';

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
/** How often a walk may be re-aimed at somebody who is moving, in ms. */
const CHASE_MS = 250;
/** However lively the street, a walk gives up rather than following for ever. */
const MAX_REPLANS = 32;
/** A scene's camera pan, in tiles a second, when the step names no speed. */
const PAN_SPEED = 8;

/**
 * Which tiles of each baked map texture an overlay is currently painted over.
 * The texture cache outlives this scene — a village looks the same when the
 * player walks back into it — so what was patched last time has to be
 * remembered for long enough to be painted back out (engine/art.ts
 * `patchMapTiles`). Keyed by map id; nothing here is saved, since overlays
 * derive from flags (DESIGN.md §3).
 */
const patchedTiles = new Map<string, Set<string>>();

export interface MapSceneData {
  mapId: string;
  pos: Vec2;
  facing: Facing;
  intro?: boolean;
}

interface Target {
  kind: 'npc' | 'item' | 'prop' | 'enter' | 'sign' | 'plaque' | 'fixture';
  at: Vec2;
  /** Index into `walkers` when this is somebody rather than something. */
  person?: number;
  item?: EpisodeItem;
  sign?: EpisodeSign | MapSign;
  building?: BuildingPlacement;
  fixture?: Fixture;
}

/**
 * Somebody standing on this map: an episode NPC, or one of the village's own
 * townspeople from `world.json` (DESIGN.md §2/§3). Either way the scene deals
 * with them the same — a sprite, a mover, and something to say — which is
 * what keeps the engine free of any idea of who they are (hard rule 1).
 */
interface Walker {
  id: string;
  /** The name on the dialogue box; a passer-by may have none. */
  name: string;
  /** The episode entry, when this person is part of the story. */
  npc?: EpisodeNpc;
  /** The world pack entry, when this is a townsperson rather than an episode NPC. */
  person?: Person;
  mover: Mover;
  sprite: Phaser.GameObjects.Sprite;
}

/**
 * One car going about its day on this map's paved routes (DESIGN.md §2, issue
 * #72). It is a driver and a sprite and nothing else: no name, no dialogue, no
 * tap target and no entry in `walkers`, which is what keeps it out of every
 * other thing this scene does — collision, routing, the A button, the save.
 */
interface Car {
  id: string;
  driver: Driver;
  sprite: Phaser.GameObjects.Sprite;
}

/** A rectangle of world pixels. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const covers = (box: Box, x: number, y: number): boolean =>
  x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

/** A fingertip is bigger than a six-pixel plaque, so its hit box is padded. */
const PLAQUE_PAD = 4;

/**
 * Where a building's picture actually is, in world pixels, so a tap can be
 * given to the building it looks like it landed on. A facade is drawn taller
 * than its footprint — roof, upper storeys, the name plate floating over the
 * lot — and all of that reads as the building to whoever is tapping it.
 */
interface Facade {
  building: BuildingPlacement;
  /** The footprint, the picture standing on it, and the name plate above. */
  boxes: Box[];
  /** The little brass plaque on the wall, padded out to a tappable size. */
  plaque: Box | null;
  /** Draw depth, so the building in front wins where two pictures overlap. */
  depth: number;
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
  /** Fixtures on screen, keyed by kind and tile — an overlay may add or take one. */
  private fixtureSprites = new Map<string, Phaser.GameObjects.Image>();
  /**
   * What the player is carrying, if anything: the token a `give` fixture
   * handed over (DESIGN.md §2). One thing at a time, this map only, never
   * saved — `init` clears it, so walking out of the yard drops the log.
   */
  private held: string | null = null;
  /** Fixtures burning right now, by their sprite key, and until when (seconds). */
  private litFixtures = new Map<string, number>();
  /** Seconds this scene has been running, for the fixture glows above. */
  private clock = 0;
  private exitArmed = false;
  private enterArmed = false;
  /** id of the `edges` entry (or a `road-end:<x>,<y>` key) currently shown, so it says its line once per visit rather than every frame. */
  private edgeShown: string | null = null;
  private spawnX = 0;
  private spawnY = 0;
  private unbindAction: (() => void) | null = null;
  private unbindTap: (() => void) | null = null;

  /** What every building's picture covers, for tap targeting. */
  private facades: Facade[] = [];
  /** The same boxes, flat, for the dev-only snapshot. */
  private artBoxes: Box[] = [];

  /** Everybody on this map who is not the player, in draw order-agnostic order. */
  private walkers: Walker[] = [];
  /** The ambient traffic on this map. Nothing else in the scene knows about it. */
  private cars: Car[] = [];
  /** What a person may walk on here: worked out once, since the ground never moves. */
  private ground: (x: number, y: number) => boolean = () => false;

  /** Tiles still to walk, nearest first, while a tapped walk is running. */
  private walkPath: Vec2[] | null = null;
  private walkGoal: Vec2 | null = null;
  /** What arriving should read, as if A had been pressed there; null reads nothing. */
  private walkTarget: Target | null = null;
  /** Somebody the walk is following, so a tap lands on them wherever they got to. */
  private walkFollow: Walker | null = null;
  /** How close the walk has to get for what was tapped to read. */
  private walkReach = 0;
  /** How many times this walk has been re-aimed, so a chase always ends. */
  private replans = 0;
  private lastReplan = 0;

  /** The scene playing right now, if one is (DESIGN.md §3). */
  private runner: SceneRunner | null = null;
  /** Scenes waiting for the box on screen to close before they start. */
  private queued: EpisodeScene[] = [];
  private lighting!: Lighting;
  /** True while the scene has walked the player somewhere they may not leave. */
  private sceneWalk = false;

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
    this.edgeShown = null;
    this.itemSprites = new Map();
    this.fixtureSprites = new Map();
    this.held = null;
    this.litFixtures = new Map();
    this.clock = 0;
    this.facades = [];
    this.artBoxes = [];
    this.walkPath = null;
    this.walkGoal = null;
    this.walkTarget = null;
    this.walkFollow = null;
    this.walkers = [];
    this.cars = [];
    this.replans = 0;
    this.lastReplan = 0;
    this.runner = null;
    this.queued = [];
    this.sceneWalk = false;
    // An overlay's tiles are part of the ground from here on: collision,
    // routing and the baked texture all read them off the map (DESIGN.md §3).
    this.map = withOverlays(this.map, overlaysOn(data.mapId));
  }

  create(data: MapSceneData): void {
    const { world, assets } = session();

    this.add.image(0, 0, mapTexture(this, this.mapId, this.map, assets.tilesets)).setOrigin(0, 0).setDepth(-100);
    // The texture cache outlives this scene, so a village walked back into may
    // still be carrying last week's patch. This puts it right (DESIGN.md §3).
    this.refreshOverlays();

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
      const image = this.add.image(art.x, art.y, art.key).setOrigin(0, 0).setDepth(depth);

      // What the building covers on screen, kept as it is drawn rather than
      // worked out again later: the footprint it stands on and the picture
      // above it, which is what a finger aims at (CLAUDE.md #4).
      const facade: Facade = {
        building: placement,
        boxes: [
          {
            x: placement.pos[0] * TILE,
            y: placement.pos[1] * TILE,
            w: placement.size[0] * TILE,
            h: placement.size[1] * TILE
          },
          { x: image.x, y: image.y, w: image.displayWidth, h: image.displayHeight }
        ],
        plaque: null,
        depth
      };
      this.facades.push(facade);

      // Every building carries its plaque, painted or not: it is the engine's
      // own little fixture, sitting over the facade so no artist has to paint
      // one (DESIGN.md §2/§4).
      const plaque = plaqueArt(this, placement);
      if (plaque) {
        const brass = this.add.image(plaque.x, plaque.y, plaque.key).setOrigin(0, 0).setDepth(depth + 2);
        facade.plaque = {
          x: brass.x - PLAQUE_PAD,
          y: brass.y - PLAQUE_PAD,
          w: brass.displayWidth + PLAQUE_PAD * 2,
          h: brass.displayHeight + PLAQUE_PAD * 2
        };
      }

      // A door that opens gets the engine's own "come on in" laid at its
      // foot, and its standing sign moves to a little board beside it — the
      // door stays the way in, and only the way in (CLAUDE.md #4, DESIGN.md
      // §2). A door with nothing behind it keeps reading the sign itself, and
      // grows neither.
      const mat = doormatArt(this, placement);
      if (mat) this.add.image(mat.x, mat.y, mat.key).setOrigin(0, 0).setDepth(mat.depth);
      const board = signBoardArt(this, placement);
      if (board) this.add.image(board.x, board.y, board.key).setOrigin(0, 0).setDepth(depth + 2);

      if (art.painted) {
        // The placeholder bakes its name plate into the facade texture itself;
        // a painted PNG has nothing to bake it into, so it gets a plate of its
        // own here (issue #32), unless the placement opts out.
        if (placement.label !== false) {
          const plate = namePlateArt(this, placement, def, art.y, lift);
          const sign = this.add.image(plate.x, plate.y, plate.key).setOrigin(0, 0).setDepth(depth + 1);
          facade.boxes.push({ x: sign.x, y: sign.y, w: sign.displayWidth, h: sign.displayHeight });
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

    // Dev only, for the playtest harness: which ground is plain ground, and
    // which is somebody's shopfront (engine/debug.ts).
    if (import.meta.env.DEV) {
      this.artBoxes = this.facades.flatMap((facade) =>
        facade.plaque ? [...facade.boxes, facade.plaque] : facade.boxes
      );
    }

    // The engine's own street furniture: drawn on the tile it stands on, at
    // that tile's depth, so the player passes behind it going up the street
    // and in front of it coming down (DESIGN.md §2).
    this.refreshFixtures();

    const itemKey = itemTexture(this);
    for (const item of itemsOn(this.mapId)) {
      const sprite = this.add
        .image(item.pos[0] * TILE, item.pos[1] * TILE, itemKey)
        .setOrigin(0, 0)
        .setDepth(item.pos[1] * TILE);
      this.tweens.add({ targets: sprite, y: sprite.y - 3, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.itemSprites.set(item.id, sprite);
    }

    // Where anybody but the player may walk. Stricter than the player's own
    // collision on purpose: a doorstep and a plaque tile are read by standing
    // exactly there, and the road out of the village is the player's to take
    // (engine/validate.ts, which the validator checks routes against).
    this.ground = moverWalkable(this.map);

    // Everybody on the map, story or not, built the same way (DESIGN.md §2).
    for (const npc of npcsOn(this.mapId)) {
      this.addWalker({ id: npc.id, name: npc.name, npc });
    }
    for (const person of peopleOn(this.mapId)) {
      this.addWalker({ id: person.id, name: person.name ?? '', person });
    }
    this.addCars();

    const playerKey = assets.chars.has(world.player.id)
      ? `art:char:${world.player.id}`
      : characterTexture(this, lookOf(world.player));
    this.player = this.add.sprite(0, 0, playerKey, frameIndex(this.facing, 0)).setOrigin(0.5, 1);
    this.syncPlayerSprite();

    this.prompt = this.add.image(0, 0, promptTexture(this, 'A')).setOrigin(0.5, 1).setDepth(9000).setVisible(false);
    // Sits under the A prompt and over the town, so a destination behind a
    // porch roof is still findable while the player walks to it.
    this.marker = this.add.image(0, 0, markerTexture(this)).setOrigin(0, 0).setDepth(8500).setVisible(false);
    dashTexture(this); // warm the travel interstitial's texture while we have a scene

    // Over the town and under the HUD, so an evening or a party colours the
    // place without ever getting between the player and what they are reading
    // (engine/lighting.ts). Cleared by a map change unless the scene that lit
    // it asked to keep it.
    this.lighting = new Lighting(this, this.map.width, this.map.height);
    this.lighting.apply(session().light);

    this.applyCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyCamera, this);

    this.unbindAction = onAction(() => this.interact());
    this.unbindTap = onTap((x, y) => this.tap(x, y));
    bus.on(EV.flags, this.onFlag, this);
    if (import.meta.env.DEV) {
      this.events.on(Phaser.Scenes.Events.RENDER, this.publishState, this);
      // The harness's way of standing a story up at a later rung (engine/debug.ts).
      publishFlagSetter((name) => {
        const flags = session().flags;
        if (!flags.declared(name) || flags.get(name)) return false;
        flags.set(name);
        return true;
      });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindAction?.();
      this.unbindAction = null;
      this.unbindTap?.();
      this.unbindTap = null;
      bus.off(EV.flags, this.onFlag, this);
      if (import.meta.env.DEV) publishFlagSetter(undefined);
      this.lighting.clear();
      this.events.off(Phaser.Scenes.Events.RENDER, this.publishState, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyCamera, this);
    });

    // Arriving somewhere is worth remembering on its own: a save made here
    // brings the player back to this map on this tile (DESIGN.md §2).
    this.notePlace();
    autosave();

    const state = session();
    if (data.intro && !state.introShown && state.copy.intro) {
      state.introShown = true;
      // The world intro sets the place and the controls; an episode's own
      // `intro` (DESIGN.md §3) follows it in the same card, in the same
      // voice, with this week's opening line or two. The first line follows
      // the real calendar when the world pack offers `intro.byDate`
      // (DESIGN.md §2/§3) — picked from the device's local date at boot and
      // never saved (CLAUDE.md hard rule 7).
      const lines = [
        introLineFor(state.copy.intro, new Date()),
        ...state.copy.intro.lines.slice(1),
        ...(state.episode.intro ?? [])
      ];
      bus.emit(EV.say, { speaker: state.copy.intro.speaker, lines });
    }

    // Anything this episode stages on arriving here (DESIGN.md §3). It queues
    // rather than starting outright, so a scene never talks over the opening
    // card the player is still reading.
    this.queue({ enter: this.mapId });
  }

  // --- scenes ----------------------------------------------------------------

  /** Every scene this episode would start now, in the order it lists them. */
  private queue(trigger: { enter?: string }): void {
    const { episode, flags } = session();
    for (const scene of episode.scenes ?? []) {
      if (!sceneTriggered(scene, trigger, flags)) continue;
      if (this.runner?.id === scene.id || this.queued.some((waiting) => waiting.id === scene.id)) continue;
      this.queued.push(scene);
    }
  }

  /**
   * A flag has been set, from a line of dialogue, an item, or a scene's own
   * `set` step. Two things follow from it and nothing else does: an overlay
   * whose gate that flag was appears (or goes), and a scene waiting on it
   * starts (DESIGN.md §3).
   */
  private onFlag(): void {
    this.refreshOverlays();
    this.queue({});
  }

  /**
   * The scene driver (engine/scene.ts). Every method is either "start this" or
   * "is it over yet" — the runner itself is Phaser-free, and this is the only
   * place a step turns into something on screen.
   */
  private driver(): SceneDriver {
    return {
      beginMove: (who, to, speed) => {
        if (who === SCENE_PLAYER) {
          this.stopWalk();
          this.sceneWalk = this.aimWalk(to, null, 0);
          return this.sceneWalk;
        }
        // A car takes the road rather than the pavement, and never routes
        // round anybody standing in it — it slows down for them instead
        // (engine/vehicle.ts).
        const car = this.carFor(who);
        if (car) return car.sendTo(to, speed);
        const mover = this.moverFor(who);
        if (!mover) return false;
        return mover.sendTo(to, speed, (x, y) => !this.occupiedBySomeoneElse(mover, x, y));
      },
      moving: (who) => {
        if (who === SCENE_PLAYER) return this.walkPath !== null;
        // A car with a route of its own is busy all day long, so what says a
        // scene's move is over is the errand it was sent on, nothing else.
        const car = this.carFor(who);
        if (car) return car.driving;
        const mover = this.moverFor(who);
        return Boolean(mover && (mover.busy || mover.onErrand));
      },
      say: (who, lines) => {
        const state = session();
        const walker = who ? this.walkers.find((one) => one.id === who) : undefined;
        if (walker) {
          // Whoever is speaking turns to the player, exactly as they do when
          // they are spoken to.
          const me = this.centre();
          walker.mover.faceToward(me.x, me.y);
          walker.sprite.setFrame(frameIndex(walker.mover.facing, 0));
        }
        bus.emit(EV.say, {
          speaker: walker?.name ?? (who ? '' : state.copy.ui.narrator),
          lines,
          portrait: who && state.assets.portraits.has(who) ? `art:portrait:${who}` : undefined
        });
      },
      talking: () => session().dialogueOpen,
      toast: (text) => bus.emit(EV.toast, text),
      beginCamera: (to, speed) => this.panCamera(to, speed),
      panning: () => this.cameras.main.panEffect.isRunning,
      setFlag: (name) => {
        const flags = session().flags;
        if (!flags.declared(name)) return;
        flags.set(name);
        // A scene that has happened is progress worth remembering, which is
        // what keeps a `once` scene from playing twice (DESIGN.md §2).
        autosave();
      },
      light: (spec) => this.applyLight(spec)
    };
  }

  /**
   * Whatever `who` names that can be given a path and says when it has
   * arrived: somebody on this map, or a `"vehicle:<id>"` — a car on the
   * village's own list or on the running episode's (DESIGN.md §2/§3). The
   * runner keeps `who` opaque on purpose, so a new kind of thing that moves
   * needs no change to it (engine/scene.ts).
   */
  private moverFor(who: string): Mover | null {
    const car = this.carFor(who);
    if (car) return car.mover;
    return this.walkers.find((walker) => walker.id === who)?.mover ?? null;
  }

  /** The car a `"vehicle:<id>"` names on this map, if there is one. */
  private carFor(who: string): Driver | null {
    if (!who.startsWith(SCENE_VEHICLE)) return null;
    const id = who.slice(SCENE_VEHICLE.length);
    return this.cars.find((car) => car.id === id)?.driver ?? null;
  }

  /** As `occupied`, but taking the mover rather than the walker around it. */
  private occupiedBySomeoneElse(mover: Mover, x: number, y: number): boolean {
    const walker = this.walkers.find((one) => one.mover === mover) ?? null;
    return this.occupied(walker, x, y);
  }

  /** A scene looking at something, or handing the camera back to the player. */
  private panCamera(to: Vec2 | 'player', speed?: number): void {
    const camera = this.cameras.main;
    const target =
      to === 'player'
        ? { x: this.px + TILE / 2, y: this.py + TILE / 2 }
        : { x: to[0] * TILE + TILE / 2, y: to[1] * TILE + TILE / 2 };
    const from = camera.midPoint;
    const tiles = Math.hypot(target.x - from.x, target.y - from.y) / TILE;
    const ms = Math.max(120, (tiles / Math.max(1, speed ?? PAN_SPEED)) * 1000);
    camera.stopFollow();
    camera.pan(target.x, target.y, ms, 'Sine.easeInOut', true, (_c, progress) => {
      // Back on the player's shoulder the moment the pan home lands, so the
      // controls never feel as though they have been kept.
      if (to === 'player' && progress >= 1) camera.startFollow(this.player, true, 1, 1);
    });
  }

  /**
   * A `light` step. The lights go up here and now; `keep` also parks the spec
   * on the session, which is what carries an evening through a door
   * (DESIGN.md §3). Anything else is cleared by the next map.
   */
  private applyLight(spec: LightSpec): void {
    const state = session();
    state.light = spec.keep && spec.mode !== 'off' ? spec : null;
    this.lighting.apply(spec.mode === 'off' ? null : spec);
  }

  // --- overlays --------------------------------------------------------------

  /**
   * Re-reads which overlays are on and repaints only what changed
   * (DESIGN.md §3). Collision and routing follow because the overlay is a tile
   * layer on the map itself, so everything that reads the map reads it.
   */
  private refreshOverlays(): void {
    const base = session().maps[this.mapId];
    const next = withOverlays(base, overlaysOn(this.mapId));
    const before = patchedTiles.get(this.mapId) ?? new Set<string>();
    const patch = patchFor(base, overlaysOn(this.mapId));
    const now = new Set<string>();
    for (const index of patch.cells.keys()) {
      now.add(`${index % base.width},${Math.floor(index / base.width)}`);
    }
    if (before.size === now.size && [...now].every((key) => before.has(key))) return;

    this.map = next;
    this.ground = moverWalkable(this.map);
    // Whatever an overlay covers now, plus whatever it used to cover and no
    // longer does — that second half is what puts the ordinary ground back.
    const repaint: Vec2[] = [];
    for (const key of new Set([...before, ...now])) {
      const [x, y] = key.split(',').map(Number);
      repaint.push([x, y]);
    }
    patchMapTiles(this, this.mapId, this.map, session().assets.tilesets, repaint);
    patchedTiles.set(this.mapId, now);
    this.refreshFixtures();
  }

  /** Draws any fixture an overlay brought that is not on screen yet. */
  private refreshFixtures(): void {
    for (const fixture of this.fixtures()) {
      const key = `${fixture.kind}:${fixture.pos[0]},${fixture.pos[1]}`;
      if (this.fixtureSprites.has(key)) continue;
      const art = fixtureArt(this, fixture, this.litFixtures.has(key));
      this.fixtureSprites.set(key, this.add.image(art.x, art.y, art.key).setOrigin(0, 0).setDepth(art.depth));
    }
    for (const [key, sprite] of this.fixtureSprites) {
      const [, at] = key.split(':');
      const [x, y] = at.split(',').map(Number);
      if (!this.fixtures().some((fixture) => fixture.pos[0] === x && fixture.pos[1] === y)) {
        sprite.destroy();
        this.fixtureSprites.delete(key);
      }
    }
  }

  /**
   * A fixture that has just been fed burns brighter for a while: one warm
   * light over its tile (engine/lighting.ts) and, where its kind has one, the
   * lit variant of its art. Nothing here is a timer of its own — `update`
   * counts it down with everything else, and it goes out on its own.
   */
  private lightFixture(fixture: Fixture): void {
    if (!(fixture.glow && fixture.glow > 0)) return;
    const key = `${fixture.kind}:${fixture.pos[0]},${fixture.pos[1]}`;
    this.litFixtures.set(key, this.clock + fixture.glow);
    this.lighting.glow(fixture.pos, fixture.glow);
    const sprite = this.fixtureSprites.get(key);
    if (sprite) sprite.setTexture(fixtureArt(this, fixture, true).key);
  }

  /** Puts a fed fixture back to its unlit self once its glow has burned out. */
  private dimFixtures(): void {
    if (!this.litFixtures.size) return;
    for (const [key, until] of [...this.litFixtures]) {
      if (this.clock < until) continue;
      this.litFixtures.delete(key);
      const [x, y] = key.slice(key.indexOf(':') + 1).split(',').map(Number);
      const fixture = this.fixtures().find((one) => one.pos[0] === x && one.pos[1] === y);
      const sprite = this.fixtureSprites.get(key);
      if (fixture && sprite) sprite.setTexture(fixtureArt(this, fixture, false).key);
    }
  }

  /**
   * One person on the map: the sprite, and the mover that walks them. An
   * episode NPC and a village's own townsperson differ only in what they have
   * to say, so everything about standing them up is shared.
   */
  private addWalker(who: { id: string; name: string; npc?: EpisodeNpc; person?: Person }): void {
    const { assets } = session();
    const source = who.npc ?? who.person;
    if (!source) return;
    const key = assets.chars.has(who.id) ? `art:char:${who.id}` : characterTexture(this, lookOf(source));
    const facing = source.facing ?? 'down';
    const sprite = this.add
      .sprite(source.pos[0] * TILE + TILE / 2, source.pos[1] * TILE + TILE, key, frameIndex(facing, 0))
      .setOrigin(0.5, 1)
      .setDepth(source.pos[1] * TILE + TILE);

    const mover = new Mover({
      home: source.pos,
      facing,
      route: source.route,
      wander: source.wander,
      // A stroll is slower than going somewhere. Tiles per second, so the
      // walk is the same on any screen and at any frame rate.
      speed: (source.route?.speed ?? (SPEED * STROLL_FACTOR) / TILE),
      // Through a closure rather than by value: an overlay can change what the
      // ground is under somebody's feet while they are standing on it.
      walkable: (x, y) => this.ground(x, y),
      seed: hashId(who.id)
    });
    this.walkers.push({ id: who.id, name: who.name, npc: who.npc, person: who.person, mover, sprite });
  }

  /**
   * The village's ambient traffic (DESIGN.md §2, issue #72). Everything about
   * a car is in this method, `updateCars` and the driver it hands off to: it
   * is never added to `walkers`, so it is never solid, never a tap target,
   * never something A can be pressed on and never anything a save hears about.
   *
   * A painted `assets/vehicles/<id>.png` replaces the drawn car by convention;
   * a missing one is the normal case (hard rule 3).
   */
  private addCars(): void {
    const { assets } = session();
    const drivable = driveable(this.map);
    for (const vehicle of vehiclesOn(this.mapId)) {
      const key = assets.vehicles.has(vehicle.id)
        ? `art:vehicle:${vehicle.id}`
        : vehicleTexture(this, vehicle.kind, vehicle.colour);
      const driver = new Driver({
        pos: vehicle.pos,
        path: vehicle.path,
        loop: vehicle.loop,
        pause: vehicle.pause,
        // Tiles per second, like everybody else's, so a car drives the same on
        // any screen and at any frame rate.
        speed: vehicle.speed ?? (SPEED * DRIVE_FACTOR) / TILE,
        drivable,
        facing: vehicle.facing
      });
      // Origin at the middle of the car, which is what its tile position
      // means: a car lies along the lane it is in rather than standing on it.
      const sprite = this.add.sprite(0, 0, key, vehicleFrame(driver.facing)).setOrigin(0.5, 0.5);
      this.cars.push({ id: vehicle.id, driver, sprite });
    }
    if (this.cars.length) this.drawCars();
  }

  /**
   * The traffic's frame. A car drives on whatever else is happening — a
   * village does not hold its breath while somebody reads a sign — and gives
   * way to the player, and to any car listed before it on the map.
   *
   * That last rule is one-way on purpose: a car only ever waits for cars
   * *earlier* in the list, so two of them can never sit waiting on each other
   * at a crossroads. Nobody waits for a car, which is the whole point of them.
   */
  private updateCars(delta: number): void {
    if (!this.cars.length) return;
    const dt = delta / 1000;
    this.cars.forEach((car, index) => {
      car.driver.update(dt, {
        blocked: (x, y) => {
          for (const tile of this.playerTiles()) {
            if (tile[0] === x && tile[1] === y) return true;
          }
          for (let i = 0; i < index; i++) {
            for (const tile of this.cars[i].driver.mover.tiles()) {
              if (tile[0] === x && tile[1] === y) return true;
            }
          }
          return false;
        }
      });
    });
    this.drawCars();
  }

  /**
   * Where the traffic is drawn, and how deep.
   *
   * **Depth.** A car sits at its own centre line — half a tile above the
   * ground line of the row it is in — so it draws over the road and behind
   * anything standing further down the street. It is then capped just under
   * the player's own depth, so wherever the two overlap the player is in
   * front: a car passes *under* the player, never over them, which is the
   * drawn half of "never a hazard" (DESIGN.md §1).
   */
  private drawCars(): void {
    const under = this.py + HITBOX - 1;
    for (const car of this.cars) {
      const { driver, sprite } = car;
      sprite.setPosition(Math.round(driver.x * TILE) + TILE / 2, Math.round(driver.y * TILE) + TILE / 2);
      sprite.setDepth(Math.min((driver.y + 0.5) * TILE, under));
      sprite.setFrame(vehicleFrame(driver.facing));
    }
  }

  /**
   * Everybody else's frame. People stand still while a box is open and while
   * the player is close enough to talk to them, so somebody with something to
   * say is never walked away from mid-sentence; they never step onto the
   * player or onto each other; and they turn to face whoever is speaking to
   * them (DESIGN.md §2). None of this touches the save — where a townsperson
   * got to is not progress (engine/progress.ts).
   */
  private updateWalkers(delta: number): void {
    if (!this.walkers.length) return;
    const state = session();
    const held = state.locked || state.dialogueOpen;
    const me = this.centre();
    const reach = this.map.kind === 'interior' ? REACH.npcInterior : REACH.npcVillage;
    const dt = delta / 1000;

    for (const walker of this.walkers) {
      const near = Math.hypot(me.x - (walker.mover.x + 0.5), me.y - (walker.mover.y + 0.5)) <= reach;
      if (near && walker.mover.walks && !walker.mover.busy) walker.mover.faceToward(me.x, me.y);
      walker.mover.update(dt, {
        held: held || near,
        blocked: (x, y) => this.occupied(walker, x, y)
      });

      const { mover, sprite } = walker;
      sprite.setPosition(Math.round(mover.x * TILE) + TILE / 2, Math.round(mover.y * TILE) + TILE);
      sprite.setDepth(mover.y * TILE + TILE);
      sprite.setFrame(
        frameIndex(mover.facing, mover.moving ? 1 + (Math.floor((mover.walkTime * 1000) / WALK_FRAME_MS) % 2) : 0)
      );
    }
  }

  /**
   * Whether pressing A on this person does anything. An episode NPC always has
   * something to say; a village's own townsperson only where they carry their
   * own `lines`, or the world pack wrote a passing line for them to say
   * (hard rule 3).
   */
  private canTalkTo(walker: Walker): boolean {
    if (walker.npc) return true;
    if (walker.person?.lines?.length) return true;
    return hasSmallTalk();
  }

  /**
   * A line for somebody with no story to tell: their small talk, the same one
   * every time, or — about one time in five — a line of trivia instead
   * (`smallTalkFor`, DESIGN.md §2).
   */
  private passerbyLine(id: string): string | undefined {
    return smallTalkFor({ id });
  }

  /** Somebody — the player, or one of the others — is standing on this tile. */
  private occupied(self: Walker | null, x: number, y: number): boolean {
    for (const tile of this.playerTiles()) {
      if (tile[0] === x && tile[1] === y) return true;
    }
    for (const walker of this.walkers) {
      if (walker === self) continue;
      for (const tile of walker.mover.tiles()) {
        if (tile[0] === x && tile[1] === y) return true;
      }
    }
    return false;
  }

  /** The tiles the player's hitbox is over — one, two, or four at a corner. */
  private playerTiles(): Vec2[] {
    const tiles: Vec2[] = [];
    for (const ox of [MARGIN, HITBOX - MARGIN]) {
      for (const oy of [MARGIN, HITBOX - MARGIN]) {
        const tx = Math.floor((this.px + ox) / TILE);
        const ty = Math.floor((this.py + oy) / TILE);
        if (!tiles.some((tile) => tile[0] === tx && tile[1] === ty)) tiles.push([tx, ty]);
      }
    }
    return tiles;
  }

  /**
   * Dev-only snapshot for the playtest harness. It hangs off the render event
   * rather than off update() on purpose: the camera recalculates its scroll
   * and its worldView while the frame is being drawn, so this is the frame the
   * player is looking at — and a tap the harness aims with it lands on the
   * tile it looks like it lands on, however slow the machine is.
   */
  private publishState(): void {
    const state = session();
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
      art: this.artBoxes,
      people: this.walkers.map((walker) => ({
        id: walker.id,
        x: walker.mover.x,
        y: walker.mover.y,
        tiles: walker.mover.tiles().map((tile) => [tile[0], tile[1]] as [number, number])
      })),
      vehicles: this.cars.map((car) => ({
        id: car.id,
        x: car.driver.x,
        y: car.driver.y,
        facing: car.driver.facing,
        stopped: car.driver.stopped,
        yielding: car.driver.yielding
      })),
      flags: state.flags.snapshot(),
      dialogue: currentDialogue(),
      scene: this.runner ? { id: this.runner.id, holds: this.runner.holds } : null,
      light: this.lighting.describe(),
      held: this.held,
      overlays: overlaysOn(this.mapId).map((overlay) => overlay.id),
      toast: currentToast()
    });
  }

  update(_time: number, delta: number): void {
    const state = session();
    const dt = delta / 1000;
    this.clock += dt;
    this.armEnters();
    this.lighting.update(dt);
    this.dimFixtures();
    this.runScene(dt);
    // Everybody else moves first, and keeps moving on their own clock: the
    // town does not stop because the player is standing still. The traffic
    // keeps moving through a dialogue box too — a car outside the window does
    // not wait for a conversation to finish.
    this.updateWalkers(delta);
    this.updateCars(delta);
    if (state.locked || (state.dialogueOpen && !this.sceneWalk)) {
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
    // While a scene is walking the player somewhere, the controls are the
    // scene's; a held direction is simply not read (DESIGN.md §3).
    if (!this.sceneWalk) {
      if (isHeld('up')) dy = -1;
      else if (isHeld('down')) dy = 1;
      if (isHeld('left')) dx = -1;
      else if (isHeld('right')) dx = 1;
    }

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
      // Somebody the walk is aimed at may have strolled on since it started.
      this.chase();
      this.moving = this.followPath((SPEED * delta) / 1000);
    }

    if (this.moving) this.walkTime += delta;
    else this.walkTime = 0;

    this.player.setFrame(frameIndex(this.facing, this.moving ? 1 + (Math.floor(this.walkTime / WALK_FRAME_MS) % 2) : 0));
    this.syncPlayerSprite();
    this.notePlace();
    this.refreshItems();
    this.updatePrompt();
    this.updateMarker();
    this.checkExits();
    this.checkEdges();
  }

  /**
   * One frame of whatever scene is playing, and the next one off the queue
   * when none is (DESIGN.md §3). A scene never starts over a box that is still
   * open — the opening card, or a line the player is reading — so it waits its
   * turn rather than talking over it.
   */
  private runScene(dt: number): void {
    const state = session();
    if (this.runner) {
      this.runner.update(dt);
      if (!this.runner.finished) return;
      this.runner = null;
      this.sceneWalk = false;
    }
    if (!this.queued.length || state.locked || state.dialogueOpen) return;
    const next = this.queued.shift();
    if (!next) return;
    this.stopWalk();
    this.runner = new SceneRunner(next, this.driver());
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

  /**
   * Keeps the session's idea of where the player is standing current, so an
   * autosave fired from anywhere else — the dialogue box closing on a flag,
   * say — writes the right tile without having to ask this scene for it.
   */
  private notePlace(): void {
    const place = session().place;
    const tile = this.startTile();
    place.map = this.mapId;
    place.pos[0] = tile[0];
    place.pos[1] = tile[1];
    place.facing = this.facing;
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
    // Where somebody is standing now, not where the data placed them: a person
    // walking a route is solid all the way along it.
    return this.walkers.some((walker) => walker.mover.tiles().some((tile) => tile[0] === tx && tile[1] === ty));
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
    for (let i = 0; i < this.walkers.length; i++) {
      if (!this.canTalkTo(this.walkers[i])) continue;
      consider({ kind: 'npc', at: this.walkers[i].mover.tile(), person: i }, npcReach, 0);
    }
    for (const item of itemsOn(this.mapId)) {
      if (itemVisible(item)) consider({ kind: 'item', at: item.pos, item }, REACH.item, 1);
    }
    for (const sign of propSignsOn(this.mapId)) {
      if (sign.pos) consider({ kind: 'prop', at: sign.pos, sign }, REACH.prop, 2);
    }
    // The map's own signs, which are there every week (DESIGN.md §2).
    for (const sign of this.map.signs ?? []) {
      consider({ kind: 'prop', at: sign.pos, sign }, REACH.prop, 2);
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
      if (building.interior) {
        // Once a door only opens, its sign moves to a board of its own — read
        // whether or not the door is armed to open, since reading it again
        // never has the doorstep problem the door itself does.
        if (this.enterArmed) {
          consider({ kind: 'enter', at: [building.door[0], building.door[1] - 1], building }, REACH.door, 3, building.door);
        }
        const board = signBoardTile(building);
        if (board) {
          consider({ kind: 'sign', at: [board[0], board[1] - 1], building }, REACH.door, 3, board);
        }
      } else {
        consider({ kind: 'sign', at: [building.door[0], building.door[1] - 1], building }, REACH.door, 3, building.door);
      }
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
    // Where the scene is walking the player is where they are going.
    if (this.runner?.holds) return;

    const point = this.pointAt(clientX, clientY);
    if (!point) return;
    const tile: Vec2 = [Math.floor(point.x / TILE), Math.floor(point.y / TILE)];

    const hit = this.tapTargetAt(tile, point.x, point.y);
    this.follow(null);
    this.replans = 0;
    if (!this.aimWalk(hit?.goal ?? tile, hit?.target ?? null, hit?.reach ?? 0)) {
      this.refuse(tile);
      return;
    }
    // A tap on somebody is a tap on *them*, not on the paving they happened to
    // be standing on. They stand and wait rather than strolling on, so that
    // walking over to somebody is never walking over to where they were; if
    // the walk is called off or aimed somewhere else, they carry on.
    if (hit?.target.kind === 'npc' && hit.target.person !== undefined) {
      this.follow(this.walkers[hit.target.person]);
    }
  }

  /**
   * Who the walk is for, if it is for somebody. Whoever it was picks their
   * walk back up, and whoever it is now waits where they are until the player
   * gets there (engine/mover.ts `hail`).
   */
  private follow(walker: Walker | null): void {
    if (this.walkFollow === walker) return;
    this.walkFollow?.mover.release();
    this.walkFollow = walker;
    walker?.mover.hail();
  }

  /**
   * Points a walk at a tile and puts the ring on it. `target` is what arriving
   * should read, and `reach` how close that has to get — which is what lets a
   * walk end across a counter rather than beside it. False when there is no
   * way there at all.
   */
  private aimWalk(goal: Vec2, target: Target | null, reach: number): boolean {
    const start = this.startTile();
    const walkable = this.walkableTo(goal);
    let route = pathToTile(start, goal, walkable);
    if (!route && target) {
      // Somebody behind a counter has no free tile beside them, and is still
      // perfectly easy to talk to across it. Failing that, stand anywhere the
      // A button would reach them from — the same reach findTarget() uses.
      route = findPath(start, (x, y) => Math.hypot(x - goal[0], y - goal[1]) <= reach, walkable);
    }
    if (!route?.length) return false;

    this.walkPath = route;
    this.walkGoal = route[route.length - 1];
    this.walkTarget = target;
    this.walkReach = reach;
    this.tweens.killTweensOf(this.marker);
    this.marker.setPosition(this.walkGoal[0] * TILE, this.walkGoal[1] * TILE).setAlpha(1).setVisible(true);
    return true;
  }

  /** Aims the walk at where somebody has got to. False when they are cut off. */
  private reaim(walker: Walker): boolean {
    this.lastReplan = this.time.now;
    if (this.replans++ > MAX_REPLANS) {
      this.stopWalk();
      return false;
    }
    const at = walker.mover.tile();
    const reach = this.map.kind === 'interior' ? REACH.npcInterior : REACH.npcVillage;
    const follow = walker;
    if (!this.aimWalk(at, { kind: 'npc', at, person: this.walkers.indexOf(walker) }, reach)) {
      this.stopWalk();
      return false;
    }
    this.follow(follow);
    return true;
  }

  /** The tapped person has moved: follow them, at most a few times a second. */
  private chase(): void {
    const walker = this.walkFollow;
    if (!walker || !this.walkGoal) return;
    const at = walker.mover.tile();
    if (at[0] === this.walkGoal[0] && at[1] === this.walkGoal[1]) return;
    if (this.time.now - this.lastReplan < CHASE_MS) return;
    this.reaim(walker);
  }

  /**
   * Somebody stepped into the route after it was found. Go round them — the
   * routing counts people as solid, so a fresh search does exactly that —
   * rather than stopping dead in the street.
   */
  private reroute(): void {
    if (this.time.now - this.lastReplan < CHASE_MS / 2) return;
    if (this.walkFollow) {
      this.reaim(this.walkFollow);
      return;
    }
    this.lastReplan = this.time.now;
    const goal = this.walkGoal;
    if (!goal || this.replans++ > MAX_REPLANS) {
      this.stopWalk();
      return;
    }
    if (!this.aimWalk(goal, this.walkTarget, this.walkReach)) this.stopWalk();
  }

  /** Client pixels to a point in the world, through the canvas box and the camera. */
  private pointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.game.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const { width, height } = this.scale.gameSize;
    const point = this.cameras.main.getWorldPoint((x * width) / rect.width, (y * height) / rect.height);
    return { x: point.x, y: point.y };
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
   * What the player tapped, the tile the walk should end on, and how close
   * that has to get for the reading to work. Order matches findTarget()'s:
   * people, then things, then buildings. People are drawn two tiles tall, so
   * their head counts as them; a fixture is tapped where it stands and read
   * from beside it.
   *
   * A building answers for more than a tile. Its door — and the doorway drawn
   * on the wall above it — opens the place when there is an interior and reads
   * the sign when there is not. Its plaque answers on the tile it is read from
   * and on the little brass plaque hanging over the facade. Everything else
   * the picture covers, roof and name plate included, is the facade: walk to
   * the front and read the sign, which is what tapping a shop means (CLAUDE.md
   * #4). All of it comes from the map and the picture — never from what the
   * building is (hard rule 1).
   */
  private tapTargetAt(tile: Vec2, x: number, y: number): { target: Target; goal: Vec2; reach: number } | null {
    const [tx, ty] = tile;
    const npcReach = this.map.kind === 'interior' ? REACH.npcInterior : REACH.npcVillage;
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i];
      if (!this.canTalkTo(walker)) continue;
      // A person is judged by their picture, exactly as a building is, rather
      // than by the tile underneath it: they are drawn two tiles tall, and
      // somebody mid-step is drawn between two tiles. A finger comes down on
      // what it can see, and where somebody walking is concerned the tile they
      // are anchored to is not it.
      if (covers(this.personBox(walker), x, y)) {
        const at = walker.mover.tile();
        return { target: { kind: 'npc', at, person: i }, goal: at, reach: npcReach };
      }
    }
    for (const item of itemsOn(this.mapId)) {
      if (itemVisible(item) && item.pos[0] === tx && item.pos[1] === ty) {
        return { target: { kind: 'item', at: item.pos, item }, goal: item.pos, reach: REACH.item };
      }
    }
    for (const sign of propSignsOn(this.mapId)) {
      if (sign.pos && sign.pos[0] === tx && sign.pos[1] === ty) {
        return { target: { kind: 'prop', at: sign.pos, sign }, goal: sign.pos, reach: REACH.prop };
      }
    }
    for (const sign of this.map.signs ?? []) {
      if (sign.pos[0] === tx && sign.pos[1] === ty) {
        return { target: { kind: 'prop', at: sign.pos, sign }, goal: sign.pos, reach: REACH.prop };
      }
    }
    for (const fixture of this.fixtures()) {
      if (fixture.pos[0] === tx && fixture.pos[1] === ty) {
        return { target: { kind: 'fixture', at: fixture.pos, fixture }, goal: fixture.pos, reach: REACH.fixture };
      }
    }

    for (const building of this.map.buildings) {
      const plaque = plaqueTile(building);
      if (plaque && plaque[0] === tx && plaque[1] === ty) return this.plaqueTap(building, plaque);
      const board = signBoardTile(building);
      if (board && board[0] === tx && board[1] === ty) return this.signBoardTap(building, board);
    }

    const hit = this.facadeAt(x, y);
    if (hit?.plaque) {
      const plaque = plaqueTile(hit.facade.building);
      if (plaque) return this.plaqueTap(hit.facade.building, plaque);
    }
    for (const building of this.map.buildings) {
      if (building.door[0] === tx && (building.door[1] === ty || building.door[1] - 1 === ty)) {
        return this.doorTap(building, building.interior ? 'enter' : 'sign');
      }
    }
    if (hit) {
      // Tapping the rest of the picture — roof, walls, floating name plate —
      // is tapping the front of the place: walk up and read what it has to
      // say. Once the door only opens, that means the sign board beside it
      // rather than the door itself.
      const board = signBoardTile(hit.facade.building);
      if (board) return this.signBoardTap(hit.facade.building, board);
      return this.doorTap(hit.facade.building, 'sign');
    }
    return null;
  }

  /**
   * Where somebody's sprite actually is, in world pixels: the same sum
   * `updateWalkers` draws them with, so what a tap hits is what is on screen.
   */
  private personBox(walker: Walker): Box {
    return {
      x: Math.round(walker.mover.x * TILE),
      y: Math.round(walker.mover.y * TILE) - TILE,
      w: TILE,
      h: TILE * 2
    };
  }

  private plaqueTap(building: BuildingPlacement, plaque: Vec2): { target: Target; goal: Vec2; reach: number } {
    return {
      target: { kind: 'plaque', at: [plaque[0], plaque[1] - 1], building },
      goal: [plaque[0], plaque[1]],
      reach: REACH.plaque
    };
  }

  /** The front step: where a sign is read from, and where a door is opened. */
  private doorTap(building: BuildingPlacement, kind: 'enter' | 'sign'): { target: Target; goal: Vec2; reach: number } {
    return {
      target: { kind, at: [building.door[0], building.door[1] - 1], building },
      goal: [building.door[0], building.door[1]],
      reach: REACH.door
    };
  }

  /** The sign board beside a door that opens: where its standing sign moved to. */
  private signBoardTap(building: BuildingPlacement, board: Vec2): { target: Target; goal: Vec2; reach: number } {
    return {
      target: { kind: 'sign', at: [board[0], board[1] - 1], building },
      goal: [board[0], board[1]],
      reach: REACH.door
    };
  }

  /**
   * The building whose picture covers this point. A plaque beats a picture,
   * because it is small and deliberate; otherwise the one drawn in front wins,
   * which is the one the player can see.
   */
  private facadeAt(x: number, y: number): { facade: Facade; plaque: boolean } | null {
    let best: { facade: Facade; plaque: boolean } | null = null;
    for (const facade of this.facades) {
      const plaque = facade.plaque !== null && covers(facade.plaque, x, y);
      if (!plaque && !facade.boxes.some((box) => covers(box, x, y))) continue;
      if (best) {
        if (best.plaque && !plaque) continue;
        if (best.plaque === plaque && facade.depth <= best.facade.depth) continue;
      }
      best = { facade, plaque };
    }
    return best;
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
        this.reroute();
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
      const target = this.walkTarget;
      const follow = this.walkFollow;
      if (follow && target) {
        // A hailed person waits, so this is all but always already true. It
        // still costs nothing to check: near enough to say hello is near
        // enough, and otherwise the walk is aimed at them once more.
        const at = follow.mover.tile();
        const me = this.centre();
        if (Math.hypot(me.x - (at[0] + 0.5), me.y - (at[1] + 0.5)) > this.walkReach) {
          this.reaim(follow);
          return moved;
        }
        target.at = at;
        target.person = this.walkers.indexOf(follow);
      }
      this.stopWalk();
      // The arrival press, once, on the very thing that was tapped rather than
      // on whatever happens to be in reach of where the walk ended — tapping a
      // shop front reads its sign even when the walk finishes on its doorstep.
      if (target) this.act(target);
    }
    return moved;
  }

  private stopWalk(): void {
    this.sceneWalk = false;
    this.walkPath = null;
    this.walkGoal = null;
    this.walkTarget = null;
    this.follow(null);
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
    // Every interactable in reach gets the same little bubble — a wall panel
    // or a memorial sign is just as much a thing to press A on as a door or a
    // fixture, and singling props out for silence was what made a room whose
    // walls are all readable look like plain decoration instead.
    if (!target) {
      this.prompt.setVisible(false);
      return;
    }
    const entering = target.kind === 'enter';
    const glyph = entering ? '⌂' : 'A';
    // A one-word verb over the bubble, when the world bothers to write one
    // (`copy.json` ui.enter/ui.read) — "Go in" over a door with an interior,
    // "Read" over everything else the bubble shows for. Either missing means
    // no label at all (hard rule 3); the glyph alone still tells them apart.
    const label = entering ? state.copy.ui.enter : state.copy.ui.read;
    const bob = Math.sin(this.time.now / 167) * 1.5;
    // People are two tiles tall and stand on the tile they occupy, so their
    // head fills the tile above it; props and doors sit inside their own tile.
    const lift = target.kind === 'npc' ? TILE : 0;
    this.prompt.setTexture(promptTexture(this, glyph, label));
    this.prompt.setPosition(target.at[0] * TILE + TILE / 2, target.at[1] * TILE - 2 - lift + bob);
    this.prompt.setVisible(true);
  }

  /** The A button: whatever is in reach, if anything. */
  private interact(): void {
    // A scene gets first refusal: A cuts a `wait` short, and is swallowed
    // while the scene is speaking or walking the player somewhere, so a press
    // meant to hurry a line along never starts a conversation (DESIGN.md §3).
    if (this.runner?.skip()) return;
    // A tapped walk is a promise to arrive. A press part-way there would either
    // strand the player or strike up a conversation with somebody they were
    // only walking past, so A waits until the walk is done — and the walk
    // presses A itself if the tap was on something to read.
    if (this.walkPath) return;
    const target = this.findTarget();
    if (target) this.act(target);
  }

  /** Read it, open it, pick it up or go in. The one place any of that happens. */
  private act(target: Target): void {
    const state = session();
    // The dialogue overlay owns the action button while it is open, and for a
    // beat after it closes, so dismissing a line can never re-trigger a talk.
    if (state.locked || state.dialogueOpen || performance.now() - state.lastDialogueClose < 200) return;

    if (target.kind === 'npc') {
      const walker = this.walkers[target.person ?? 0];
      if (!walker) return;
      // Whoever is spoken to turns to look, and picks their walk back up when
      // the box closes — the mover is held for as long as the player is there.
      const me = this.centre();
      walker.mover.faceToward(me.x, me.y);
      walker.sprite.setFrame(frameIndex(walker.mover.facing, 0));

      const npc = walker.npc;
      if (!npc) {
        // A townsperson with no story to tell: their own standing line, when
        // the world pack gave them one (a barista behind a counter, say), and
        // otherwise one kind passing line from the world's own copy, the same
        // one every time (DESIGN.md §2).
        const own = walker.person?.lines;
        const passing = own?.length ? undefined : this.passerbyLine(walker.id);
        const lines = own?.length ? own : passing ? [passing] : undefined;
        if (!lines) return;
        bus.emit(EV.say, {
          // Their own name if the world pack gave them one, and otherwise the
          // world's word for somebody the player is passing in the street.
          speaker: walker.name || (state.copy.ui.passerbyName ?? ''),
          lines,
          portrait: state.assets.portraits.has(walker.id) ? `art:portrait:${walker.id}` : undefined
        });
        return;
      }
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
        effects: target.item.effects,
        item: target.item.id
      });
      return;
    }

    if (target.kind === 'prop' && target.sign) {
      bus.emit(EV.say, { speaker: state.copy.ui.narrator, lines: target.sign.lines });
      return;
    }

    if (target.kind === 'fixture' && target.fixture) {
      const fixture = target.fixture;

      // The carry verbs (DESIGN.md §2). One fixture hands a token over and
      // another spends it: a split log off the pile, a split log on the fire.
      // The engine never learns what the token is — the world names it, and
      // the world writes both halves of what gets said.
      if (fixture.give || fixture.take) {
        const done = fixture.give ? this.held !== fixture.give : this.held === fixture.take;
        if (done) {
          this.held = fixture.give ? (fixture.give ?? null) : null;
          if (fixture.take) this.lightFixture(fixture);
        }
        const lines = done ? fixture.lines : fixture.otherwise;
        if (lines?.length) bus.emit(EV.say, { speaker: state.copy.ui.narrator, lines });
        return;
      }

      // A fixture with words of its own reads like any other sign.
      if (fixture.lines?.length) {
        bus.emit(EV.say, { speaker: state.copy.ui.narrator, lines: fixture.lines });
        return;
      }

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
      // whoever painted it and offers a way to touch it up; an unpainted one
      // asks, with the way in riding alongside every page rather than taking
      // a line of its own.
      let template = painted ? (credit ? plaque?.painted : plaque?.anonymous) : plaque?.unpainted;
      if (painted) {
        const url = improveUrl(state.world.contribute, building.id);
        if (url && state.copy.ui.improve) link = { url, label: state.copy.ui.improve };
      } else {
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
      const name = state.world.buildings[building.id].name;
      // The episode's sign if it has one, otherwise the building's standing
      // sign from world.json (DESIGN.md §3).
      const lines = signLinesFor(building.id);

      // Nothing about the art joins the words: a sign says what is going on at
      // a place, and meta text in the middle of it gets in the way of reading
      // (DESIGN.md §2/§4). Thanks and invitation both live on the plaque
      // beside the door, so the sign carries no link at all.
      if (!lines.length && !state.assets.buildings.has(building.id)) {
        // With no sign copy of either kind the box would open empty, so one
        // short, kind line stands in for it.
        lines.push(
          state.copy.ui.unpainted.replace('{building}', name).replace('{contribute}', state.world.contribute ?? '')
        );
      }

      if (lines.length) bus.emit(EV.say, { speaker: name, lines });
      return;
    }

    if (target.kind === 'enter' && target.building?.interior && target.building.enter) {
      // The doorstep rule findTarget() keeps too (see armEnters): stepping out
      // of a door and tapping it straight back must not go in again.
      if (!this.enterArmed) return;
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

  /**
   * A road that runs out at the edge of what's mapped (DESIGN.md §2): the
   * map's own `edges` line for this tile if it has one, otherwise the
   * generic `copy.ui.roadEnd` where the tile is a road at the map's edge
   * with no way out. Says its line once per visit — the box stays shown
   * while `edgeShown` matches, and only resets (so it can fire again) once
   * the player has actually stepped off the spot — the same arm/disarm
   * shape `checkExits` uses for its own doorstep rule, standing in for a
   * cooldown without needing a clock.
   */
  private checkEdges(): void {
    const tx = Math.floor((this.px + TILE / 2) / TILE);
    const ty = Math.floor((this.py + TILE / 2) / TILE);
    if (this.exitAt(tx, ty)) {
      this.edgeShown = null;
      return;
    }

    const edge = edgeAt(this.map, tx, ty);
    if (edge) {
      if (this.edgeShown !== edge.id) {
        this.edgeShown = edge.id;
        bus.emit(EV.say, { speaker: session().copy.ui.narrator, lines: edge.lines });
      }
      return;
    }

    const line = roadEndLine(this.map, tx, ty, session().copy.ui.roadEnd);
    if (line) {
      const key = `road-end:${tx},${ty}`;
      if (this.edgeShown !== key) {
        this.edgeShown = key;
        bus.emit(EV.say, { speaker: session().copy.ui.narrator, lines: [line] });
      }
      return;
    }

    this.edgeShown = null;
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
