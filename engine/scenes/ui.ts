import Phaser from 'phaser';
import { bus, EV } from '../bus';
import { noteDialogue } from '../debug';
import type { SayRequest } from '../bus';
import { onAction } from '../input';
import { session } from '../session';
import type { Effect } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const PAPER = 0xf3ead8;
const INK = 0x2a231a;
const PORTRAIT = 64;

/**
 * Dialogue and toasts, drawn over whatever scene is running. Kept at zoom 1 so
 * body text stays readable while the world is scaled up.
 */
export class UiScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Graphics;
  private speaker!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image;
  private toastBg!: Phaser.GameObjects.Graphics;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;

  private lines: string[] = [];
  private index = 0;
  private pendingEffects: Effect[] | undefined;
  private open = false;
  /**
   * The one DOM control drawn over the canvas: a real anchor, so it is
   * tappable, focusable and openable in a new tab by the browser rather than
   * by us. It lives in index.html empty; only its href and label come from
   * world data (CLAUDE.md hard rule 1).
   */
  private linkEl: HTMLAnchorElement | null = null;
  private link: SayRequest['link'];

  constructor() {
    super('Ui');
  }

  create(): void {
    this.linkEl = document.querySelector<HTMLAnchorElement>('a[data-overlay="link"]');
    this.box = this.add.graphics().setDepth(10);
    this.portrait = this.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(11).setVisible(false);
    this.speaker = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#b5542a' }).setDepth(12);
    this.body = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: '#2a231a' }).setDepth(12);
    this.more = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#2a231a' }).setDepth(12);

    this.toastBg = this.add.graphics().setDepth(20).setVisible(false);
    this.toastText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#f3ead8' })
      .setOrigin(0.5, 0)
      .setDepth(21)
      .setVisible(false);

    this.tweens.add({ targets: this.more, alpha: 0.15, duration: 520, yoyo: true, repeat: -1 });

    this.setOpen(false);

    bus.on(EV.say, this.say, this);
    bus.on(EV.toast, this.toast, this);
    const unbind = onAction(() => this.advance());
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.say, this.say, this);
      bus.off(EV.toast, this.toast, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.hideLink();
      unbind();
    });
  }

  private say(request: SayRequest): void {
    this.lines = request.lines;
    this.index = 0;
    this.pendingEffects = request.effects;
    this.link = request.link;
    this.speaker.setText(request.speaker);

    const hasPortrait = Boolean(request.portrait && this.textures.exists(request.portrait));
    if (hasPortrait && request.portrait) {
      this.portrait.setTexture(request.portrait);
      this.portrait.setDisplaySize(PORTRAIT, PORTRAIT);
    }
    this.portrait.setVisible(hasPortrait);

    this.setOpen(true);
    this.layout();
  }

  private advance(): void {
    if (!this.open) return;
    this.index += 1;
    if (this.index < this.lines.length) {
      this.layout();
      return;
    }
    // Effects land when the whole entry has been read (DESIGN.md §3).
    const effects = this.pendingEffects;
    this.pendingEffects = undefined;
    this.setOpen(false);
    session().flags.apply(effects);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    const state = session();
    state.dialogueOpen = open;
    if (!open) state.lastDialogueClose = performance.now();

    // Lets the DOM tap handler advance dialogue without ever triggering a talk.
    if (open) document.body.dataset.dialogue = 'open';
    else delete document.body.dataset.dialogue;

    this.box.setVisible(open);
    this.speaker.setVisible(open);
    this.body.setVisible(open);
    this.more.setVisible(open);
    if (!open) {
      this.portrait.setVisible(false);
      this.link = undefined;
      this.hideLink();
      if (import.meta.env.DEV) noteDialogue(null);
    }
  }

  private toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastBg.setVisible(true);
    this.layout();
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(3800, () => {
      this.toastText.setVisible(false);
      this.toastBg.setVisible(false);
    });
  }

  private hideLink(): void {
    const el = this.linkEl;
    if (!el || el.hidden) return;
    // Focus would otherwise sit on an element nobody can see, and the next
    // Enter would re-open the link instead of advancing the dialogue.
    if (document.activeElement === el) el.blur();
    el.hidden = true;
  }

  /**
   * Sits just above the dialogue box, flush with its right edge, so it never
   * covers the text or the advance hint — on any page, at any box height.
   * Positioned in CSS pixels against #stage, which the UI scene matches
   * one-to-one (zoom 1). A link with no `line` stays up for the whole entry.
   */
  private layoutLink(boxTop: number, boxRight: number, stageHeight: number): void {
    const el = this.linkEl;
    if (!el) return;
    const link = this.link;
    if (!this.open || !link || (link.line !== undefined && this.index !== link.line)) {
      this.hideLink();
      return;
    }
    el.href = link.url;
    el.textContent = link.label;
    el.style.right = `${Math.round(boxRight)}px`;
    el.style.bottom = `${Math.round(stageHeight - boxTop + 6)}px`;
    el.hidden = false;
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;

    if (this.open) {
      const margin = 8;
      const left = margin;
      const boxW = width - margin * 2;

      const hasPortrait = this.portrait.visible;
      const textLeft = left + (hasPortrait ? PORTRAIT + 24 : 14);

      // Wrap and measure before drawing: a narrow phone turns one line into
      // four, and the box has to grow under it rather than let it spill.
      this.body.setWordWrapWidth(left + boxW - textLeft - 14, true);
      this.body.setText(this.lines[this.index] ?? '');
      if (import.meta.env.DEV) {
        noteDialogue({
          speaker: this.speaker.text,
          page: this.index,
          pages: this.lines.length,
          text: this.lines[this.index] ?? ''
        });
      }
      const boxH = Math.max(104, 28 + this.body.height + 26);
      const top = height - boxH - margin;

      this.box.clear();
      this.box.fillStyle(0x000000, 0.4);
      this.box.fillRect(left + 4, top + 4, boxW, boxH);
      this.box.fillStyle(PAPER, 1);
      this.box.fillRect(left, top, boxW, boxH);
      this.box.lineStyle(3, INK, 1);
      this.box.strokeRect(left + 1.5, top + 1.5, boxW - 3, boxH - 3);

      if (hasPortrait) {
        this.portrait.setPosition(left + 10, top + 10);
        this.box.lineStyle(2, INK, 1);
        this.box.strokeRect(left + 9, top + 9, PORTRAIT + 2, PORTRAIT + 2);
      }

      this.speaker.setPosition(textLeft, top + 10);
      this.body.setPosition(textLeft, top + 28);

      this.more.setText(session().copy.ui.advance);
      this.more.setPosition(left + boxW - this.more.width - 12, top + boxH - 18);

      this.layoutLink(top, width - (left + boxW), height);
    }

    if (this.toastText.visible) {
      const w = this.toastText.width + 24;
      const x = width / 2;
      this.toastText.setPosition(x, 16);
      this.toastBg.clear();
      this.toastBg.fillStyle(INK, 1);
      this.toastBg.fillRect(x - w / 2, 10, w, this.toastText.height + 12);
      this.toastBg.lineStyle(2, PAPER, 1);
      this.toastBg.strokeRect(x - w / 2, 10, w, this.toastText.height + 12);
    }
  }
}
