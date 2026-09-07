import Phaser from 'phaser';
import { indexAssets, loadEpisode, loadWorld, queueAssets } from '../loader';
import { Flags } from '../flags';
import { startSession } from '../session';
import { validateEpisode, validateWorld } from '../validate';

/** Letters, digits, "-" and "_" only — keeps `?episode=` off the filesystem path. */
const SAFE_EPISODE_ID = /^[A-Za-z0-9_-]+$/;

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
      const { world, copy, episodes, maps, credits } = loaded;

      const problems = [
        ...validateWorld(world, maps),
        ...episodes.flatMap((episode) => validateEpisode(episode, world, maps))
      ];
      if (problems.length) {
        fatal(`World pack "${worldId}" is invalid`, problems.map((p) => `• ${p}`).join('\n'));
        return;
      }

      // M0 runs one episode at a time; the episode list is already ordered,
      // so the first entry is the default (DESIGN.md §3).
      let episode = episodes[0];
      if (!episode) {
        fatal(`World pack "${worldId}" has no episodes`, 'Add one to world.json → episodes.');
        return;
      }

      // `?episode=<id>` plays any episode file for review, listed in
      // world.json or not (DESIGN.md §3) — e.g. a shelved draft. A missing or
      // invalid id warns and keeps the default rather than showing a blank
      // screen (CLAUDE.md hard rule 3).
      const requestedId = new URLSearchParams(location.search).get('episode');
      if (requestedId) {
        if (!SAFE_EPISODE_ID.test(requestedId)) {
          console.warn(
            `?episode="${requestedId}" is not a valid episode id (letters, digits, "-", "_" only); playing "${episode.id}" instead.`
          );
        } else {
          try {
            const requested = await loadEpisode(world.id, requestedId);
            if (!requested) {
              console.warn(
                `?episode="${requestedId}" has no file at worlds/${world.id}/episodes/${requestedId}.json; playing "${episode.id}" instead.`
              );
            } else {
              const requestedProblems = validateEpisode(requested, world, maps);
              if (requestedProblems.length) {
                console.warn(
                  `?episode="${requestedId}" failed validation (${requestedProblems.join('; ')}); playing "${episode.id}" instead.`
                );
              } else {
                episode = requested;
              }
            }
          } catch (error) {
            console.warn(`?episode="${requestedId}" could not be loaded (${String(error)}); playing "${episode.id}" instead.`);
          }
        }
      }

      // Assets are indexed against whichever episode is actually being
      // played, so a review episode's own NPCs get their sprites probed too.
      const assetEpisodes = episodes.some((e) => e.id === episode.id) ? episodes : [...episodes, episode];
      const assets = await indexAssets({ ...loaded, episodes: assetEpisodes });
      queueAssets(this.load, loaded, assets);
      await new Promise<void>((resolve) => {
        this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        this.load.start();
        if (this.load.totalToLoad === 0) resolve();
      });

      startSession({
        world,
        maps,
        copy,
        episode,
        flags: new Flags(episode.flags),
        assets,
        credits,
        dialogueOpen: false,
        lastDialogueClose: 0,
        locked: false,
        introShown: false
      });

      setHud('title', world.title.toUpperCase());
      setHud('episode', `${episode.id.replace(/^ep0*(\d)/, 'Ep. $1')} — “${episode.title}”`);

      this.scene.launch('Ui');
      this.scene.start('Map', {
        mapId: world.start.map,
        pos: world.start.pos,
        facing: world.start.facing,
        intro: true
      });
    } catch (error) {
      fatal('Could not load the world pack', String(error));
    }
  }
}

function setHud(slot: string, text: string): void {
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
