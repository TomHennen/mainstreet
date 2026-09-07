import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creditFor,
  dialogueFor,
  hasSmallTalk,
  itemsOn,
  itemTaken,
  itemVisible,
  joinCredits,
  npcsOn,
  vehiclesOn,
  propSignsOn,
  session,
  signFor,
  signLinesFor,
  smallTalkFor,
  startSession
} from './session';
import type { AssetIndex } from './session';
import { autosave, episodeComplete, restoreEpisode, resumePoint } from './progress';
import { emptySave, loadSave, saveKey } from './save';
import type { StorageLike } from './save';
import { Flags as RealFlags } from './flags';
import type { Flags } from './flags';
import type { Credits, Episode, EpisodeItem, EpisodeNpc, EpisodeVehicle, World, WorldCopy } from './schema';

/**
 * A stand-in for the real Flags class (engine/flags.ts). session.ts only ever
 * calls `.met()` and `.get()` on its `flags` field, so a plain object with
 * those two methods is behaviourally identical for everything under test
 * here — and it sidesteps flags.ts's own module (already covered by
 * flags.test.ts) entirely.
 */
function fakeFlags(truthy: string[]): Flags {
  const set = new Set(truthy);
  return {
    met: (requires?: string[]) => !requires || requires.every((name) => set.has(name)),
    get: (name: string) => set.has(name)
  } as unknown as Flags;
}

const world: World = {
  id: 'testworld',
  title: 'Test World',
  episodes: ['ep'],
  player: { id: 'player', accent: '#fff' },
  start: { map: 'town', pos: [0, 0], facing: 'down' },
  buildings: {
    // A standing sign of its own, and episode signs on top of it.
    shop: { name: 'Shop', wall: '#fff', roof: '#000', sign: ['standing shop line'] },
    // A standing sign of its own, and no episode sign anywhere for it.
    bakery: { name: 'Bakery', wall: '#fff', roof: '#000', sign: ['standing bakery line'] },
    // A standing sign the episode deliberately takes the door away from.
    post: { name: 'Post Office', wall: '#fff', roof: '#000', sign: ['standing post line'] },
    // An episode sign but nothing standing behind it.
    depot: { name: 'Depot', wall: '#fff', roof: '#000' },
    // Neither: nothing to read at this door at all.
    barn: { name: 'Barn', wall: '#fff', roof: '#000' }
  },
  maps: {}
};

const copy: WorldCopy = {
  ui: {
    narrator: 'You',
    advance: '▼',
    unpainted: '',
    plaque: { painted: '', anonymous: '', unpainted: '' }
  },
  transitions: {}
};

const earl: EpisodeNpc = {
  id: 'earl',
  name: 'Earl',
  map: 'town',
  pos: [1, 1],
  dialogue: [
    { requires: ['done'], lines: ['done line'] },
    { requires: ['hasPen'], lines: ['pen line'], effects: [{ set: 'done' }] },
    { requires: [], lines: ['fallback line'], effects: [{ set: 'metEarl' }] }
  ]
};

const hannah: EpisodeNpc = {
  id: 'hannah',
  name: 'Hannah',
  map: 'other',
  pos: [2, 2],
  dialogue: [{ requires: [], lines: ['hi'] }]
};

const pen: EpisodeItem = {
  id: 'pen',
  map: 'town',
  pos: [3, 3],
  requires: ['metEarl'],
  effects: [{ set: 'hasPen' }],
  lines: ['a pen']
};

const episode: Episode = {
  id: 'ep',
  title: 'Ep',
  flags: ['metEarl', 'hasPen', 'done', 'vip'],
  npcs: [earl, hannah],
  items: [pen],
  signs: [
    // Deliberately ordered most-specific-first, like ep000: first match wins.
    { building: 'shop', requires: ['vip'], lines: ['sign vip'] },
    { building: 'shop', requires: [], lines: ['sign fallback'] },
    // Only shows for a VIP, so the bakery's standing sign covers everyone else.
    { building: 'bakery', requires: ['vip'], lines: ['bakery this week'] },
    // This week the post office door is the story's and nothing else.
    { building: 'post', requires: [], lines: ['post closed for the story'], replace: true },
    // Nothing standing behind this one, so the episode is all there is.
    { building: 'depot', requires: [], lines: ['depot this week'] },
    { map: 'town', pos: [5, 5], requires: [], lines: ['prop a — first, wins'] },
    { map: 'town', pos: [5, 5], requires: [], lines: ['prop b — same tile, should be deduped'] },
    { map: 'other', pos: [5, 5], requires: [], lines: ['prop on a different map'] }
  ]
};

const assets: AssetIndex = {
  buildings: new Set(),
  chars: new Set(),
  portraits: new Set(),
  tilesets: new Set(),
  vehicles: new Set()
};

function boot(
  flags: Flags,
  overrides: {
    assets?: AssetIndex;
    credits?: Credits;
    taken?: string[];
    world?: World;
    episode?: Episode;
  } = {}
): void {
  startSession({
    world: overrides.world ?? world,
    // session.ts never touches the tile grids, only the episode lookups.
    maps: {},
    copy,
    episode: overrides.episode ?? episode,
    flags,
    assets: overrides.assets ?? assets,
    credits: overrides.credits ?? {},
    dialogueOpen: false,
    lastDialogueClose: 0,
    locked: false,
    introShown: false,
    taken: new Set(overrides.taken ?? []),
    place: { map: 'town', pos: [0, 0], facing: 'down' },
    light: null,
    save: emptySave(),
    // The unit tests exercise lookups, not storage: nothing here writes a save.
    recording: false
  });
}

describe('session() before boot', () => {
  it('throws a descriptive error rather than returning undefined', async () => {
    // A fresh module instance, so this doesn't observe the `startSession`
    // calls the other tests in this file make against the statically
    // imported module.
    vi.resetModules();
    const fresh = await import('./session');
    expect(() => fresh.session()).toThrow(/used before boot finished/);
  });
});

describe('session helpers', () => {
  beforeEach(() => {
    boot(fakeFlags([]));
  });

  // A village's ambient traffic and the cars this week's story brought with
  // it are one list by the time anything reads them (DESIGN.md §2/§3).
  describe('vehiclesOn', () => {
    const van = { id: 'van', kind: 'van' as const, colour: '#ab947a', path: [[0, 0], [5, 0]] as [number, number][] };
    const truck = { id: 'truck', map: 'town', kind: 'pickup' as const, colour: '#8a6b48', pos: [2, 2] as [number, number] };
    const coupe = { id: 'coupe', map: 'other', kind: 'car' as const, colour: '#5c7f8f', pos: [1, 1] as [number, number] };

    const withTraffic = (episodeVehicles: EpisodeVehicle[]) =>
      boot(fakeFlags([]), {
        world: {
          ...world,
          maps: {
            town: { name: 'Town', kind: 'village', buildings: [], labels: [], exits: [], vehicles: [van] },
            other: { name: 'Other', kind: 'village', buildings: [], labels: [], exits: [] }
          }
        },
        episode: { ...episode, vehicles: episodeVehicles }
      });

    it('reads a village\'s own traffic when the episode brings none', () => {
      withTraffic([]);
      expect(vehiclesOn('town').map((v) => v.id)).toEqual(['van']);
      expect(vehiclesOn('other')).toEqual([]);
    });

    it('adds the episode\'s own cars, on the map each one names', () => {
      withTraffic([truck, coupe]);
      expect(vehiclesOn('town').map((v) => v.id)).toEqual(['van', 'truck']);
      expect(vehiclesOn('other').map((v) => v.id)).toEqual(['coupe']);
      expect(vehiclesOn('nowhere')).toEqual([]);
    });
  });

  it('npcsOn filters npcs by their declared map', () => {
    expect(npcsOn('town').map((n) => n.id)).toEqual(['earl']);
    expect(npcsOn('other').map((n) => n.id)).toEqual(['hannah']);
    expect(npcsOn('nowhere')).toEqual([]);
  });

  it('itemsOn filters items by their declared map', () => {
    expect(itemsOn('town').map((i) => i.id)).toEqual(['pen']);
    expect(itemsOn('other')).toEqual([]);
  });

  describe('dialogueFor — first match wins', () => {
    it('falls back to the unconditional entry when no flags are set', () => {
      expect(dialogueFor(earl)?.lines).toEqual(['fallback line']);
    });

    it('picks the earlier, more specific entry once its flag is set', () => {
      boot(fakeFlags(['hasPen']));
      expect(dialogueFor(earl)?.lines).toEqual(['pen line']);
    });

    it('picks the earliest matching entry even when a later one would also match', () => {
      // Both "done" (index 0) and "hasPen" (index 1) are met; index 0 wins.
      boot(fakeFlags(['hasPen', 'done']));
      expect(dialogueFor(earl)?.lines).toEqual(['done line']);
    });

    it('returns undefined if somehow nothing matches', () => {
      const noFallback: EpisodeNpc = { ...earl, dialogue: [{ requires: ['done'], lines: ['x'] }] };
      expect(dialogueFor(noFallback)).toBeUndefined();
    });
  });

  describe('itemVisible / itemTaken', () => {
    it('is hidden before its requires are met', () => {
      expect(itemVisible(pen)).toBe(false);
    });

    it('is visible once requires are met and it has not been taken', () => {
      boot(fakeFlags(['metEarl']));
      expect(itemVisible(pen)).toBe(true);
      expect(itemTaken(pen)).toBe(false);
    });

    it('is taken, and so no longer visible, once every flag its effects set is true', () => {
      boot(fakeFlags(['metEarl', 'hasPen']));
      expect(itemTaken(pen)).toBe(true);
      expect(itemVisible(pen)).toBe(false);
    });
  });

  describe('signFor — first match wins', () => {
    it('falls back to the unconditional sign', () => {
      expect(signFor('shop')?.lines).toEqual(['sign fallback']);
    });

    it('prefers the earlier, flag-gated sign once its flag is set', () => {
      boot(fakeFlags(['vip']));
      expect(signFor('shop')?.lines).toEqual(['sign vip']);
    });

    it('returns undefined for a building with no signs at all', () => {
      expect(signFor('no-such-building')).toBeUndefined();
    });
  });

  describe('signLinesFor — the episode reads on top of the standing sign', () => {
    it('reads the episode sign first and the standing sign after it', () => {
      expect(signLinesFor('shop')).toEqual(['sign fallback', 'standing shop line']);
    });

    it('adds a flag-gated episode sign to the standing sign the same way', () => {
      boot(fakeFlags(['vip']));
      expect(signLinesFor('bakery')).toEqual(['bakery this week', 'standing bakery line']);
      expect(signLinesFor('shop')).toEqual(['sign vip', 'standing shop line']);
    });

    it('drops the standing sign when the episode sign sets replace', () => {
      expect(signLinesFor('post')).toEqual(['post closed for the story']);
    });

    it('reads the episode sign alone when the building has no standing sign', () => {
      expect(signLinesFor('depot')).toEqual(['depot this week']);
    });

    it('reads the standing sign alone when the episode has none for this building', () => {
      expect(signLinesFor('bakery')).toEqual(['standing bakery line']);
    });

    it('reads the standing sign when the episode sign that exists is not unlocked', () => {
      // The only bakery sign in the episode requires "vip", which is not set.
      expect(signFor('bakery')).toBeUndefined();
      expect(signLinesFor('bakery')).toEqual(['standing bakery line']);
    });

    it('returns nothing for a building with neither kind of sign', () => {
      expect(signLinesFor('barn')).toEqual([]);
    });

    it('returns nothing for a building the world does not have at all', () => {
      expect(signLinesFor('no-such-building')).toEqual([]);
    });

    it('hands back a copy, so a caller adding a stand-in line cannot edit the pack', () => {
      const lines = signLinesFor('bakery');
      lines.push('scribbled on by the scene');
      expect(signLinesFor('bakery')).toEqual(['standing bakery line']);
    });
  });

  describe('creditFor', () => {
    it('returns the credit for a painted building that has one', () => {
      boot(fakeFlags([]), {
        assets: { ...assets, buildings: new Set(['shop']) },
        credits: { buildings: { shop: 'Jordan R.' } }
      });
      expect(creditFor('shop')).toBe('Jordan R.');
    });

    it('returns undefined for an unpainted building even if credits.json names it ahead of time', () => {
      boot(fakeFlags([]), { credits: { buildings: { shop: 'Jordan R.' } } });
      expect(creditFor('shop')).toBeUndefined();
    });

    it('returns undefined for a painted building with no credit', () => {
      boot(fakeFlags([]), { assets: { ...assets, buildings: new Set(['shop']) } });
      expect(creditFor('shop')).toBeUndefined();
    });

    it('joins an array credit into one line, in the order given', () => {
      boot(fakeFlags([]), {
        assets: { ...assets, buildings: new Set(['shop']) },
        credits: { buildings: { shop: ['Tom', 'Lana', 'Alice'] } }
      });
      expect(creditFor('shop')).toBe('Tom, Lana and Alice');
    });

    it('joins a two-name array credit with "and" and no comma', () => {
      boot(fakeFlags([]), {
        assets: { ...assets, buildings: new Set(['shop']) },
        credits: { buildings: { shop: ['Tom', 'Lana'] } }
      });
      expect(creditFor('shop')).toBe('Tom and Lana');
    });

    it('treats a single-element array credit the same as a plain string', () => {
      boot(fakeFlags([]), {
        assets: { ...assets, buildings: new Set(['shop']) },
        credits: { buildings: { shop: ['Tom'] } }
      });
      expect(creditFor('shop')).toBe('Tom');
    });

    it('takes assets/credits explicitly, for the title screen\'s Credits list, which has no running session', () => {
      const explicitAssets = { ...assets, buildings: new Set(['shop']) };
      const explicitCredits = { buildings: { shop: ['Tom', 'Lana'] } };
      expect(creditFor('shop', { assets: explicitAssets, credits: explicitCredits })).toBe('Tom and Lana');
    });
  });

  describe('joinCredits', () => {
    it('returns an empty string for no names', () => {
      expect(joinCredits([])).toBe('');
    });

    it('returns the name itself for one name', () => {
      expect(joinCredits(['Tom'])).toBe('Tom');
    });

    it('joins two names with "and"', () => {
      expect(joinCredits(['Tom', 'Lana'])).toBe('Tom and Lana');
    });

    it('joins three or more names with commas and "and" before the last, no Oxford comma', () => {
      expect(joinCredits(['Tom', 'Lana', 'Alice'])).toBe('Tom, Lana and Alice');
      expect(joinCredits(['Tom', 'Lana', 'Alice', 'Sam'])).toBe('Tom, Lana, Alice and Sam');
    });
  });

  describe('smallTalkFor / hasSmallTalk', () => {
    /** `startSession` directly, so each test can hand in its own `copy` and episode `smallTalk` without disturbing the shared fixtures above. */
    function bootFor(copyOverride: WorldCopy, episodeOverride: Partial<Episode> = {}): void {
      startSession({
        world,
        maps: {},
        copy: copyOverride,
        episode: { ...episode, ...episodeOverride },
        flags: fakeFlags([]),
        assets,
        credits: {},
        dialogueOpen: false,
        lastDialogueClose: 0,
        locked: false,
        introShown: false,
        taken: new Set(),
        place: { map: 'town', pos: [0, 0], facing: 'down' },
        light: null,
        save: emptySave(),
        recording: false
      });
    }

    const bareCopy = copy; // the module-level fixture: no passerby, no trivia
    const withPasserby: WorldCopy = { ...copy, ui: { ...copy.ui, passerby: ['passerby a', 'passerby b'] } };
    const withPasserbyAndTrivia: WorldCopy = {
      ...copy,
      ui: { ...copy.ui, passerby: ['passerby only line'], trivia: ['trivia a', 'trivia b'] }
    };

    it('has nothing to say, and nothing to roll for, with no passerby, smallTalk or trivia', () => {
      bootFor(bareCopy, { smallTalk: undefined });
      expect(hasSmallTalk()).toBe(false);
      expect(smallTalkFor({ id: 'earl' })).toBeUndefined();
    });

    it('falls back to ui.passerby, picked by id, when the episode has no smallTalk', () => {
      bootFor(withPasserby, { smallTalk: undefined });
      expect(hasSmallTalk()).toBe(true);
      const line = smallTalkFor({ id: 'earl' }, () => 0.99); // 0.99 never rolls trivia
      expect(['passerby a', 'passerby b']).toContain(line);
      expect(smallTalkFor({ id: 'earl' }, () => 0.99)).toBe(line); // same person, same line, every time
    });

    it("prefers the running episode's own smallTalk over ui.passerby when both are set", () => {
      bootFor(withPasserby, { smallTalk: ['episode line'] });
      expect(smallTalkFor({ id: 'earl' }, () => 0.99)).toBe('episode line');
    });

    it('rolls trivia about one time in five, via the injected random function', () => {
      bootFor(withPasserbyAndTrivia, { smallTalk: undefined });
      // random() < 0.2 wins the roll; a second call picks which trivia line.
      expect(smallTalkFor({ id: 'earl' }, () => 0)).toBe('trivia a');
      // Just under the cutoff still wins it.
      expect(smallTalkFor({ id: 'earl' }, () => 0.19)).toBe('trivia a');
      // At or past the cutoff, small talk wins instead.
      expect(smallTalkFor({ id: 'earl' }, () => 0.2)).toBe('passerby only line');
      expect(smallTalkFor({ id: 'earl' }, () => 0.99)).toBe('passerby only line');
    });

    it('never rolls trivia when the world has none, whatever the roll', () => {
      bootFor(withPasserby, { smallTalk: ['episode line'] });
      expect(smallTalkFor({ id: 'earl' }, () => 0)).toBe('episode line');
    });

    it('is a real roll, not saved or tied to which person is asked: the same id can get either', () => {
      bootFor(withPasserbyAndTrivia, { smallTalk: undefined });
      expect(smallTalkFor({ id: 'earl' }, () => 0)).toBe('trivia a');
      expect(smallTalkFor({ id: 'earl' }, () => 0.99)).toBe('passerby only line');
    });
  });

  describe('propSignsOn', () => {
    it('returns only the prop signs for the given map', () => {
      const signs = propSignsOn('town');
      expect(signs).toHaveLength(1);
      expect(signs[0].lines).toEqual(['prop a — first, wins']);
    });

    it('dedupes by tile, keeping the first sign at a position and dropping the rest', () => {
      const signs = propSignsOn('town');
      expect(signs.map((s) => s.lines[0])).not.toContain('prop b — same tile, should be deduped');
    });

    it('returns nothing for a map with no prop signs', () => {
      expect(propSignsOn('nowhere')).toEqual([]);
    });
  });
});


/**
 * The save side of the session (DESIGN.md §2). These use the real `Flags`
 * class rather than the stand-in above, because what is being checked is what
 * ends up written, and they hand `session.ts` a fake `localStorage` — the
 * tests run under plain Node, with no DOM (vitest.config.ts).
 */
describe('autosave, and picking an episode back up', () => {
  function withStorage(): Map<string, string> {
    const data = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key)
    };
    (globalThis as { localStorage?: StorageLike }).localStorage = storage;
    return data;
  }

  function record(flags: RealFlags, taken: string[] = []): Map<string, string> {
    const data = withStorage();
    startSession({
      world,
      maps: {},
      copy,
      episode,
      flags,
      assets,
      credits: {},
      dialogueOpen: false,
      lastDialogueClose: 0,
      locked: false,
      introShown: false,
      taken: new Set(taken),
      place: { map: 'town', pos: [4, 7], facing: 'left' },
      light: null,
      save: emptySave(),
      recording: true
    });
    return data;
  }

  afterEach(() => {
    delete (globalThis as { localStorage?: StorageLike }).localStorage;
  });

  it('writes the flags that are true, the items taken, and where the player is standing', () => {
    const flags = new RealFlags(episode.flags);
    flags.set('metEarl');
    const data = record(flags, ['pen']);
    autosave();
    const save = loadSave(world.id, {
      getItem: (key) => data.get(key) ?? null,
      setItem: () => {},
      removeItem: () => {}
    });
    expect(save.episodes.ep).toEqual({
      flags: ['metEarl'],
      taken: ['pen'],
      map: 'town',
      pos: [4, 7],
      facing: 'left'
    });
    expect(save.completed).toEqual([]);
  });

  it('adds the episode to the completed list once its done flag is set, and only once', () => {
    const flags = new RealFlags(episode.flags);
    record(flags);
    autosave();
    expect(episodeComplete()).toBe(false);
    flags.set('done');
    expect(episodeComplete()).toBe(true);
    autosave();
    autosave();
    expect(session().save.completed).toEqual(['ep']);
  });

  it('writes nothing at all when the session is not recording (a ?episode= review)', () => {
    const flags = new RealFlags(episode.flags);
    const data = record(flags);
    session().recording = false;
    flags.set('metEarl');
    autosave();
    expect(data.get(saveKey(world.id))).toBeUndefined();
  });

  it('restores the flags, the items taken and the place, ignoring flags the episode has dropped', () => {
    const flags = new RealFlags(episode.flags);
    record(flags);
    restoreEpisode(session(), {
      flags: ['metEarl', 'aFlagFromAnOlderCut'],
      taken: ['pen'],
      map: 'other',
      pos: [9, 2],
      facing: 'up'
    });
    expect(flags.get('metEarl')).toBe(true);
    expect(flags.declared('aFlagFromAnOlderCut')).toBe(false);
    expect(session().taken.has('pen')).toBe(true);
    expect(session().place).toEqual({ map: 'other', pos: [9, 2], facing: 'up' });
  });

  it('starts an episode with no save at the world start, and a saved one where it was left', () => {
    const save = emptySave();
    expect(resumePoint(save, 'ep', world)).toEqual({ map: 'town', pos: [0, 0], facing: 'down' });
    save.episodes.ep = { flags: [], taken: [], map: 'other', pos: [3, 4], facing: 'right' };
    expect(resumePoint(save, 'ep', world)).toEqual({ map: 'other', pos: [3, 4], facing: 'right' });
  });
});
