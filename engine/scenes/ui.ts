import Phaser from 'phaser';
import { bus, EV } from '../bus';
import { itemTexture } from '../art';
import { noteDialogue, noteToast } from '../debug';
import type { SayRequest } from '../bus';
import { isMailto } from '../feedback';
import { withYou } from '../inventory';
import type { Entry } from '../inventory';
import { onAction, onTap, onToggle } from '../input';
import { autosave } from '../progress';
import { session } from '../session';
import type { Effect } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const PAPER = 0xf3ead8;
const INK = 0x2a231a;
const PORTRAIT = 64;
/** The "with you" panel's placeholder swatch, one tile square, beside each entry's name. */
const SWATCH = 16;
/**
 * Rows the panel keeps ready to fill in. "With you" is meant to stay a
 * glance, not a list to scroll — plenty for what an episode carries at once,
 * and if a later one somehow needs more, the extras simply don't draw
 * (nothing crashes; the panel just shows the first eight).
 */
const INV_ROWS_MAX = 8;

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

  // --- the "with you" panel (DESIGN.md §2, engine/inventory.ts) --------------
  private invBox!: Phaser.GameObjects.Graphics;
  private invTitle!: Phaser.GameObjects.Text;
  private invEmpty!: Phaser.GameObjects.Text;
  private invRows: { swatch: Phaser.GameObjects.Image; name: Phaser.GameObjects.Text; blurb: Phaser.GameObjects.Text }[] =
    [];
  private invOpen = false;
  /** Set once at boot from `copy.ui.withYou.button` — no label, no feature (hard rule 3). */
  private invEnabled = false;
  private invEntries: Entry[] = [];
  private invBtn: HTMLButtonElement | null = null;

  private lines: string[] = [];
  private index = 0;
  private pendingEffects: Effect[] | undefined;
  private pendingItem: string | undefined;
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

    // The panel: same paper-and-ink chrome as the say box, and it shares the
    // box's own bottom-docked spot — the two are never open at once, so
    // there is nothing to collide with there.
    this.invBox = this.add.graphics().setDepth(10).setVisible(false);
    this.invTitle = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#b5542a', fontStyle: 'bold' })
      .setDepth(12)
      .setVisible(false);
    this.invEmpty = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#2a231a' })
      .setDepth(12)
      .setVisible(false);
    for (let i = 0; i < INV_ROWS_MAX; i++) {
      const swatch = this.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setDepth(12).setVisible(false);
      const name = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#2a231a', fontStyle: 'bold' })
        .setDepth(12)
        .setVisible(false);
      const blurb = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#2a231a' })
        .setDepth(12)
        .setVisible(false);
      this.invRows.push({ swatch, name, blurb });
    }

    this.invEnabled = Boolean(session().copy.ui.withYou?.button);
    this.invBtn = document.querySelector<HTMLButtonElement>('[data-overlay="withyou"]');
    if (this.invBtn && this.invEnabled) {
      this.invBtn.textContent = session().copy.ui.withYou!.button!;
    }
    const onBtnClick = () => this.toggleInventory();
    this.invBtn?.addEventListener('click', onBtnClick);

    this.setOpen(false);

    bus.on(EV.say, this.say, this);
    bus.on(EV.toast, this.toast, this);
    const unbind = onAction(() => this.advance());
    // Two more `onAction`/`onTap` listeners, alongside the ones above: each
    // guards on the panel's own `invOpen` and no-ops otherwise, so A still
    // reaches `advance()` untouched while the say box is what's open, and a
    // stray tap still reaches `MapScene.tap()` (which itself no-ops while
    // `dialogueOpen`) untouched while the panel is what's open.
    const unbindInvAction = onAction(() => this.closeInventory());
    const unbindInvTap = onTap(() => this.closeInventory());
    const unbindToggle = onToggle(() => this.toggleInventory());
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.say, this.say, this);
      bus.off(EV.toast, this.toast, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.hideLink();
      unbind();
      unbindInvAction();
      unbindInvTap();
      unbindToggle();
      this.invBtn?.removeEventListener('click', onBtnClick);
      if (this.invBtn) this.invBtn.hidden = true;
    });
  }

  private say(request: SayRequest): void {
    // The panel never sits under a say box (see `toggleInventory`, below,
    // which refuses to open one over the other); this is the belt-and-braces
    // side of that, in case something the player didn't do — a scene, say —
    // ever tries to talk while it's up.
    if (this.invOpen) this.setInvOpen(false);
    this.lines = request.lines;
    this.index = 0;
    this.pendingEffects = request.effects;
    this.pendingItem = request.item;
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
    const item = this.pendingItem;
    this.pendingEffects = undefined;
    this.pendingItem = undefined;
    this.setOpen(false);
    if (item) session().taken.add(item);
    session().flags.apply(effects);
    // Anything that changed the state of the story is worth remembering: a
    // flag set, a thing picked up, the line that finishes the episode
    // (DESIGN.md §2). One write, on the beat the box closes.
    if (effects?.length || item) autosave();
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

  // --- the "with you" panel ---------------------------------------------------

  /**
   * The HUD button and the "i" key both call this (DESIGN.md §2): open when
   * closed, close when open. Opening is refused outright while a say box is
   * up or a scene is running — `state.dialogueOpen` covers both the say box
   * and (once this returns) the panel itself, so the two can never stack.
   */
  private toggleInventory(): void {
    if (!this.invEnabled) return;
    if (this.invOpen) {
      this.setInvOpen(false);
      return;
    }
    const state = session();
    if (state.locked || state.dialogueOpen) return;
    this.setInvOpen(true);
  }

  /** What a tap anywhere, or A, does to the panel: close it if it's open, nothing otherwise. */
  private closeInventory(): void {
    if (this.invOpen) this.setInvOpen(false);
  }

  private setInvOpen(open: boolean): void {
    this.invOpen = open;
    const state = session();
    // Pauses walking exactly like the say box (`setOpen`, above) — and
    // MapScene's own `tap()`/`act()` already stand down while this is true,
    // which is what keeps a tap meant to close the panel from also starting
    // a walk underneath it.
    state.dialogueOpen = open;
    if (!open) state.lastDialogueClose = performance.now();
    this.invEntries = open ? withYou(state) : [];
    this.layout();
  }

  private toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastBg.setVisible(true);
    if (import.meta.env.DEV) noteToast(message);
    this.layout();
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(3800, () => {
      this.toastText.setVisible(false);
      this.toastBg.setVisible(false);
      if (import.meta.env.DEV) noteToast(null);
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
    // A page opens in a new tab, keeping the game's own tab where the player
    // left it (see isMailto's doc); a mailto hands off to the mail app, and
    // target="_blank" there just leaves a stray blank tab behind.
    if (isMailto(link.url)) {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    } else {
      el.target = '_blank';
      el.rel = 'noopener';
    }
    // The title screen positions this same anchor from the top left; a stale
    // left/top alongside a right/bottom would stretch it across the stage.
    el.style.left = 'auto';
    el.style.top = 'auto';
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

    if (this.invOpen) {
      this.layoutInventory(width, height);
    } else {
      this.invBox.setVisible(false);
      this.invTitle.setVisible(false);
      this.invEmpty.setVisible(false);
      for (const row of this.invRows) {
        row.swatch.setVisible(false);
        row.name.setVisible(false);
        row.blurb.setVisible(false);
      }
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

  /**
   * The panel's own layout: same paper box, bottom-docked, as the say box —
   * they never show at once, so sharing the spot costs nothing. Title, then
   * either the empty line or one row per entry (name, and a blurb under it
   * when the entry has one), each with the same placeholder swatch the
   * ground uses for a picked-up-able item (`itemTexture`, engine/art.ts) —
   * there is no per-item sprite convention yet, so every entry draws the
   * same one.
   */
  private layoutInventory(width: number, height: number): void {
    const margin = 8;
    const left = margin;
    const boxW = width - margin * 2;
    const textLeft = left + 14;
    const wrapWidth = boxW - 28;
    const rowTextWidth = wrapWidth - SWATCH - 8;
    const copy = session().copy.ui.withYou;
    const titleStr = copy?.title;
    const showEmpty = this.invEntries.length === 0;
    const emptyStr = showEmpty ? copy?.empty : undefined;
    const entries = this.invEntries.slice(0, INV_ROWS_MAX);

    this.invTitle.setWordWrapWidth(wrapWidth, true).setText(titleStr ?? '').setVisible(Boolean(titleStr));
    this.invEmpty.setWordWrapWidth(wrapWidth, true).setText(emptyStr ?? '').setVisible(Boolean(emptyStr));

    // Measure every row before any of them is placed — the same
    // measure-then-draw order the say box uses, so the box grows to fit a
    // long blurb on a narrow phone instead of clipping it.
    const rowHeights: number[] = [];
    this.invRows.forEach((row, i) => {
      const entry = entries[i];
      if (!entry || showEmpty) {
        row.swatch.setVisible(false);
        row.name.setVisible(false);
        row.blurb.setVisible(false);
        return;
      }
      row.swatch.setTexture(itemTexture(this)).setVisible(true);
      row.name.setWordWrapWidth(rowTextWidth, true).setText(entry.name).setVisible(true);
      row.blurb.setWordWrapWidth(rowTextWidth, true).setText(entry.blurb ?? '').setVisible(Boolean(entry.blurb));
      rowHeights.push(Math.max(SWATCH, row.name.height + (entry.blurb ? row.blurb.height + 2 : 0)));
    });

    let contentH = titleStr ? this.invTitle.height + 10 : 0;
    contentH += showEmpty ? this.invEmpty.height : rowHeights.reduce((sum, h, i) => sum + h + (i ? 10 : 0), 0);

    const boxH = Math.max(90, 20 + contentH + 20);
    const top = height - boxH - margin;

    this.invBox.setVisible(true).clear();
    this.invBox.fillStyle(0x000000, 0.4);
    this.invBox.fillRect(left + 4, top + 4, boxW, boxH);
    this.invBox.fillStyle(PAPER, 1);
    this.invBox.fillRect(left, top, boxW, boxH);
    this.invBox.lineStyle(3, INK, 1);
    this.invBox.strokeRect(left + 1.5, top + 1.5, boxW - 3, boxH - 3);

    let y = top + 12;
    if (titleStr) {
      this.invTitle.setPosition(textLeft, y);
      y += this.invTitle.height + 10;
    }
    if (showEmpty) {
      this.invEmpty.setPosition(textLeft, y);
      return;
    }
    let rowIndex = 0;
    this.invRows.forEach((row, i) => {
      if (!entries[i]) return;
      row.swatch.setPosition(textLeft, y);
      row.name.setPosition(textLeft + SWATCH + 8, y);
      row.blurb.setPosition(textLeft + SWATCH + 8, y + row.name.height + 2);
      y += rowHeights[rowIndex] + 10;
      rowIndex += 1;
    });
  }

  /**
   * The HUD button hides itself, rather than being disabled, whenever there
   * is nothing it could sensibly open right now: over a say box, or while a
   * scene holds the input. `invOpen` is exempted from the say-box half of
   * that so the button stays put — and tappable — as a second way to close
   * the very panel it opened.
   */
  update(): void {
    if (!this.invEnabled || !this.invBtn) return;
    const state = session();
    const sayShowing = state.dialogueOpen && !this.invOpen;
    this.invBtn.hidden = sayShowing || state.locked;
  }
}
