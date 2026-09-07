import { describe, expect, it } from 'vitest';
import {
  clearSave,
  emptySave,
  forgetAll,
  hasProgress,
  isCompleted,
  loadSave,
  resetEpisode,
  saveKey,
  SAVE_VERSION,
  writeSave
} from './save';
import type { SaveFile, StorageLike } from './save';

/** A localStorage stand-in: the tests run under plain Node, with no DOM. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  };
}

/** One that refuses everything, the way a private-mode browser can. */
const hostileStorage = (): StorageLike => ({
  getItem() {
    throw new Error('storage is disabled');
  },
  setItem() {
    throw new Error('storage is disabled');
  },
  removeItem() {
    throw new Error('storage is disabled');
  }
});

const filled = (): SaveFile => ({
  v: SAVE_VERSION,
  completed: ['ep000'],
  episodes: {
    ep001: { flags: ['metEarl'], taken: ['scout'], map: 'jefferson', pos: [14, 20], facing: 'left' }
  }
});

describe('the save key', () => {
  it('is one localStorage key per world (DESIGN.md §2)', () => {
    expect(saveKey('route10')).toBe('mainstreet.route10');
  });
});

describe('writeSave / loadSave', () => {
  it('round-trips flags, taken items, the map, the tile and the facing', () => {
    const storage = fakeStorage();
    expect(writeSave('route10', filled(), storage)).toBe(true);
    expect(loadSave('route10', storage)).toEqual(filled());
  });

  it('writes one JSON value under the world key and nothing else', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    expect([...storage.data.keys()]).toEqual(['mainstreet.route10']);
  });

  it('keeps worlds apart', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    expect(loadSave('other', storage)).toEqual(emptySave());
  });

  it('gives an empty save when there is nothing stored', () => {
    expect(loadSave('route10', fakeStorage())).toEqual(emptySave());
  });
});

describe('a save that cannot be trusted is treated as no save', () => {
  const empty = emptySave();

  it('ignores JSON that does not parse', () => {
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': '{not json' }))).toEqual(empty);
  });

  it('ignores a value that is not an object', () => {
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': '"hello"' }))).toEqual(empty);
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': 'null' }))).toEqual(empty);
  });

  it('ignores another version, in either direction', () => {
    const future = JSON.stringify({ ...filled(), v: 2 });
    const ancient = JSON.stringify({ ...filled(), v: 0 });
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': future }))).toEqual(empty);
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': ancient }))).toEqual(empty);
  });

  it('drops only the episode entries that are malformed', () => {
    const raw = JSON.stringify({
      v: SAVE_VERSION,
      completed: ['ep000', 'ep000'],
      episodes: {
        good: { flags: ['a'], taken: [], map: 'town', pos: [1, 2], facing: 'up' },
        noMap: { flags: [], taken: [], pos: [1, 2], facing: 'up' },
        badPos: { flags: [], taken: [], map: 'town', pos: [1, 2, 3], facing: 'up' },
        badFacing: { flags: [], taken: [], map: 'town', pos: [1, 2], facing: 'sideways' },
        badFlags: { flags: [7], taken: [], map: 'town', pos: [1, 2], facing: 'up' },
        notAnObject: 'nope'
      }
    });
    const save = loadSave('route10', fakeStorage({ 'mainstreet.route10': raw }));
    expect(Object.keys(save.episodes)).toEqual(['good']);
    // A duplicate in `completed` is folded away rather than kept twice.
    expect(save.completed).toEqual(['ep000']);
  });

  it('ignores a completed list that is not a list of strings', () => {
    const raw = JSON.stringify({ v: SAVE_VERSION, completed: 'ep000', episodes: {} });
    expect(loadSave('route10', fakeStorage({ 'mainstreet.route10': raw })).completed).toEqual([]);
  });
});

describe('a browser with no storage at all', () => {
  it('reads as no save, and never throws', () => {
    expect(loadSave('route10', null)).toEqual(emptySave());
    expect(loadSave('route10', hostileStorage())).toEqual(emptySave());
  });

  it('writes without throwing, and says the write did not land', () => {
    expect(writeSave('route10', filled(), null)).toBe(false);
    expect(writeSave('route10', filled(), hostileStorage())).toBe(false);
  });

  it('clears without throwing', () => {
    expect(() => clearSave('route10', null)).not.toThrow();
    expect(() => clearSave('route10', hostileStorage())).not.toThrow();
  });
});

describe('clearSave', () => {
  it('forgets the world it is given and leaves the others alone', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    writeSave('other', filled(), storage);
    clearSave('route10', storage);
    expect(loadSave('route10', storage)).toEqual(emptySave());
    expect(loadSave('other', storage)).toEqual(filled());
  });
});

describe('what the title screen asks a save', () => {
  it('knows which episodes have somewhere to carry on from, and which are finished', () => {
    const save = filled();
    expect(hasProgress(save, 'ep001')).toBe(true);
    expect(hasProgress(save, 'ep000')).toBe(false);
    expect(isCompleted(save, 'ep000')).toBe(true);
    expect(isCompleted(save, 'ep001')).toBe(false);
  });
});

describe('resetEpisode ("Start over", DESIGN.md §2)', () => {
  it('clears progress on an episode that had somewhere to carry on from', () => {
    const storage = fakeStorage();
    const save = filled();
    resetEpisode('route10', save, 'ep001', storage);
    expect(hasProgress(save, 'ep001')).toBe(false);
    expect(loadSave('route10', storage).episodes.ep001).toBeUndefined();
  });

  it('forgets that a finished episode was ever finished, unlike "play again"', () => {
    const storage = fakeStorage();
    const save = filled();
    resetEpisode('route10', save, 'ep000', storage);
    expect(isCompleted(save, 'ep000')).toBe(false);
    expect(loadSave('route10', storage).completed).toEqual([]);
  });

  it('leaves every other episode untouched', () => {
    const storage = fakeStorage();
    const save = filled();
    resetEpisode('route10', save, 'ep000', storage);
    expect(hasProgress(save, 'ep001')).toBe(true);
  });

  it('writes the reset at once, not on some later autosave', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    const save = filled();
    resetEpisode('route10', save, 'ep001', storage);
    expect(loadSave('route10', storage)).toEqual(save);
  });

  it('does nothing harmful to an episode with neither progress nor a done mark', () => {
    const storage = fakeStorage();
    const save = emptySave();
    resetEpisode('route10', save, 'ep999', storage);
    expect(save).toEqual(emptySave());
  });

  it('still resets in memory when storage refuses the write', () => {
    const save = filled();
    expect(() => resetEpisode('route10', save, 'ep001', hostileStorage())).not.toThrow();
    expect(hasProgress(save, 'ep001')).toBe(false);
  });
});

describe('forgetAll ("Forget everything", DESIGN.md §2)', () => {
  it('clears the world\'s whole save and hands back a fresh, empty one', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    const fresh = forgetAll('route10', storage);
    expect(fresh).toEqual(emptySave());
    expect(loadSave('route10', storage)).toEqual(emptySave());
  });

  it('leaves other worlds\' saves alone', () => {
    const storage = fakeStorage();
    writeSave('route10', filled(), storage);
    writeSave('other', filled(), storage);
    forgetAll('route10', storage);
    expect(loadSave('other', storage)).toEqual(filled());
  });

  it('never throws when storage refuses', () => {
    expect(() => forgetAll('route10', hostileStorage())).not.toThrow();
  });
});
