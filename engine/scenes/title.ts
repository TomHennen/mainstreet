import Phaser from 'phaser';
import { publishTitle } from '../debug';
import { feedbackUrl } from '../feedback';
import { onAction, onDirection, onTap } from '../input';
import { hasProgress, isCompleted } from '../save';
import { episodeNumber, startEpisode } from './boot';
import type { Booted } from './boot';
import type { Episode } from '../schema';

const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const PAPER = 0xf3ead8;
const INK = 0x2a231a;
/** Minimum row height; a row that wraps grows to fit its label. */
const ROW_H = 46;
const ROW_GAP = 8;
const PANEL_MAX = 460;

interface Row {
  kind: 'episode' | 'write';
  episode?: Episode;
  /** "Ep. 1 — The Dog Who Got Around", or the write link's label. */
  label: string;
  /** "Play" / "Continue" / "Play again", or nothing when the world has no word for it. */
  action: string;
  done: boolean;
  y: number;
  /** Grows with the label: a long episode title wraps rather than being cut. */
  h: number;
  text: Phaser.GameObjects.Text;
  actionText: Phaser.GameObjects.Text;
  /** The world's word for a finished episode, on the rows that have earned it. */
  doneText: Phaser.GameObjects.Text;
}

/**
 * The title screen (DESIGN.md §2): the world's name and the episodes it ships,
 * with a done mark on the ones that are finished and the action that picking
 * one would take — play it, carry on with it, or play it again. Every word on
 * it comes from the world pack (`world.json` and `copy.json`); the engine
 * supplies only the shapes (CLAUDE.md hard rule 1), and a world that leaves a
 * string out simply doesn't get that bit drawn (hard rule 3).
 *
 * Controls are the game's own, on one path each (hard rule 4): tapping an
 * entry picks it, the d-pad or the arrow keys move the cursor, and A — or
 * space, or enter — takes the highlighted one. The "write to us" link at the
 * foot of the list is a real DOM anchor, the same one the suggestion box uses,
 * so touch, Tab and Enter are the browser's job rather than the game's.
 */
export class TitleScene extends Phaser.Scene {
  private booted!: Booted;
  private rows: Row[] = [];
  private index = 0;
  private panel!: Phaser.GameObjects.Graphics;
  private heading!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
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

    for (const episode of episodes) {
      const done = isCompleted(save, episode.id);
      const action = done ? (words?.again ?? '') : hasProgress(save, episode.id) ? (words?.continue ?? '') : (words?.play ?? '');
      this.rows.push(this.makeRow('episode', `${episodeNumber(episode.id)} — ${episode.title}`, action, done, episode));
    }

    // The world's "write to us", the last thing on the list, sharing the
    // suggestion box's address and its note (DESIGN.md §2). No feedback block
    // and no label, and there is simply no row.
    this.linkEl = document.querySelector<HTMLAnchorElement>('a[data-overlay="link"]');
    this.writeUrl = feedbackUrl(world.feedback, copy.ui.suggest?.body);
    const writeLabel = words?.write ?? copy.ui.suggest?.link;
    if (this.writeUrl && writeLabel && this.linkEl) {
      this.rows.push(this.makeRow('write', writeLabel, '', false));
      this.linkEl.href = this.writeUrl;
      this.linkEl.textContent = writeLabel;
    }

    // The cursor waits on the first episode still to be finished — the one
    // somebody coming back this week is most likely here for.
    const unfinished = this.rows.findIndex((row) => row.kind === 'episode' && !row.done);
    this.index = unfinished >= 0 ? unfinished : 0;

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.unbind.push(onAction(() => this.confirm()));
    this.unbind.push(
      onDirection((dir) => {
        if (dir === 'up') this.move(-1);
        else if (dir === 'down') this.move(1);
      })
    );
    this.unbind.push(onTap((x, y) => this.tap(x, y)));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      for (const off of this.unbind) off();
      this.unbind = [];
      this.hideLink();
      if (import.meta.env.DEV) publishTitle(null);
    });
  }

  private makeRow(kind: Row['kind'], label: string, action: string, done: boolean, episode?: Episode): Row {
    return {
      kind,
      episode,
      label,
      action,
      done,
      y: 0,
      h: ROW_H,
      text: this.add.text(0, 0, label, { fontFamily: FONT, fontSize: '13px', color: '#f3ead8' }).setDepth(2),
      actionText: this.add
        .text(0, 0, action, { fontFamily: FONT, fontSize: '12px', color: '#f3ead8', fontStyle: 'bold' })
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

  private move(step: number): void {
    if (!this.rows.length) return;
    this.index = (this.index + step + this.rows.length) % this.rows.length;
    this.layout();
  }

  private tap(clientX: number, clientY: number): void {
    const point = this.stagePoint(clientX, clientY);
    if (!point) return;
    const { left, width } = this.panelBox;
    if (point.x < left || point.x > left + width) return;
    const hit = this.rows.findIndex((row) => point.y >= row.y && point.y <= row.y + row.h);
    if (hit < 0) return;
    this.index = hit;
    this.layout();
    this.confirm();
  }

  private confirm(): void {
    if (this.starting) return;
    const row = this.rows[this.index];
    if (!row) return;
    if (row.kind === 'write') {
      // The browser's link, opened the browser's way.
      this.linkEl?.click();
      return;
    }
    if (!row.episode) return;
    this.starting = true;
    this.hideLink();
    startEpisode(this, this.booted, row.episode, { replay: row.done });
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
    const { width, height } = this.scale.gameSize;
    const panelW = Math.min(width - 24, PANEL_MAX);
    const left = Math.round((width - panelW) / 2);
    this.panelBox = { left, width: panelW };

    // Measure first: a long episode title wraps, and its row grows under it
    // rather than the words being cut off (there is no "…" anywhere kind).
    for (const row of this.rows) {
      row.text.setWordWrapWidth(panelW - 28 - (row.action ? 90 : 0), true);
      row.text.setText(row.label);
      row.h = Math.max(ROW_H, Math.round(row.text.height) + 22);
    }

    const headingH = 30;
    const subtitleH = this.subtitle.text ? 20 : 0;
    const listH = this.rows.reduce((sum, row) => sum + row.h, 0) + Math.max(0, this.rows.length - 1) * ROW_GAP;
    const total = headingH + subtitleH + 24 + listH;
    const top = Math.max(20, Math.round((height - total) / 2));

    this.heading.setPosition(Math.round(width / 2), top);
    this.subtitle.setPosition(Math.round(width / 2), top + headingH);

    this.panel.clear();
    let y = top + headingH + subtitleH + 24;
    this.rows.forEach((row, i) => {
      row.y = y;
      const selected = i === this.index;
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
      row.text.setPosition(left + 14, y + Math.round((row.h - row.text.height) / 2));

      // The right-hand column: what this episode is (finished, or not) above
      // what picking it would do. Only the highlighted row says what it would
      // do, so the list reads as a list rather than a row of buttons.
      row.actionText.setText(selected ? row.action : '');
      row.actionText.setColor('#b5542a');
      row.doneText.setColor(selected ? '#2a231a' : '#f3ead8');
      row.doneText.setAlpha(selected ? 0.75 : 0.6);
      const stacked = Boolean(row.doneText.text) && Boolean(row.actionText.text);
      const middle = y + row.h / 2;
      row.doneText.setPosition(left + panelW - 14, Math.round(middle - (stacked ? 15 : row.doneText.height / 2)));
      row.actionText.setPosition(left + panelW - 14, Math.round(middle - (stacked ? -2 : row.actionText.height / 2)));

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

  /** Dev-only, for the playtest harness: what the list says and where to tap it. */
  private publish(): void {
    const canvas = this.game.canvas;
    const rect = canvas?.getBoundingClientRect();
    const { width, height } = this.scale.gameSize;
    const sx = rect && width ? rect.width / width : 1;
    const sy = rect && height ? rect.height / height : 1;
    publishTitle({
      world: this.heading.text,
      items: this.rows.map((row, i) => ({
        kind: row.kind,
        id: row.episode?.id ?? '',
        label: row.label,
        action: row.action,
        done: row.done,
        doneMark: row.doneText.text,
        selected: i === this.index,
        rect: {
          x: (rect?.left ?? 0) + this.panelBox.left * sx,
          y: (rect?.top ?? 0) + row.y * sy,
          w: this.panelBox.width * sx,
          h: row.h * sy
        }
      }))
    });
  }
}
