import Phaser from 'phaser';
import { indexAssets, loadWorld, queueAssets } from '../loader';
import { Flags } from '../flags';
import { startSession } from '../session';
import { validateEpisode, validateWorld } from '../validate';

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

      // M0 runs one episode at a time; the episode list is already ordered.
      const episode = episodes[0];
      if (!episode) {
        fatal(`World pack "${worldId}" has no episodes`, 'Add one to world.json → episodes.');
        return;
      }

      const assets = await indexAssets(loaded);
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
