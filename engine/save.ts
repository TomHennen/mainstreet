/**
 * Saves (DESIGN.md §2): one localStorage key per world, `mainstreet.<worldId>`.
 *
 * Pure and world-agnostic — it stores episode ids, flag names and a tile, and
 * nothing else. No names, no times, no counts, nothing personal, nothing sent
 * anywhere (CLAUDE.md hard rule 7).
 *
 * Every read is defensive. A save from a future version, hand-edited JSON,
 * half-written data, or a browser that throws on `localStorage` at all
 * (private mode, storage disabled) is treated as "no save yet" — the player
 * starts the episode fresh rather than meeting an error. Losing a save is a
 * small sadness; a blank screen is worse (hard rule 3).
 */
import { FACINGS } from './schema';
import type { Facing, Vec2 } from './schema';

export const SAVE_VERSION = 1;

/** Where one episode got to: what is true, what has been picked up, and where the player stood. */
export interface EpisodeSave {
  flags: string[];
  taken: string[];
  map: string;
  pos: Vec2;
  facing: Facing;
}

export interface SaveFile {
  v: typeof SAVE_VERSION;
  /** Episode ids played all the way through. Replaying one keeps it here. */
  completed: string[];
  episodes: Record<string, EpisodeSave>;
}

/** The slice of `localStorage` this module uses; a test can hand in its own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const saveKey = (worldId: string): string => `mainstreet.${worldId}`;

export const emptySave = (): SaveFile => ({ v: SAVE_VERSION, completed: [], episodes: {} });

/**
 * The browser's own storage, or null where there isn't one. Touching
 * `localStorage` can itself throw (some privacy modes), so even the lookup is
 * wrapped.
 */
function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function readEpisode(value: unknown): EpisodeSave | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.map !== 'string' || !entry.map) return null;
  if (!isStringArray(entry.flags) || !isStringArray(entry.taken)) return null;
  const pos = entry.pos;
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  if (typeof entry.facing !== 'string' || !FACINGS.includes(entry.facing as Facing)) return null;
  return {
    flags: [...entry.flags],
    taken: [...entry.taken],
    map: entry.map,
    pos: [pos[0] as number, pos[1] as number],
    facing: entry.facing as Facing
  };
}

/**
 * The world's save, or an empty one. Never throws and never returns something
 * half-understood: an episode entry that doesn't parse is dropped on its own,
 * and anything wrong above that level gives an empty save.
 */
export function loadSave(worldId: string, storage: StorageLike | null = browserStorage()): SaveFile {
  if (!storage) return emptySave();
  let raw: string | null;
  try {
    raw = storage.getItem(saveKey(worldId));
  } catch {
    return emptySave();
  }
  if (!raw) return emptySave();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySave();
  }
  if (!parsed || typeof parsed !== 'object') return emptySave();

  const file = parsed as Record<string, unknown>;
  if (file.v !== SAVE_VERSION) return emptySave();

  const save = emptySave();
  if (isStringArray(file.completed)) save.completed = [...new Set(file.completed)];
  if (file.episodes && typeof file.episodes === 'object') {
    for (const [id, value] of Object.entries(file.episodes as Record<string, unknown>)) {
      const entry = readEpisode(value);
      if (entry) save.episodes[id] = entry;
    }
  }
  return save;
}

/**
 * Writes the whole file — one `JSON.stringify`, because this runs on every
 * flag a player sets. A storage that refuses (full, disabled) is not an
 * error the player should ever see: the game carries on unsaved.
 * Returns whether it landed, for tests.
 */
export function writeSave(worldId: string, save: SaveFile, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(saveKey(worldId), JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Forgets a world's save entirely. Also never throws. */
export function clearSave(worldId: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(saveKey(worldId));
  } catch {
    /* nothing to do: there is no save to lose */
  }
}

/** True when this episode has somewhere to carry on from. */
export const hasProgress = (save: SaveFile, episodeId: string): boolean =>
  Object.prototype.hasOwnProperty.call(save.episodes, episodeId);

export const isCompleted = (save: SaveFile, episodeId: string): boolean => save.completed.includes(episodeId);

/**
 * "Start over" (DESIGN.md §2): a true reset, unlike "play again", which keeps
 * the episode on the `completed` list so a finished story stays remembered as
 * finished. This forgets both where the player got to *and* that they ever
 * finished it, and writes at once — a player who confirms this and never
 * plays again should still find it forgotten. Mutates `save` in place, the
 * same way `startEpisode`'s replay does.
 */
export function resetEpisode(
  worldId: string,
  save: SaveFile,
  episodeId: string,
  storage: StorageLike | null = browserStorage()
): void {
  delete save.episodes[episodeId];
  save.completed = save.completed.filter((id) => id !== episodeId);
  writeSave(worldId, save, storage);
}

/**
 * "Forget everything" (DESIGN.md §2): every episode's progress and its done
 * mark, gone at once. Returns a fresh, empty save for the caller to carry on
 * with in memory — the title screen's own copy of the save is otherwise none
 * the wiser that storage was cleared out from under it.
 */
export function forgetAll(worldId: string, storage: StorageLike | null = browserStorage()): SaveFile {
  clearSave(worldId, storage);
  return emptySave();
}
