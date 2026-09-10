import { describe, expect, it } from 'vitest';
import { withYou } from './inventory';
import type { Session } from './session';
import { Flags } from './flags';
import { emptySave } from './save';
import type { Episode, EpisodeItem, GameMap, MapOverlay, World, WorldCopy } from './schema';

const world: World = {
  id: 'testworld',
  title: 'Test World',
  episodes: ['ep'],
  player: { id: 'player', accent: '#fff' },
  start: { map: 'town', pos: [0, 0], facing: 'down' },
  buildings: {},
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

function fakeMap(overrides: Partial<GameMap> = {}): GameMap {
  return {
    name: 'Town',
    kind: 'village',
    buildings: [],
    labels: [],
    exits: [],
    width: 20,
    height: 20,
    layers: [],
    tilesets: [],
    ...overrides
  };
}

const pen: EpisodeItem = {
  id: 'pen',
  map: 'town',
  pos: [3, 3],
  requires: [],
  effects: [{ set: 'hasPen' }],
  lines: ['a pen'],
  name: "Earl's pen",
  blurb: 'A fine ballpoint. Earl will want it back.',
  until: 'done'
};

const scout: EpisodeItem = {
  id: 'scout',
  map: 'jefferson',
  pos: [14, 20],
  requires: [],
  effects: [{ set: 'gotDog' }],
  lines: ['a dog']
  // Deliberately no name, no blurb, no until — covers every fallback at once.
};

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    world,
    maps: { town: fakeMap() },
    copy,
    episode: { id: 'ep', title: 'Ep', flags: ['hasPen', 'gotDog', 'done'], npcs: [], items: [pen, scout] },
    flags: new Flags(['hasPen', 'gotDog', 'done']),
    assets: { buildings: new Set(), chars: new Set(), portraits: new Set(), tilesets: new Set(), vehicles: new Set() },
    credits: {},
    dialogueOpen: false,
    lastDialogueClose: 0,
    locked: false,
    sceneRunning: false,
    introShown: false,
    taken: new Set(),
    held: null,
    place: { map: 'town', pos: [0, 0], facing: 'down' },
    light: null,
    save: emptySave(),
    recording: false,
    ...overrides
  };
}

describe('withYou', () => {
  it('is empty with nothing held and nothing taken', () => {
    expect(withYou(fakeSession())).toEqual([]);
  });

  it('never lists an item on its flag alone — only `taken` puts it on the list', () => {
    // pen's own effect flag is set, but it was never recorded as taken (an
    // episode that sets the flag some other way, or a stray hand-edited
    // save) — the ground-visibility rule (`itemTaken`, engine/session.ts)
    // does not apply here.
    const flags = new Flags(['hasPen', 'gotDog', 'done']);
    flags.set('hasPen');
    expect(withYou(fakeSession({ flags }))).toEqual([]);
  });

  it('lists a taken item by its own name and blurb', () => {
    expect(withYou(fakeSession({ taken: new Set(['pen']) }))).toEqual([
      { id: 'pen', name: "Earl's pen", blurb: 'A fine ballpoint. Earl will want it back.' }
    ]);
  });

  it('falls back to the id verbatim, no title-casing, when an item has no `name`', () => {
    expect(withYou(fakeSession({ taken: new Set(['scout']) }))).toEqual([{ id: 'scout', name: 'scout', blurb: undefined }]);
  });

  it('drops a taken item off the list once its `until` flag is set', () => {
    const flags = new Flags(['hasPen', 'gotDog', 'done']);
    flags.set('done');
    expect(withYou(fakeSession({ taken: new Set(['pen']), flags }))).toEqual([]);
  });

  it('keeps a taken item with no `until` on the list forever', () => {
    const flags = new Flags(['hasPen', 'gotDog', 'done']);
    flags.set('done');
    expect(withYou(fakeSession({ taken: new Set(['scout']), flags }))).toEqual([
      { id: 'scout', name: 'scout', blurb: undefined }
    ]);
  });

  it('lists the held carry-verb token ahead of any items, by its name and blurb off the `give` fixture', () => {
    const maps = {
      town: fakeMap({
        fixtures: [
          {
            kind: 'woodpile',
            pos: [5, 7],
            give: 'log',
            heldName: 'A split log',
            heldBlurb: 'A split log, still cold from the pile.'
          }
        ]
      })
    };
    expect(withYou(fakeSession({ maps, held: 'log' }))).toEqual([
      { id: 'log', name: 'A split log', blurb: 'A split log, still cold from the pile.' }
    ]);
  });

  it('falls back to the token id verbatim when its fixture has no `heldName`', () => {
    const maps = { town: fakeMap({ fixtures: [{ kind: 'woodpile', pos: [5, 7], give: 'log' }] }) };
    expect(withYou(fakeSession({ maps, held: 'log' }))).toEqual([{ id: 'log', name: 'log', blurb: undefined }]);
  });

  it('falls back to the token id verbatim when the giving fixture is nowhere on the map', () => {
    expect(withYou(fakeSession({ held: 'log' }))).toEqual([{ id: 'log', name: 'log', blurb: undefined }]);
  });

  it('finds the `give` fixture through an active overlay, not just the base map', () => {
    const overlays: MapOverlay[] = [
      {
        id: 'flood',
        map: 'town',
        requires: ['flooded'],
        tiles: [],
        fixtures: [{ kind: 'woodpile', pos: [9, 9], give: 'sandbag', heldName: 'A sandbag', heldBlurb: 'Heavier than it looks.' }]
      }
    ];
    const flags = new Flags(['hasPen', 'gotDog', 'done', 'flooded']);
    flags.set('flooded');
    const episode: Episode = { id: 'ep', title: 'Ep', flags: ['flooded'], npcs: [], overlays };
    expect(withYou(fakeSession({ episode, flags, held: 'sandbag' }))).toEqual([
      { id: 'sandbag', name: 'A sandbag', blurb: 'Heavier than it looks.' }
    ]);
  });
});
