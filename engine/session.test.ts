import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creditFor,
  dialogueFor,
  itemsOn,
  itemTaken,
  itemVisible,
  npcsOn,
  propSignsOn,
  signFor,
  signLinesFor,
  startSession
} from './session';
import type { AssetIndex } from './session';
import type { Flags } from './flags';
import type { Credits, Episode, EpisodeItem, EpisodeNpc, World, WorldCopy } from './schema';

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
    shop: { name: 'Shop', wall: '#fff', roof: '#000' },
    // A standing sign of its own, and no episode sign anywhere for it.
    bakery: { name: 'Bakery', wall: '#fff', roof: '#000', sign: ['standing bakery line'] },
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
    { map: 'town', pos: [5, 5], requires: [], lines: ['prop a — first, wins'] },
    { map: 'town', pos: [5, 5], requires: [], lines: ['prop b — same tile, should be deduped'] },
    { map: 'other', pos: [5, 5], requires: [], lines: ['prop on a different map'] }
  ]
};

const assets: AssetIndex = {
  buildings: new Set(),
  chars: new Set(),
  portraits: new Set(),
  tilesets: new Set()
};

function boot(flags: Flags, overrides: { assets?: AssetIndex; credits?: Credits } = {}): void {
  startSession({
    world,
    // session.ts never touches the tile grids, only the episode lookups.
    maps: {},
    copy,
    episode,
    flags,
    assets: overrides.assets ?? assets,
    credits: overrides.credits ?? {},
    dialogueOpen: false,
    lastDialogueClose: 0,
    locked: false,
    introShown: false
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

  describe('signLinesFor — the episode overrides the standing sign', () => {
    it('reads the episode sign when there is one for this building', () => {
      expect(signLinesFor('shop')).toEqual(['sign fallback']);
    });

    it('still prefers the episode over world.json once a flag-gated sign matches', () => {
      boot(fakeFlags(['vip']));
      expect(signLinesFor('bakery')).toEqual(['bakery this week']);
    });

    it('reads the standing sign when the episode has none for this building', () => {
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
