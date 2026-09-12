import Phaser from 'phaser';
import { bus, EV } from '../bus';
import { noteDialogue, noteInventory, noteToast } from '../debug';
import type { SayRequest } from '../bus';
import { isMailto } from '../feedback';
import { withYou } from '../inventory';
import type { Entry } from '../inventory';
import { onAction, onToggle } from '../input';
import { autosave } from '../progress';
import { scaled } from '../timescale';
import { session } from '../session';
import type { Effect } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const PAPER = 0xf3ead8;
const INK = 0x2a231a;
const PORTRAIT = 64;
/** How long a toast stays up. `session().toastUntil` is this, from the moment one is raised — the one thing (engine/scenes/map.ts's holler) that ever asks. */
export const TOAST_MS = 3800;

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
  /**
   * One name/blurb pair of Text objects per row on screen, grown on demand
   * (`ensureInvRows`) rather than pre-allocated to some cap — "with you" is
   * not an inventory, so there is no slot count to reserve or run out of.
   */
  private invRows: { name: Phaser.GameObjects.Text; blurb: Phaser.GameObjects.Text }[] = [];
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

    this.invEnabled = Boolean(session().copy.ui.withYou?.button);
    this.invBtn = document.querySelector<HTMLButtonElement>('[data-overlay="withyou"]');
    if (this.invBtn && this.invEnabled) {
      this.invBtn.textContent = session().copy.ui.withYou!.button!;
    }
    const onBtnClick = () => {
      this.toggleInventory();
      // Otherwise the button keeps focus after a click, and `bindControls`
      // (engine/input.ts) leaves every key dead — it treats a focused overlay
      // element as mid-use — until the canvas is clicked back into.
      this.invBtn?.blur();
    };
    this.invBtn?.addEventListener('click', onBtnClick);

    this.setOpen(false);

    bus.on(EV.say, this.say, this);
    bus.on(EV.toast, this.toast, this);
    const unbind = onAction(() => this.advance());
    // One more `onAction` listener, alongside the one above: it guards on the
    // panel's own `invOpen` and no-ops otherwise, so A still reaches
    // `advance()` untouched while the say box is what's open. There is no
    // `onTap` listener to go with it — the panel sets
    // `document.body.dataset.dialogue` itself while it's open (`setInvOpen`,
    // below), exactly as the say box does, so a stage press already arrives
    // here as `fireAction` (engine/input.ts) rather than a tap, and a tap
    // never reaches `MapScene.tap()` to start a walk underneath it.
    const unbindInvAction = onAction(() => this.closeInventory());
    const unbindToggle = onToggle(() => this.toggleInventory());
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(EV.say, this.say, this);
      bus.off(EV.toast, this.toast, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.hideLink();
      // So `dialogueOpen`/`document.body.dataset.dialogue` cannot survive a
      // shutdown mid-panel and strand the next scene thinking input is held.
      this.setInvOpen(false);
      unbind();
      unbindInvAction();
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
   * up (`state.dialogueOpen` — once this returns, that's also what the panel
   * itself sets, so the two can never stack) or while `state.locked` (the
   * travel interstitial) or `state.sceneRunning` (a staged scene, DESIGN.md
   * §3 — set for its whole run, not just the beats it has a box open for, so
   * the panel can't slip in between them).
   */
  private toggleInventory(): void {
    if (!this.invEnabled) return;
    if (this.invOpen) {
      this.setInvOpen(false);
      return;
    }
    const state = session();
    if (state.locked || state.dialogueOpen || state.sceneRunning) return;
    this.setInvOpen(true);
  }

  /** What a tap anywhere, or A, does to the panel: close it if it's open, nothing otherwise. */
  private closeInventory(): void {
    if (this.invOpen) this.setInvOpen(false);
  }

  private setInvOpen(open: boolean): void {
    this.invOpen = open;
    const state = session();
    // Pauses walking exactly like the say box (`setOpen`, above), and for the
    // same two reasons: `state.dialogueOpen` is what `MapScene` reads
    // everywhere to stand down, and `document.body.dataset.dialogue` is what
    // lets a stage press reach `fireAction` (and so `closeInventory`, above)
    // instead of `MapScene.tap()` (engine/input.ts).
    state.dialogueOpen = open;
    if (!open) state.lastDialogueClose = performance.now();
    if (open) document.body.dataset.dialogue = 'open';
    else delete document.body.dataset.dialogue;
    this.invEntries = open ? withYou(state) : [];
    if (import.meta.env.DEV) {
      noteInventory(open ? this.invEntries.map((entry) => ({ id: entry.id, name: entry.name })) : null);
    }
    this.layout();
  }

  private toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastBg.setVisible(true);
    if (import.meta.env.DEV) noteToast(message);
    // The production-safe read of "is a toast showing right now" — unlike
    // `currentToast`, which is dev-only — so a car's holler (DESIGN.md §2)
    // never has to keep a second timer just to check.
    // engine/timescale.ts — 1 outside the headless playtest harness, so a
    // toast (and the holler that rides the same clock, engine/scenes/map.ts
    // HOLLER_DISPLAY) still shows for the same relative stretch, just sooner.
    const ms = scaled(TOAST_MS);
    session().toastUntil = performance.now() + ms;
    this.layout();
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(ms, () => {
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
   * Grows `invRows` to at least `count` pairs, and never shrinks it — rows
   * from a longer-ago panel just sit unused until the next one needs them
   * again. "With you" stays a glance rather than turning into a slot-shaped
   * inventory precisely because nothing here caps how many rows there can
   * be; the list is as long as `withYou` says it is.
   */
  private ensureInvRows(count: number): void {
    while (this.invRows.length < count) {
      const name = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#2a231a', fontStyle: 'bold' })
        .setDepth(12)
        .setVisible(false);
      const blurb = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#2a231a' })
        .setDepth(12)
        .setVisible(false);
      this.invRows.push({ name, blurb });
    }
  }

  /**
   * The panel's own layout: same paper box, bottom-docked, as the say box —
   * they never show at once, so sharing the spot costs nothing. Title, then
   * either the empty line or one row per entry — its name, and a blurb under
   * it when the entry has one. No swatch or icon: there is no per-item
   * sprite convention yet, and one engine-drawn placeholder repeated on every
   * row read as decoration rather than information, so the panel is words
   * only until there is real art to show.
   */
  private layoutInventory(width: number, height: number): void {
    const margin = 8;
    const left = margin;
    const boxW = width - margin * 2;
    const textLeft = left + 14;
    const wrapWidth = boxW - 28;
    const copy = session().copy.ui.withYou;
    const titleStr = copy?.title;
    const showEmpty = this.invEntries.length === 0;
    const emptyStr = showEmpty ? copy?.empty : undefined;
    const entries = this.invEntries;

    this.ensureInvRows(entries.length);
    this.invTitle.setWordWrapWidth(wrapWidth, true).setText(titleStr ?? '').setVisible(Boolean(titleStr));
    this.invEmpty.setWordWrapWidth(wrapWidth, true).setText(emptyStr ?? '').setVisible(Boolean(emptyStr));

    // Measure every row before any of them is placed — the same
    // measure-then-draw order the say box uses, so the box grows to fit a
    // long blurb on a narrow phone instead of clipping it.
    const rowHeights: number[] = [];
    this.invRows.forEach((row, i) => {
      const entry = entries[i];
      if (!entry || showEmpty) {
        row.name.setVisible(false);
        row.blurb.setVisible(false);
        return;
      }
      row.name.setWordWrapWidth(wrapWidth, true).setText(entry.name).setVisible(true);
      row.blurb.setWordWrapWidth(wrapWidth, true).setText(entry.blurb ?? '').setVisible(Boolean(entry.blurb));
      rowHeights.push(row.name.height + (entry.blurb ? row.blurb.height + 2 : 0));
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
      row.name.setPosition(textLeft, y);
      row.blurb.setPosition(textLeft, y + row.name.height + 2);
      y += rowHeights[rowIndex] + 10;
      rowIndex += 1;
    });
  }

  /**
   * The HUD button hides itself, rather than being disabled, whenever
   * `toggleInventory` would refuse to open the panel anyway (a say box up, a
   * scene running, the travel interstitial locked) or the toast sits over
   * its own corner. `invOpen` is exempted from the say-box/scene-running
   * half of that so the button stays put — and tappable — as a second way to
   * close the very panel it opened.
   */
  update(): void {
    if (!this.invEnabled || !this.invBtn) return;
    const state = session();
    const cannotOpen = !this.invOpen && (state.dialogueOpen || state.sceneRunning);
    this.invBtn.hidden = cannotOpen || state.locked || this.toastText.visible;
  }
}
