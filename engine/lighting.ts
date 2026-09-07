import Phaser from 'phaser';
import { TILE } from './tiled';
import type { LightSpec } from './schema';

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
 */

/** Depth: over the town and the people in it, under the A prompt and the HUD. */
const DEPTH = 8800;

/** Seconds for one turn round the whole set of colours, when none is given. */
const DEFAULT_PERIOD = 12;

/** How much slower everything drifts for somebody who asked for less motion. */
const SLOW_FACTOR = 8;

/** The warm evening wash, and how much of it each mood uses. */
const DUSK = 0x3a2418;
const DUSK_ALPHA = { off: 0, dim: 0.34, party: 0.44 };

/** How wide a light disc spreads, in tiles, and how bright its middle sits. */
const DISC_TILES = 7;
const DISC_ALPHA = 0.5;
/** How far the breath moves that brightness either way. Gentle, never a blink. */
const BREATH = 0.09;
/** The floor wash under a party: broad, low, and the same colours. */
const WASH_ALPHA = 0.11;

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
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
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
  describe(): { mode: LightSpec['mode']; spots: number } {
    return { mode: this.mode, spots: this.discs.length };
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
      .rectangle(0, 0, w, h, DUSK, DUSK_ALPHA[mode])
      .setOrigin(0, 0)
      .setDepth(DEPTH)
      .setScrollFactor(1);

    if (mode !== 'party') return;

    // A low wash of colour across the floor, so the room is in on it and not
    // only the few tiles with a lamp over them.
    this.floor = this.scene.add
      .rectangle(0, 0, w, h, this.colours[0], WASH_ALPHA)
      .setOrigin(0, 0)
      .setDepth(DEPTH + 1)
      .setBlendMode(Phaser.BlendModes.ADD);

    const key = discTexture(this.scene);
    const size = DISC_TILES * TILE;
    for (const at of spec?.at ?? []) {
      const spot = this.scene.add
        .image((at[0] + 0.5) * TILE - size / 2, (at[1] + 0.5) * TILE - size / 2, key)
        .setOrigin(0, 0)
        .setDepth(DEPTH + 2)
        .setBlendMode(Phaser.BlendModes.ADD)
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

    this.floor?.setFillStyle(at(0.5), WASH_ALPHA);
    this.discs.forEach((disc, index) => {
      const offset = index / Math.max(1, this.discs.length);
      disc.setTint(at(offset));
      // A slow breath, a tenth of the brightness either way. Never a blink.
      disc.setAlpha(DISC_ALPHA + Math.sin((this.clock + offset) * Math.PI * 2) * BREATH);
    });
  }

  /** Back to plain daylight. Called on a map change unless the scene kept it. */
  clear(): void {
    this.wash?.destroy();
    this.floor?.destroy();
    for (const disc of this.discs) disc.destroy();
    this.wash = null;
    this.floor = null;
    this.discs = [];
    this.mode = 'off';
  }
}
