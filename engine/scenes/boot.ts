import Phaser from 'phaser';
import { indexAssets, loadEpisode, loadWorld, queueAssets } from '../loader';
import type { LoadedWorld } from '../loader';
import { Flags } from '../flags';
import { loadSave } from '../save';
import type { SaveFile } from '../save';
import { restoreEpisode, resumePoint } from '../progress';
import { startSession } from '../session';
import type { AssetIndex } from '../session';
import { validateEpisode, validateWorld } from '../validate';
import { sceneFlags } from '../schema';
import type { Episode } from '../schema';

/** Letters, digits, "-" and "_" only — keeps `?episode=` off the filesystem path. */
const SAFE_EPISODE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Everything the boot fetched, handed to the title screen so it can start any
 * of the world's episodes without loading anything again.
 */
export interface Booted {
  loaded: LoadedWorld;
  assets: AssetIndex;
  save: SaveFile;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    void this.boot();
  }

  private async boot(): Promise<void> {
    const worldId = import.meta.env.VITE_WORLD;
    if (!worldId) {
      fatal('No world selected', 'Set VITE_WORLD in .env — the engine never hardcodes a world id.');
      return;
    }

    try {
      const loaded = await loadWorld(worldId);
      const { world, episodes, maps } = loaded;

      const problems = [
        ...validateWorld(world, maps),
        ...episodes.flatMap((episode) => validateEpisode(episode, world, maps))
      ];
      if (problems.length) {
        fatal(`World pack "${worldId}" is invalid`, problems.map((p) => `• ${p}`).join('\n'));
        return;
      }

      if (!episodes.length) {
        fatal(`World pack "${worldId}" has no episodes`, 'Add one to world.json → episodes.');
        return;
      }

      // `?episode=<id>` plays any episode file for review, listed in
      // world.json or not (DESIGN.md §3) — e.g. a shelved draft. It skips the
      // title screen and starts that episode from the beginning, and it never
      // writes to the save: reviewing a week's story must not disturb the
      // player's own progress through it. A missing or invalid id warns and
      // falls back to the title rather than showing a blank screen (CLAUDE.md
      // hard rule 3).
      const review = await this.requestedEpisode(loaded);

      // Assets are indexed against whichever episodes can actually be played,
      // so a review episode's own NPCs get their sprites probed too.
      const assetEpisodes = review && !episodes.some((e) => e.id === review.id) ? [...episodes, review] : episodes;
      const assets = await indexAssets({ ...loaded, episodes: assetEpisodes });
      queueAssets(this.load, loaded, assets);
      await new Promise<void>((resolve) => {
        this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        this.load.start();
        if (this.load.totalToLoad === 0) resolve();
      });

      const booted: Booted = { loaded, assets, save: loadSave(world.id) };
      setHud('title', world.title.toUpperCase());
      setHud('episode', '');

      if (review) {
        startEpisode(this, booted, review, { recording: false });
        return;
      }

      this.scene.start('Title', booted);
    } catch (error) {
      fatal('Could not load the world pack', String(error));
    }
  }

  /** The `?episode=` episode, if the URL asks for one that exists and validates. */
  private async requestedEpisode(loaded: LoadedWorld): Promise<Episode | undefined> {
    const { world, maps } = loaded;
    const requestedId = new URLSearchParams(location.search).get('episode');
    if (!requestedId) return undefined;

    if (!SAFE_EPISODE_ID.test(requestedId)) {
      console.warn(
        `?episode="${requestedId}" is not a valid episode id (letters, digits, "-", "_" only); showing the title screen instead.`
      );
      return undefined;
    }
    try {
      const requested = await loadEpisode(world.id, requestedId);
      if (!requested) {
        console.warn(
          `?episode="${requestedId}" has no file at worlds/${world.id}/episodes/${requestedId}.json; showing the title screen instead.`
        );
        return undefined;
      }
      const requestedProblems = validateEpisode(requested, world, maps);
      if (requestedProblems.length) {
        console.warn(
          `?episode="${requestedId}" failed validation (${requestedProblems.join('; ')}); showing the title screen instead.`
        );
        return undefined;
      }
      return requested;
    } catch (error) {
      console.warn(`?episode="${requestedId}" could not be loaded (${String(error)}); showing the title screen instead.`);
      return undefined;
    }
  }
}

/**
 * Starts an episode: the session, the HUD label, and the map scene at wherever
 * this episode was left — the world's start when there is nothing saved for it
 * (DESIGN.md §2). `replay` throws that episode's progress away first, which is
 * what "play again" does to a finished one; `recording: false` plays without
 * writing a save at all, which is what `?episode=` review does.
 */
export function startEpisode(
  scene: Phaser.Scene,
  booted: Booted,
  episode: Episode,
  opts: { replay?: boolean; recording?: boolean } = {}
): void {
  const { loaded, assets, save } = booted;
  const { world, copy, maps, credits } = loaded;
  const recording = opts.recording !== false;

  if (opts.replay) delete save.episodes[episode.id];
  const entry = save.episodes[episode.id];
  const resumed = recording && Boolean(entry);
  const place = recording
    ? resumePoint(save, episode.id, world)
    : { map: world.start.map, pos: [world.start.pos[0], world.start.pos[1]] as [number, number], facing: world.start.facing };

  const state = {
    world,
    maps,
    copy,
    episode,
    // A `once` scene declares its own `scene:<id>` flag, so an episode never
    // has to write one down and a save remembers the scene played
    // (DESIGN.md §3).
    flags: new Flags([...episode.flags, ...sceneFlags(episode)]),
    assets,
    credits,
    dialogueOpen: false,
    lastDialogueClose: 0,
    locked: false,
    introShown: false,
    taken: new Set<string>(),
    place,
    light: null,
    save,
    recording
  };
  startSession(state);
  if (resumed && entry) restoreEpisode(state, entry);

  setHud('title', world.title.toUpperCase());
  setHud('episode', `${episodeNumber(episode.id)} — “${episode.title}”`);

  scene.scene.launch('Ui');
  // Somebody carrying on where they left off has already met the town, so the
  // opening card is for a fresh start only.
  scene.scene.start('Map', { mapId: place.map, pos: place.pos, facing: place.facing, intro: !resumed });
}

/** "ep001" reads as "Ep. 1" — in the HUD and on the title screen alike. */
export const episodeNumber = (id: string): string => id.replace(/^ep0*(\d)/, 'Ep. $1');

export function setHud(slot: string, text: string): void {
  const el = document.querySelector<HTMLElement>(`[data-hud="${slot}"]`);
  if (el) el.textContent = text;
}

function fatal(heading: string, detail: string): void {
  const panel = document.createElement('div');
  panel.id = 'fatal';
  const title = document.createElement('h2');
  title.textContent = heading;
  const body = document.createElement('div');
  body.textContent = detail;
  panel.append(title, body);
  document.body.append(panel);
}
