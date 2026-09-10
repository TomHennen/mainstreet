import Phaser from 'phaser';
import { dashTexture } from '../art';
import { session } from '../session';
import type { Facing, Vec2 } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const FADE = 300;
/** The prototype's rolling road: 24px of dash pattern per second. */
const DASH_SPEED = 0.024;

export interface TravelData {
  style: 'road' | 'door';
  big: string;
  small: string;
  to: string;
  spawn: Vec2;
  facing: Facing;
  /** How long the card sits on screen; the caller knows which way we're going. */
  hold?: number;
  /**
   * This trip is a `lost` reset (DESIGN.md §2), landing the player back on a
   * map by the woods rather than through an ordinary exit or door — passed
   * through explicitly rather than inferred on the far side, so the map
   * scene knows to stage `lost.arrive`, if there is one, instead of simply
   * setting the player down.
   */
  arrive?: boolean;
}

/**
 * The interstitial that covers every map swap: a village crossing gets the long
 * arrival card, a doorway a short threshold cut. The rolling road runs on both.
 */
export class TravelScene extends Phaser.Scene {
  private travel!: TravelData;
  private cover: Phaser.GameObjects.Rectangle | null = null;
  private big: Phaser.GameObjects.Text | null = null;
  private small: Phaser.GameObjects.Text | null = null;
  private dashes: Phaser.GameObjects.TileSprite | null = null;

  constructor() {
    super('Travel');
  }

  init(data: TravelData): void {
    this.travel = data;
  }

  create(): void {
    const hold = this.travel.hold ?? (this.travel.style === 'road' ? 900 : 500);

    this.cover = this.add.rectangle(0, 0, 10, 10, 0x12160f).setOrigin(0, 0).setAlpha(0);
    this.big = this.add
      .text(0, 0, this.travel.big, {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#f3ead8',
        fontStyle: 'bold'
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.small = this.add
      .text(0, 0, this.travel.small, {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#f3ead8',
        align: 'center'
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.dashes = this.add.tileSprite(0, 0, 120, 6, dashTexture(this)).setAlpha(0);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.dashes = null;
    });

    const all = [this.cover, this.big, this.small, this.dashes];

    // Fade the whole card in, swap the map underneath, hold, fade out.
    this.tweens.add({
      targets: all,
      alpha: 1,
      duration: FADE,
      onComplete: () => {
        // launch, not start: start would stop Travel too and strand this tween
        // chain, leaving the session locked forever.
        this.scene.launch('Map', {
          mapId: this.travel.to,
          pos: this.travel.spawn,
          facing: this.travel.facing,
          arrive: this.travel.arrive
        });
        this.scene.bringToTop('Travel');
        this.scene.bringToTop('Ui');

        this.time.delayedCall(hold, () => {
          this.tweens.add({
            targets: all,
            alpha: 0,
            duration: FADE,
            onComplete: () => {
              this.dashes = null;
              session().locked = false;
              this.scene.stop();
            }
          });
        });
      }
    });
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    this.cover?.setSize(width, height);
    this.big?.setPosition(width / 2, height / 2 - 26);
    this.small?.setPosition(width / 2, height / 2 + 26);
    this.small?.setWordWrapWidth(Math.min(400, width - 40), true);
    this.dashes?.setPosition(width / 2, height / 2);
  }

  update(_time: number, delta: number): void {
    if (this.dashes) this.dashes.tilePositionX += delta * DASH_SPEED;
  }
}
