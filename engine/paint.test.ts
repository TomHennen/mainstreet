import { describe, expect, it } from 'vitest';
import { improveUrl, paintUrl } from './paint';

describe('paintUrl', () => {
  it('appends the building to a base that already has a query', () => {
    expect(paintUrl('https://example.test/studio/?world=route10', 'stewarts')).toBe(
      'https://example.test/studio/?world=route10&building=stewarts'
    );
  });

  it('starts the query when the base has none', () => {
    expect(paintUrl('https://example.test/studio/', 'the-belvedere')).toBe(
      'https://example.test/studio/?building=the-belvedere'
    );
  });

  it('escapes anything odd in a building id', () => {
    expect(paintUrl('https://example.test/studio/?world=w', 'a b&c')).toBe(
      'https://example.test/studio/?world=w&building=a%20b%26c'
    );
  });

  it('offers no link when the world has no contribution page (CLAUDE.md #3)', () => {
    expect(paintUrl(undefined, 'stewarts')).toBeUndefined();
    expect(paintUrl('', 'stewarts')).toBeUndefined();
  });
});

describe('improveUrl', () => {
  it('appends the building and improve=1 to a base that already has a query', () => {
    expect(improveUrl('https://example.test/studio/?world=route10', 'middle-brook-cafe')).toBe(
      'https://example.test/studio/?world=route10&building=middle-brook-cafe&improve=1'
    );
  });

  it('starts the query when the base has none, then adds improve=1', () => {
    expect(improveUrl('https://example.test/studio/', 'middle-brook-cafe')).toBe(
      'https://example.test/studio/?building=middle-brook-cafe&improve=1'
    );
  });

  it('offers no link when the world has no contribution page, same as paintUrl', () => {
    expect(improveUrl(undefined, 'middle-brook-cafe')).toBeUndefined();
    expect(improveUrl('', 'middle-brook-cafe')).toBeUndefined();
  });
});
