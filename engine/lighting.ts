import Phaser from 'phaser';
import { TILE } from './tiled';
import type { LightSpec, Vec2 } from './schema';

/**
 * The lights (DESIGN.md §3). Engine-drawn from a mood and a few colours, so a
 * world pack asks for an evening or a party rather than shipping an asset
 * (CLAUDE.md hard rule 3), and nothing in here knows what building it is
 * lighting (hard rule 1).
 *
 * Two moods. `dim` is one warm translucent wash over the whole map — the sun
 * gone down behind the ridge, everything still perfectly readable underneath.
 * `party` is that plus a few soft coloured discs hanging over the tiles the
 * episode listed, and a gentle wash of the same colours across the floor.
 *
 * **There is no strobe anywhere in here, by Tom's call.** The colours cross-
 * fade from one to the next over a whole `period`, and the only other movement
 * is a slow breath in the discs' brightness. A device asking for reduced
 * motion slows the lot to a crawl (`SLOW_FACTOR`), and it is still a party.
 *
 * `glow` is the third, smaller thing in here and belongs to neither mood: one
 * warm light over one tile, for a while, with no wash under it — a fire
 * somebody has just put a log on (DESIGN.md §2). It can burn during a party,
 * during an evening or in plain daylight, and it goes out on its own.
 */

/** Depth: over the town and the people in it, under the A prompt and the HUD. */
const DEPTH = 8800;

/** Seconds for one turn round the whole set of colours, when none is given. */
const DEFAULT_PERIOD = 12;

/** How much slower everything drifts for somebody who asked for less motion. */
const SLOW_FACTOR = 8;

/**
 * The wash each mood lays over the map, and how much of it. Evening outdoors
 * is warm — the sun off behind the ridge; a room with the party lights on goes
 * a shade cooler and deeper, which is what lets the colours in it read as
 * colours rather than as more of the same brown.
 */
const WASH = { off: 0x000000, dim: 0x3a2418, party: 0x1e1233 };
const WASH_OPACITY = { off: 0, dim: 0.4, party: 0.5 };

/** How wide a light disc spreads, in tiles, and how bright its middle sits. */
const DISC_TILES = 6;
const DISC_ALPHA = 0.8;
/** How far the breath moves that brightness either way. Gentle, never a blink. */
const BREATH = 0.08;
/** The floor wash under a party: broad, low, and the same colours. */
const FLOOR_ALPHA = 0.1;

/** A `glow`: how wide it spreads, how bright it sits, and how long it fades. */
const GLOW_TILES = 5;
const GLOW_ALPHA = 0.5;
const GLOW_FADE = 6;
/** The colour of one. Firelight, and the only colour a glow is. */
const GLOW_COLOUR = '#f0a83a';
/** Seconds for one breath in and out of a glow. Slow, and never a flicker. */
const GLOW_BREATH = 5;

/** Colours to cycle when an episode names none — warm first, and kind. */
const DEFAULT_COLOURS = ['#d9a441', '#b5542a', '#9a7bb5', '#4a7f96'];

const hex = (colour: string): number => Phaser.Display.Color.HexStringToColor(colour).color;

/**
 * A soft round light, drawn once and tinted per lamp. White in the middle
 * fading to nothing at the rim, so an additive blend leaves a glow rather than
 * a disc with an edge on it.
 */
function discTexture(scene: Phaser.Scene): string {
  const key = 'light:disc';
  if (scene.textures.exists(key)) return key;
  const size = DISC_TILES * TILE;
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) throw new Error('could not create the light texture');
  const ctx = texture.getContext();
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Softer in the middle than a plain white core, so the tint on it reads as
  // a colour rather than blowing out to white.
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.refresh();
  return key;
}

/** True when this device would rather things held still. */
function reduceMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class Lighting {
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;

  private wash: Phaser.GameObjects.Rectangle | null = null;
  private floor: Phaser.GameObjects.Rectangle | null = null;
  private discs: Phaser.GameObjects.Image[] = [];

  /** The warm one-tile lights burning right now, each with its time left. */
  private glows: { image: Phaser.GameObjects.Image; left: number; span: number; clock: number }[] = [];

  private colours: number[] = [];
  private period = DEFAULT_PERIOD;
  private clock = 0;
  private mode: LightSpec['mode'] = 'off';

  /** Map size in tiles. */
  constructor(scene: Phaser.Scene, width: number, height: number) {
    this.scene = scene;
    this.width = width;
    this.height = height;
  }

  get lit(): boolean {
    return this.mode !== 'off';
  }

  /** For the playtest harness: what is lit, and how much of it there is. */
  describe(): { mode: LightSpec['mode']; spots: number; glows: number } {
    return { mode: this.mode, spots: this.discs.length, glows: this.glows.length };
  }

  /**
   * One warm light over one tile for `seconds`, on top of whatever mood is
   * running and outliving nothing but itself. A second glow on a tile that
   * already has one simply tops it back up rather than stacking, so feeding
   * the fire twice does not make it twice as bright.
   */
  glow(at: Vec2, seconds: number): void {
    if (!(seconds > 0)) return;
    const size = GLOW_TILES * TILE;
    const x = (at[0] + 0.5) * TILE - size / 2;
    const y = (at[1] + 0.5) * TILE - size / 2;
    const already = this.glows.find((one) => one.image.x === x && one.image.y === y);
    if (already) {
      already.left = Math.max(already.left, seconds);
      already.span = already.left;
      return;
    }
    const image = this.scene.add
      .image(x, y, discTexture(this.scene))
      .setOrigin(0, 0)
      .setDepth(DEPTH + 3)
      .setAlpha(GLOW_ALPHA)
      .setTint(hex(GLOW_COLOUR));
    this.glows.push({ image, left: seconds, span: seconds, clock: 0 });
  }

  apply(spec: LightSpec | null): void {
    this.clear();
    const mode = spec?.mode ?? 'off';
    this.mode = mode;
    if (mode === 'off') return;

    const w = this.width * TILE;
    const h = this.height * TILE;
    this.colours = (spec?.colours?.length ? spec.colours : DEFAULT_COLOURS).map(hex);
    this.period = Math.max(1, spec?.period ?? DEFAULT_PERIOD) * (reduceMotion() ? SLOW_FACTOR : 1);
    this.clock = 0;

    // The evening itself: one warm wash over the whole map, and everything
    // underneath still perfectly readable.
    this.wash = this.scene.add
      .rectangle(0, 0, w, h, WASH[mode], WASH_OPACITY[mode])
      .setOrigin(0, 0)
      .setDepth(DEPTH)
      .setScrollFactor(1);

    if (mode !== 'party') return;

    // A low wash of colour across the floor, so the room is in on it and not
    // only the few tiles with a lamp over them.
    // Colour laid over the dusk rather than added to the floor: the ground in
    // this world is pale, and anything additive on pale ground goes white
    // before it goes colourful. A gel over an evening reads as light.
    this.floor = this.scene.add
      .rectangle(0, 0, w, h, this.colours[0], FLOOR_ALPHA)
      .setOrigin(0, 0)
      .setDepth(DEPTH + 1);

    const key = discTexture(this.scene);
    const size = DISC_TILES * TILE;
    for (const at of spec?.at ?? []) {
      const spot = this.scene.add
        .image((at[0] + 0.5) * TILE - size / 2, (at[1] + 0.5) * TILE - size / 2, key)
        .setOrigin(0, 0)
        .setDepth(DEPTH + 2)
        .setAlpha(DISC_ALPHA);
      this.discs.push(spot);
    }
    // Paint the first frame's colours now, so nothing is ever white for a beat.
    this.update(0);
  }

  /**
   * One frame of drift. Each lamp sits a little further round the set of
   * colours than the one before it, so the room reads as several lights rather
   * than one, and every one of them crosses smoothly from colour to colour —
   * there is no frame on which anything jumps.
   */
  update(dt: number): void {
    this.burn(dt);
    if (this.mode !== 'party' || !this.colours.length) return;
    this.clock = (this.clock + dt / this.period) % 1;

    const at = (offset: number): number => {
      const turn = ((this.clock + offset) % 1) * this.colours.length;
      const index = Math.floor(turn);
      const from = Phaser.Display.Color.IntegerToColor(this.colours[index % this.colours.length]);
      const to = Phaser.Display.Color.IntegerToColor(this.colours[(index + 1) % this.colours.length]);
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, Math.round((turn % 1) * 100));
      return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b);
    };

    this.floor?.setFillStyle(at(0.5), FLOOR_ALPHA);
    this.discs.forEach((disc, index) => {
      const offset = index / Math.max(1, this.discs.length);
      disc.setTint(at(offset));
      // A slow breath, a tenth of the brightness either way. Never a blink.
      disc.setAlpha(DISC_ALPHA + Math.sin((this.clock + offset) * Math.PI * 2) * BREATH);
    });
  }

  /**
   * The glows, counting down. Each one breathes as gently as a disc does and
   * fades out over its last few seconds rather than switching off, so a fire
   * dying back never reads as a light being turned off.
   */
  private burn(dt: number): void {
    if (!this.glows.length) return;
    const slow = reduceMotion() ? SLOW_FACTOR : 1;
    for (const one of this.glows) {
      one.left -= dt;
      one.clock += dt / (GLOW_BREATH * slow);
      const fade = Math.min(1, Math.max(0, one.left) / Math.min(GLOW_FADE, one.span));
      const breath = Math.sin(one.clock * Math.PI * 2) * BREATH;
      one.image.setAlpha(Math.max(0, (GLOW_ALPHA + breath) * fade));
    }
    for (const one of this.glows) if (one.left <= 0) one.image.destroy();
    this.glows = this.glows.filter((one) => one.left > 0);
  }

  /** Back to plain daylight. Called on a map change unless the scene kept it. */
  clear(): void {
    this.wash?.destroy();
    this.floor?.destroy();
    for (const disc of this.discs) disc.destroy();
    for (const one of this.glows) one.image.destroy();
    this.wash = null;
    this.floor = null;
    this.discs = [];
    this.glows = [];
    this.mode = 'off';
  }
}
