/**
 * The running session's progress: what gets written to the save, and what a
 * saved episode is put back to (DESIGN.md §2).
 *
 * It sits between `engine/save.ts`, which is pure storage and knows nothing
 * about a session, and `engine/session.ts`, which is lookups over loaded data
 * and deliberately imports nothing at runtime.
 */
import { hasProgress, writeSave } from './save';
import type { EpisodeSave, SaveFile } from './save';
import { DONE_FLAG } from './schema';
import { session, sessionOrNull } from './session';
import type { Session } from './session';
import type { Facing, Vec2, World } from './schema';

/** True once the episode's completion flag is set (DESIGN.md §3). */
export function episodeComplete(state: Session = session()): boolean {
  return state.flags.declared(DONE_FLAG) && state.flags.get(DONE_FLAG);
}

/**
 * Writes where this episode has got to (DESIGN.md §2). Called on every flag
 * set, every item taken, and on arriving somewhere new — so it does the least
 * it can: fold the change into the save already in memory and stringify once.
 * A completed episode is added to `completed` the first time it finishes, and
 * stays there when it is played again.
 */
export function autosave(): void {
  const state = sessionOrNull();
  if (!state || !state.recording) return;

  const flags = state.flags.snapshot();
  const entry: EpisodeSave = {
    flags: Object.keys(flags).filter((name) => flags[name]),
    taken: [...state.taken],
    map: state.place.map,
    pos: [state.place.pos[0], state.place.pos[1]],
    facing: state.place.facing
  };
  state.save.episodes[state.episode.id] = entry;
  if (episodeComplete(state) && !state.save.completed.includes(state.episode.id)) {
    state.save.completed.push(state.episode.id);
  }
  writeSave(state.world.id, state.save);
}

/**
 * Puts a saved episode back the way the player left it: the flags that were
 * true, the items that were gone, and where they were standing. A flag the
 * episode no longer declares is ignored rather than fatal — an episode may
 * have been edited since (`Flags.restore`).
 */
export function restoreEpisode(state: Session, entry: EpisodeSave): void {
  state.flags.restore(entry.flags);
  for (const id of entry.taken) state.taken.add(id);
  state.place = { map: entry.map, pos: [entry.pos[0], entry.pos[1]], facing: entry.facing };
}

/**
 * Where an episode should start: the tile it was left on when there is a save
 * for it, otherwise the world's start (DESIGN.md §2).
 */
export function resumePoint(save: SaveFile, episodeId: string, world: World): { map: string; pos: Vec2; facing: Facing } {
  const entry = hasProgress(save, episodeId) ? save.episodes[episodeId] : undefined;
  if (!entry) return { map: world.start.map, pos: [world.start.pos[0], world.start.pos[1]], facing: world.start.facing };
  return { map: entry.map, pos: [entry.pos[0], entry.pos[1]], facing: entry.facing };
}
