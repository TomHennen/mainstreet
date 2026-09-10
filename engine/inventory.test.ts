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
  blurb: 'A fine ballpoint. Earl will want it back.'
};

const scout: EpisodeItem = {
  id: 'scout',
  map: 'jefferson',
  pos: [14, 20],
  requires: [],
  effects: [{ set: 'gotDog' }],
  lines: ['a dog']
  // Deliberately no blurb, to cover the name-only fallback.
};

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    world,
    maps: { town: fakeMap() },
    copy,
    episode: { id: 'ep', title: 'Ep', flags: ['hasPen', 'gotDog'], npcs: [], items: [pen, scout] },
    flags: new Flags(['hasPen', 'gotDog']),
    assets: { buildings: new Set(), chars: new Set(), portraits: new Set(), tilesets: new Set(), vehicles: new Set() },
    credits: {},
    dialogueOpen: false,
    lastDialogueClose: 0,
    locked: false,
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

  it('lists an episode item once its flag is set, title-cased, with its blurb', () => {
    const flags = new Flags(['hasPen', 'gotDog']);
    flags.set('hasPen');
    expect(withYou(fakeSession({ flags }))).toEqual([
      { id: 'pen', name: 'Pen', blurb: 'A fine ballpoint. Earl will want it back.' }
    ]);
  });

  it('lists an item recorded in `taken` even before its flag would say so', () => {
    expect(withYou(fakeSession({ taken: new Set(['pen']) }))).toEqual([
      { id: 'pen', name: 'Pen', blurb: 'A fine ballpoint. Earl will want it back.' }
    ]);
  });

  it('falls back to the name alone when an item has no blurb', () => {
    expect(withYou(fakeSession({ taken: new Set(['scout']) }))).toEqual([{ id: 'scout', name: 'Scout', blurb: undefined }]);
  });

  it('never lists an item neither taken nor flagged', () => {
    const flags = new Flags(['hasPen', 'gotDog']);
    flags.set('gotDog');
    // Only scout's flag is set; pen stays off the list.
    expect(withYou(fakeSession({ flags }))).toEqual([{ id: 'scout', name: 'Scout', blurb: undefined }]);
  });

  it('lists the held carry-verb token ahead of any items, by its blurb off the `give` fixture', () => {
    const maps = {
      town: fakeMap({
        fixtures: [
          { kind: 'woodpile', pos: [5, 7], give: 'log', heldBlurb: 'A split log, still cold from the pile.' }
        ]
      })
    };
    expect(withYou(fakeSession({ maps, held: 'log' }))).toEqual([
      { id: 'log', name: 'Log', blurb: 'A split log, still cold from the pile.' }
    ]);
  });

  it('shows the held token by name alone when its fixture has no blurb', () => {
    const maps = { town: fakeMap({ fixtures: [{ kind: 'woodpile', pos: [5, 7], give: 'log' }] }) };
    expect(withYou(fakeSession({ maps, held: 'log' }))).toEqual([{ id: 'log', name: 'Log', blurb: undefined }]);
  });

  it('shows the held token by name alone when the giving fixture is nowhere on the map', () => {
    expect(withYou(fakeSession({ held: 'log' }))).toEqual([{ id: 'log', name: 'Log', blurb: undefined }]);
  });

  it('finds the `give` fixture through an active overlay, not just the base map', () => {
    const overlays: MapOverlay[] = [
      {
        id: 'flood',
        map: 'town',
        requires: ['flooded'],
        tiles: [],
        fixtures: [{ kind: 'woodpile', pos: [9, 9], give: 'sandbag', heldBlurb: 'Heavier than it looks.' }]
      }
    ];
    const flags = new Flags(['hasPen', 'gotDog', 'flooded']);
    flags.set('flooded');
    const episode: Episode = { id: 'ep', title: 'Ep', flags: ['flooded'], npcs: [], overlays };
    expect(withYou(fakeSession({ episode, flags, held: 'sandbag' }))).toEqual([
      { id: 'sandbag', name: 'Sandbag', blurb: 'Heavier than it looks.' }
    ]);
  });

  it('title-cases a hyphenated id for both the held token and an item', () => {
    const maps = { town: fakeMap({ fixtures: [{ kind: 'woodpile', pos: [5, 7], give: 'mill-pond-log' }] }) };
    expect(withYou(fakeSession({ maps, held: 'mill-pond-log' }))[0].name).toBe('Mill Pond Log');
  });
});
