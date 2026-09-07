import Phaser from 'phaser';
import { publishTitle } from '../debug';
import { feedbackUrl } from '../feedback';
import { isHeld, onAction, onDirection, onDrag, onTap } from '../input';
import { forgetAll, hasProgress, isCompleted, resetEpisode } from '../save';
import { creditFor, joinCredits } from '../session';
import { episodeNumber, startEpisode } from './boot';
import type { Booted } from './boot';
import type { Episode } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const PAPER = 0xf3ead8;
const INK = 0x2a231a;
const ACCENT = '#b5542a';
/** Minimum row height; a row that wraps grows to fit its label. */
const ROW_H = 46;
const ROW_GAP = 8;
const PANEL_MAX = 460;
/** A row's right column reserves this much width for a single action word. */
const RESERVE_ACTION = 90;
/** ...and this much when a primary and a secondary action sit side by side. */
const RESERVE_WIDE = 190;
/** Extra row height a confirming row reserves below its question for Yes/Keep. */
const BUTTON_LINE_RESERVE = 34;
/** Gap between the primary and secondary words on their shared line. */
const ACTION_GAP = 18;
/** Touch target minimum, both ways (CLAUDE.md hard rule 4). */
const MIN_TARGET = 44;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Row {
  kind: 'episode' | 'write' | 'forget' | 'credits';
  episode?: Episode;
  /** "Ep. 1 — The Dog Who Got Around", or the row's own label when it isn't an episode. */
  label: string;
  /** "Play" / "Continue" / "Play again", or nothing when the world has no word for it. */
  action: string;
  /** "Start over" — offered beside `action` once the episode has progress or is done. */
  secondary?: string;
  done: boolean;
  y: number;
  /** Grows with the label: a long episode title wraps rather than being cut. */
  h: number;
  text: Phaser.GameObjects.Text;
  actionText: Phaser.GameObjects.Text;
  secondaryText: Phaser.GameObjects.Text;
  /** The world's word for a finished episode, on the rows that have earned it. */
  doneText: Phaser.GameObjects.Text;
  /** Where `action` (or "Yes", while confirming) can be tapped, in scene pixels. */
  primaryRect: Rect | null;
  /** Where `secondary` (or "Keep it", while confirming) can be tapped, in scene pixels. */
  secondaryRect: Rect | null;
}

/**
 * The title screen (DESIGN.md §2): the world's name and the episodes it ships,
 * with a done mark on the ones that are finished and the action that picking
 * one would take — play it, carry on with it, or play it again. Every word on
 * it comes from the world pack (`world.json` and `copy.json`); the engine
 * supplies only the shapes (CLAUDE.md hard rule 1), and a world that leaves a
 * string out simply doesn't get that bit drawn (hard rule 3).
 *
 * Two more things live on this list: an episode with progress or a finished
 * mark also offers "Start over" beside its usual action — a true reset, which
 * a one-step "are you sure" confirms in place on the same row — and, past the
 * episodes, a "Forget everything" item wipes the whole save the same way.
 * Neither ever fires without that confirmation. A `Credits` item, between the
 * episodes and "Write to us", swaps the episode list for a scrollable one:
 * every painted building's painter, any episode's writer `credits.json`
 * names, and two closing lines of copy.
 *
 * Controls are the game's own, on one path each (hard rule 4): tapping an
 * entry picks it, the d-pad or the arrow keys move the cursor up and down,
 * left and right move between an episode's two actions (or, while confirming,
 * between Yes and Keep), and A — or space, or enter — takes whichever is
 * highlighted. On touch, "Start over" (and Yes/Keep) are their own tappable
 * targets beside the primary one, each at least 44px on a side. The Credits
 * list scrolls on the d-pad/arrow keys (held) or by dragging, and a tap or A
 * closes it. The "write to us" link at the foot of the list is a real DOM
 * anchor, the same one the suggestion box uses, so touch, Tab and Enter are
 * the browser's job rather than the game's.
 */
export class TitleScene extends Phaser.Scene {
  private booted!: Booted;
  private rows: Row[] = [];
  private index = 0;
  /** Which of an episode row's two actions is highlighted, off the list's own cursor. */
  private armed: 'primary' | 'secondary' = 'primary';
  /** The row index currently asking "are you sure?", or null when nobody is. */
  private confirming: number | null = null;
  private confirmArmed: 'yes' | 'keep' = 'keep';
  private mode: 'list' | 'credits' = 'list';
  private creditsScroll = 0;
  private creditsMaxScroll = 0;
  private panel!: Phaser.GameObjects.Graphics;
  private heading!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private creditsHeading!: Phaser.GameObjects.Text;
  private creditsBody!: Phaser.GameObjects.Text;
  /**
   * Clips and scrolls the Credits body. Phaser 4 dropped WebGL support for
   * `setMask`/geometry masks in favour of a filter-based system that is
   * awkward for a plain scroll clip, so this does it the classic way
   * instead: a second camera, viewport-sized to the visible window, that
   * renders only `creditsBody` — its own `scrollY` is the scroll position —
   * while the main camera renders everything else and ignores the body.
   */
  private creditsCam!: Phaser.Cameras.Scene2D.Camera;
  private linkEl: HTMLAnchorElement | null = null;
  private writeUrl?: string;
  /** Where the list is drawn, in this scene's pixels — the dev snapshot's aim. */
  private panelBox = { left: 0, width: 0 };
  private unbind: (() => void)[] = [];
  private starting = false;

  constructor() {
    super('Title');
  }

  init(data: Booted): void {
    this.booted = data;
    this.rows = [];
    this.index = 0;
    this.armed = 'primary';
    this.confirming = null;
    this.confirmArmed = 'keep';
    this.mode = 'list';
    this.creditsScroll = 0;
    this.starting = false;
  }

  create(): void {
    const { world, copy, episodes } = this.booted.loaded;
    const save = this.booted.save;
    const words = copy.ui.title;

    this.cameras.main.setBackgroundColor('#12160f');
    this.panel = this.add.graphics().setDepth(0);

    this.heading = this.add
      .text(0, 0, world.title.toUpperCase(), { fontFamily: FONT, fontSize: '22px', color: '#b5542a', fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setDepth(2);
    this.subtitle = this.add
      .text(0, 0, world.subtitle ?? '', { fontFamily: FONT, fontSize: '11px', color: '#f3ead8' })
      .setOrigin(0.5, 0)
      .setAlpha(0.7)
      .setDepth(2);

    this.creditsHeading = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '20px', color: ACCENT, fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setDepth(2)
      .setVisible(false);
    this.creditsBody = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#2a231a', lineSpacing: 6 })
      .setDepth(2)
      .setVisible(false);
    // A second camera, viewport-sized to the visible window, renders only the
    // credits body — see the field comment for why not a mask. Left
    // transparent (the default) so the panel behind it, drawn by the main
    // camera, still shows through.
    this.creditsCam = this.cameras.add(0, 0, 1, 1);
    this.cameras.main.ignore(this.creditsBody);

    for (const episode of episodes) {
      const done = isCompleted(save, episode.id);
      const hasProg = hasProgress(save, episode.id);
      const action = done ? (words?.again ?? '') : hasProg ? (words?.continue ?? '') : (words?.play ?? '');
      const secondary = done || hasProg ? words?.reset : undefined;
      this.rows.push(
        this.makeRow('episode', `${episodeNumber(episode.id)} — ${episode.title}`, action, done, episode, secondary)
      );
    }

    // Credits, between the episodes and "write to us" — a world with nothing
    // to say here (no `ui.title.credits`) simply doesn't get the row.
    if (words?.credits) {
      this.rows.push(this.makeRow('credits', words.credits, '', false));
    }

    // The world's "write to us", sharing the suggestion box's address and its
    // note (DESIGN.md §2). No feedback block and no label, and there is
    // simply no row.
    this.linkEl = document.querySelector<HTMLAnchorElement>('a[data-overlay="link"]');
    this.writeUrl = feedbackUrl(world.feedback, copy.ui.suggest?.body);
    const writeLabel = words?.write ?? copy.ui.suggest?.link;
    if (this.writeUrl && writeLabel && this.linkEl) {
      this.rows.push(this.makeRow('write', writeLabel, '', false));
      this.linkEl.href = this.writeUrl;
      this.linkEl.textContent = writeLabel;
    }

    // "Forget everything", last on the list, kindly worded and never fired
    // without the same confirmation a "Start over" gets.
    if (words?.forget) {
      this.rows.push(this.makeRow('forget', words.forget, '', false));
    }

    // The credits camera draws only the credits body; everything else is the
    // main camera's, including the rows built just above.
    this.creditsCam.ignore([
      this.panel,
      this.heading,
      this.subtitle,
      this.creditsHeading,
      ...this.rows.flatMap((row) => [row.text, row.actionText, row.secondaryText, row.doneText])
    ]);

    // The cursor waits on the first episode still to be finished — the one
    // somebody coming back this week is most likely here for.
    const unfinished = this.rows.findIndex((row) => row.kind === 'episode' && !row.done);
    this.index = unfinished >= 0 ? unfinished : 0;

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.unbind.push(
      onAction(() => {
        if (this.mode === 'credits') {
          this.hideCredits();
          return;
        }
        this.confirm();
      })
    );
    this.unbind.push(
      onDirection((dir) => {
        if (this.mode === 'credits') return; // scrolls continuously in update() instead
        if (dir === 'up') this.move(-1);
        else if (dir === 'down') this.move(1);
        else if (dir === 'left' || dir === 'right') this.toggleArm();
      })
    );
    this.unbind.push(
      onTap((x, y) => {
        if (this.mode === 'credits') {
          this.hideCredits();
          return;
        }
        this.tap(x, y);
      })
    );
    this.unbind.push(
      onDrag((dy) => {
        if (this.mode !== 'credits') return;
        this.creditsScroll = Phaser.Math.Clamp(this.creditsScroll - this.stageDelta(dy), 0, this.creditsMaxScroll);
        this.layoutCredits();
      })
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      for (const off of this.unbind) off();
      this.unbind = [];
      this.hideLink();
      if (import.meta.env.DEV) publishTitle(null);
    });
  }

  /** Held d-pad/arrow keys scroll the Credits list; everything else on this screen is edge-triggered. */
  update(_time: number, delta: number): void {
    if (this.mode !== 'credits') return;
    const dir = isHeld('up') ? -1 : isHeld('down') ? 1 : 0;
    if (!dir) return;
    const SPEED = 320; // stage px/s
    const next = Phaser.Math.Clamp(this.creditsScroll + dir * SPEED * (delta / 1000), 0, this.creditsMaxScroll);
    if (next === this.creditsScroll) return;
    this.creditsScroll = next;
    this.layoutCredits();
  }

  private makeRow(kind: Row['kind'], label: string, action: string, done: boolean, episode?: Episode, secondary?: string): Row {
    return {
      kind,
      episode,
      label,
      action,
      secondary,
      done,
      y: 0,
      h: ROW_H,
      primaryRect: null,
      secondaryRect: null,
      text: this.add.text(0, 0, label, { fontFamily: FONT, fontSize: '13px', color: '#f3ead8' }).setDepth(2),
      actionText: this.add
        .text(0, 0, action, { fontFamily: FONT, fontSize: '12px', color: '#f3ead8', fontStyle: 'bold' })
        .setOrigin(1, 0)
        .setDepth(2),
      secondaryText: this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#f3ead8', fontStyle: 'bold' })
        .setOrigin(1, 0)
        .setDepth(2),
      doneText: this.add
        .text(0, 0, done ? (this.booted.loaded.copy.ui.title?.done ?? '') : '', {
          fontFamily: FONT,
          fontSize: '11px',
          color: '#f3ead8'
        })
        .setOrigin(1, 0)
        .setDepth(2)
    };
  }

  /** Re-reads one episode row's done/progress state off the save, after a reset. */
  private refreshRow(i: number): void {
    const row = this.rows[i];
    if (row.kind !== 'episode' || !row.episode) return;
    const words = this.booted.loaded.copy.ui.title;
    const save = this.booted.save;
    const done = isCompleted(save, row.episode.id);
    const hasProg = hasProgress(save, row.episode.id);
    row.done = done;
    row.action = done ? (words?.again ?? '') : hasProg ? (words?.continue ?? '') : (words?.play ?? '');
    row.secondary = done || hasProg ? words?.reset : undefined;
  }

  private move(step: number): void {
    if (!this.rows.length) return;
    if (this.confirming !== null) this.cancelConfirm();
    this.armed = 'primary';
    this.index = (this.index + step + this.rows.length) % this.rows.length;
    this.layout();
  }

  private toggleArm(): void {
    if (this.confirming !== null) {
      this.confirmArmed = this.confirmArmed === 'yes' ? 'keep' : 'yes';
      this.layout();
      return;
    }
    const row = this.rows[this.index];
    if (!row || row.kind !== 'episode' || !row.secondary) return;
    this.armed = this.armed === 'primary' ? 'secondary' : 'primary';
    this.layout();
  }

  private tap(clientX: number, clientY: number): void {
    const point = this.stagePoint(clientX, clientY);
    if (!point) return;
    const { left, width } = this.panelBox;
    if (point.x < left || point.x > left + width) return;
    const hit = this.rows.findIndex((row) => point.y >= row.y && point.y <= row.y + row.h);
    if (hit < 0) return;
    const row = this.rows[hit];

    const inRect = (r: Rect | null): boolean =>
      Boolean(r) && point.x >= r!.x && point.x <= r!.x + r!.w && point.y >= r!.y && point.y <= r!.y + r!.h;

    if (this.confirming !== null && this.confirming !== hit) this.cancelConfirm();
    this.index = hit;

    if (this.confirming === hit) {
      // "Keep it" needs to be hit precisely; by then the row is mostly given
      // over to the question, so anywhere else on it confirms.
      this.confirmArmed = inRect(row.secondaryRect) ? 'keep' : 'yes';
    } else {
      this.armed = inRect(row.secondaryRect) ? 'secondary' : 'primary';
    }
    this.layout();
    this.confirm();
  }

  private confirm(): void {
    if (this.starting) return;
    const row = this.rows[this.index];
    if (!row) return;

    if (this.confirming === this.index) {
      this.resolveConfirm(row, this.confirmArmed === 'yes');
      return;
    }

    if (row.kind === 'write') {
      // The browser's link, opened the browser's way.
      this.linkEl?.click();
      return;
    }
    if (row.kind === 'credits') {
      this.showCredits();
      return;
    }
    if (row.kind === 'forget') {
      this.enterConfirm(this.index);
      return;
    }
    if (!row.episode) return;

    if (this.armed === 'secondary' && row.secondary) {
      this.enterConfirm(this.index);
      return;
    }

    this.starting = true;
    this.hideLink();
    startEpisode(this, this.booted, row.episode, { replay: row.done });
  }

  private enterConfirm(index: number): void {
    this.confirming = index;
    this.confirmArmed = 'keep';
    this.layout();
  }

  private cancelConfirm(): void {
    this.confirming = null;
  }

  private resolveConfirm(row: Row, yes: boolean): void {
    if (!yes) {
      this.cancelConfirm();
      this.armed = 'primary';
      this.layout();
      return;
    }
    const worldId = this.booted.loaded.world.id;
    if (row.kind === 'forget') {
      this.booted.save = forgetAll(worldId);
      this.rows.forEach((_, i) => this.refreshRow(i));
    } else if (row.episode) {
      resetEpisode(worldId, this.booted.save, row.episode.id);
      this.refreshRow(this.index);
    }
    this.confirming = null;
    this.armed = 'primary';
    this.layout();
  }

  /** The question a confirming row asks, from `copy.json` — never the engine's own words. */
  private askText(row: Row): string {
    const words = this.booted.loaded.copy.ui.title;
    return (row.kind === 'forget' ? words?.forgetAsk : words?.resetAsk) ?? '';
  }

  // --- Credits -----------------------------------------------------------

  /** Every painted building's painter, any credited episode's writer(s), and the two closing lines. */
  private creditsData(): {
    heading: string;
    buildings: { label: string; credit: string }[];
    stories: { label: string; credit: string }[];
    palette: string;
    licence: string;
  } {
    const { world, credits, episodes } = this.booted.loaded;
    const assets = this.booted.assets;
    const words = this.booted.loaded.copy.ui.title;

    const buildings: { label: string; credit: string }[] = [];
    for (const id of Object.keys(world.buildings)) {
      const credit = creditFor(id, { assets, credits });
      if (credit) buildings.push({ label: world.buildings[id].name, credit });
    }

    const stories: { label: string; credit: string }[] = [];
    for (const id of world.episodes) {
      const names = credits.stories?.[id];
      if (names === undefined) continue;
      const episode = episodes.find((e) => e.id === id);
      const label = episode ? `${episodeNumber(id)} — ${episode.title}` : episodeNumber(id);
      stories.push({ label, credit: joinCredits(Array.isArray(names) ? names : [names]) });
    }

    return {
      heading: words?.credits ?? 'Credits',
      buildings,
      stories,
      palette: words?.palette ?? '',
      licence: words?.licence ?? ''
    };
  }

  private creditsText(info: ReturnType<TitleScene['creditsData']>): string {
    const lines: string[] = [];
    for (const b of info.buildings) lines.push(`${b.label} — ${b.credit}`);
    if (info.stories.length) {
      if (lines.length) lines.push('');
      lines.push(this.booted.loaded.copy.ui.title?.storyBy ?? 'Story by');
      for (const s of info.stories) lines.push(`${s.label}: ${s.credit}`);
    }
    if (info.palette || info.licence) {
      if (lines.length) lines.push('');
      if (info.palette) lines.push(info.palette);
      if (info.licence) lines.push(info.licence);
    }
    return lines.join('\n');
  }

  private showCredits(): void {
    this.mode = 'credits';
    this.creditsScroll = 0;
    this.hideLink();
    this.setListVisible(false);
    const info = this.creditsData();
    this.creditsHeading.setText(info.heading);
    this.creditsBody.setText(this.creditsText(info));
    this.creditsHeading.setVisible(true);
    this.creditsBody.setVisible(true);
    this.layoutCredits();
  }

  private hideCredits(): void {
    this.mode = 'list';
    this.creditsHeading.setVisible(false);
    this.creditsBody.setVisible(false);
    this.setListVisible(true);
    this.layout();
  }

  private setListVisible(show: boolean): void {
    this.heading.setVisible(show);
    this.subtitle.setVisible(show);
    for (const row of this.rows) {
      row.text.setVisible(show);
      row.actionText.setVisible(show);
      row.secondaryText.setVisible(show);
      row.doneText.setVisible(show);
    }
  }

  /** Client (CSS) pixels of vertical drag to this scene's own pixels. */
  private stageDelta(dyClient: number): number {
    const canvas = this.game.canvas;
    const rect = canvas?.getBoundingClientRect();
    const { height } = this.scale.gameSize;
    if (!rect || !rect.height) return dyClient;
    return (dyClient / rect.height) * height;
  }

  private layoutCredits(): void {
    const { width, height } = this.scale.gameSize;
    const panelW = Math.min(width - 24, PANEL_MAX);
    const left = Math.round((width - panelW) / 2);
    this.panelBox = { left, width: panelW };

    this.creditsHeading.setPosition(Math.round(width / 2), 20);

    const viewTop = 20 + 34;
    const viewBottom = height - 20;
    const viewH = Math.max(40, viewBottom - viewTop);

    this.creditsBody.setWordWrapWidth(panelW - 28, true);
    // Fixed in world space; the credits camera's own scroll pans it, so this
    // never moves once `viewTop`/`left` settle for the current screen size.
    this.creditsBody.setPosition(left + 14, viewTop + 12);

    this.panel.clear();
    this.panel.fillStyle(PAPER, 1);
    this.panel.fillRect(left, viewTop, panelW, viewH);
    this.panel.lineStyle(3, INK, 1);
    this.panel.strokeRect(left + 1.5, viewTop + 1.5, panelW - 3, viewH - 3);

    this.creditsMaxScroll = Math.max(0, Math.round(this.creditsBody.height) - (viewH - 24));
    this.creditsScroll = Phaser.Math.Clamp(this.creditsScroll, 0, this.creditsMaxScroll);
    this.creditsCam.setViewport(left, viewTop, panelW, viewH);
    this.creditsCam.setScroll(0, this.creditsScroll);

    if (import.meta.env.DEV) this.publish();
  }

  /** Client (CSS) pixels to the coordinates this scene draws in. */
  private stagePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = this.game.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const { width, height } = this.scale.gameSize;
    return { x: ((clientX - rect.left) / rect.width) * width, y: ((clientY - rect.top) / rect.height) * height };
  }

  private hideLink(): void {
    const el = this.linkEl;
    if (!el) return;
    if (document.activeElement === el) el.blur();
    el.hidden = true;
    el.style.left = '';
    el.style.top = '';
  }

  private layout(): void {
    if (this.mode === 'credits') {
      this.layoutCredits();
      return;
    }

    const { width, height } = this.scale.gameSize;
    const panelW = Math.min(width - 24, PANEL_MAX);
    const left = Math.round((width - panelW) / 2);
    this.panelBox = { left, width: panelW };
    const words = this.booted.loaded.copy.ui.title;

    // Measure first: a long episode title wraps, and its row grows under it
    // rather than the words being cut off (there is no "…" anywhere kind).
    // A row that can show two actions side by side — a secondary action, or a
    // confirmation's Yes/Keep — reserves the wider column always, so picking
    // it up and down never reflows its label.
    this.rows.forEach((row, i) => {
      const confirming = this.confirming === i;
      const wide = Boolean(row.secondary) || row.kind === 'forget';
      const reserve = confirming ? 0 : wide ? RESERVE_WIDE : row.action ? RESERVE_ACTION : 0;
      row.text.setWordWrapWidth(panelW - 28 - reserve, true);
      row.text.setText(confirming ? this.askText(row) : row.label);
      row.h = Math.max(ROW_H, Math.round(row.text.height) + 22 + (confirming ? BUTTON_LINE_RESERVE : 0));
    });

    const headingH = 30;
    const subtitleH = this.subtitle.text ? 20 : 0;
    const listH = this.rows.reduce((sum, row) => sum + row.h, 0) + Math.max(0, this.rows.length - 1) * ROW_GAP;
    const total = headingH + subtitleH + 24 + listH;
    const top = Math.max(20, Math.round((height - total) / 2));

    this.heading.setPosition(Math.round(width / 2), top);
    this.subtitle.setPosition(Math.round(width / 2), top + headingH);

    this.panel.clear();
    let y = top + headingH + subtitleH + 24;
    const rightEdge = left + panelW - 14;

    this.rows.forEach((row, i) => {
      row.y = y;
      const selected = i === this.index;
      const confirming = this.confirming === i;
      if (selected) {
        this.panel.fillStyle(PAPER, 1);
        this.panel.fillRect(left, y, panelW, row.h);
        this.panel.lineStyle(3, INK, 1);
        this.panel.strokeRect(left + 1.5, y + 1.5, panelW - 3, row.h - 3);
      } else {
        this.panel.lineStyle(2, PAPER, 0.35);
        this.panel.strokeRect(left + 1, y + 1, panelW - 2, row.h - 2);
      }

      row.text.setColor(selected ? '#2a231a' : '#f3ead8');
      row.text.setAlpha(selected ? 1 : 0.8);
      row.text.setPosition(left + 14, confirming ? y + 11 : y + Math.round((row.h - row.text.height) / 2));

      // Only the highlighted row says what it would do, so the list reads as
      // a list rather than a row of buttons — except while confirming, which
      // is a question the row asks regardless of the cursor sitting there.
      row.doneText.setText(!confirming && row.done ? (words?.done ?? '') : '');
      row.doneText.setColor(selected ? '#2a231a' : '#f3ead8');
      row.doneText.setAlpha(selected ? 0.75 : 0.6);

      row.primaryRect = null;
      row.secondaryRect = null;

      const pairVisible = confirming || (selected && Boolean(row.secondary));
      const singleVisible = !pairVisible && selected && Boolean(row.action);

      if (pairVisible) {
        const primaryLabel = confirming ? (words?.yes ?? '') : row.action;
        const secondaryLabel = confirming ? (words?.keep ?? '') : (row.secondary ?? '');
        row.actionText.setText(primaryLabel);
        row.secondaryText.setText(secondaryLabel);

        const primaryArmed = confirming ? this.confirmArmed === 'yes' : this.armed === 'primary';
        row.actionText.setColor(primaryArmed ? ACCENT : '#2a231a');
        row.actionText.setAlpha(primaryArmed ? 1 : 0.6);
        row.secondaryText.setColor(!primaryArmed ? ACCENT : '#2a231a');
        row.secondaryText.setAlpha(!primaryArmed ? 1 : 0.6);

        const lineY = confirming
          ? y + row.h - 16 - row.actionText.height
          : Math.round(y + row.h / 2 - row.actionText.height / 2 + (row.doneText.text ? 8 : 0));

        row.actionText.setPosition(rightEdge, lineY);
        const secondaryRight = rightEdge - row.actionText.width - ACTION_GAP;
        row.secondaryText.setPosition(secondaryRight, lineY);

        if (row.doneText.text) {
          row.doneText.setPosition(rightEdge, Math.round(lineY - row.doneText.height - 4));
        }

        const targetH = Math.max(MIN_TARGET, row.actionText.height + 16);
        const padY = (targetH - row.actionText.height) / 2;
        row.primaryRect = {
          x: rightEdge - row.actionText.width,
          y: lineY - padY,
          w: Math.max(MIN_TARGET, row.actionText.width),
          h: targetH
        };
        row.secondaryRect = {
          x: secondaryRight - row.secondaryText.width,
          y: lineY - padY,
          w: Math.max(MIN_TARGET, row.secondaryText.width),
          h: targetH
        };
      } else if (singleVisible) {
        row.actionText.setText(row.action);
        row.actionText.setColor(ACCENT);
        row.actionText.setAlpha(1);
        row.secondaryText.setText('');

        const stacked = Boolean(row.doneText.text);
        const middle = y + row.h / 2;
        row.doneText.setPosition(rightEdge, Math.round(middle - (stacked ? 15 : row.doneText.height / 2)));
        row.actionText.setPosition(rightEdge, Math.round(middle - (stacked ? -2 : row.actionText.height / 2)));
        row.primaryRect = { x: left, y, w: panelW, h: row.h };
      } else {
        row.actionText.setText('');
        row.secondaryText.setText('');
        const middle = y + row.h / 2;
        row.doneText.setPosition(rightEdge, Math.round(middle - row.doneText.height / 2));
      }

      // The write row is the DOM link itself, sitting on its own row.
      if (row.kind === 'write' && this.linkEl) {
        row.text.setVisible(false);
        this.positionLink(left + 14, y + Math.round((row.h - 28) / 2));
      }

      y += row.h + ROW_GAP;
    });

    if (import.meta.env.DEV) this.publish();
  }

  private positionLink(x: number, y: number): void {
    const el = this.linkEl;
    if (!el) return;
    const canvas = this.game.canvas;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const { width, height } = this.scale.gameSize;
    const sx = canvasRect.width / width;
    const sy = canvasRect.height / height;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${Math.round(canvasRect.left - stageRect.left + x * sx)}px`;
    el.style.top = `${Math.round(canvasRect.top - stageRect.top + y * sy)}px`;
    el.hidden = false;
  }

  /** Dev-only, for the playtest harness: what the list (or the Credits list) says and where to tap it. */
  private publish(): void {
    const canvas = this.game.canvas;
    const rect = canvas?.getBoundingClientRect();
    const { width, height } = this.scale.gameSize;
    const sx = rect && width ? rect.width / width : 1;
    const sy = rect && height ? rect.height / height : 1;
    const toClient = (r: Rect | null): Rect | undefined =>
      r ? { x: (rect?.left ?? 0) + r.x * sx, y: (rect?.top ?? 0) + r.y * sy, w: r.w * sx, h: r.h * sy } : undefined;

    const credits =
      this.mode === 'credits'
        ? (() => {
            const info = this.creditsData();
            return {
              heading: info.heading,
              buildings: info.buildings,
              stories: info.stories,
              palette: info.palette,
              licence: info.licence,
              backRect: { x: rect?.left ?? 0, y: rect?.top ?? 0, w: (rect?.width ?? width) as number, h: (rect?.height ?? height) as number }
            };
          })()
        : null;

    publishTitle({
      world: this.heading.text,
      items: this.rows.map((row, i) => {
        const confirming = this.confirming === i;
        return {
          kind: row.kind,
          id: row.episode?.id ?? '',
          label: row.label,
          action: row.action,
          done: row.done,
          doneMark: row.doneText.text,
          selected: i === this.index,
          rect: { x: (rect?.left ?? 0) + this.panelBox.left * sx, y: (rect?.top ?? 0) + row.y * sy, w: this.panelBox.width * sx, h: row.h * sy },
          secondary: row.secondary,
          secondaryRect: !confirming ? toClient(row.secondaryRect) : undefined,
          confirming: confirming || undefined,
          confirmAsk: confirming ? this.askText(row) : undefined,
          yesRect: confirming ? toClient(row.primaryRect) : undefined,
          keepRect: confirming ? toClient(row.secondaryRect) : undefined
        };
      }),
      credits
    });
  }
}
