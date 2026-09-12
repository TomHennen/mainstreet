import { afterEach, describe, expect, it } from 'vitest';
import { scaled, setTimeScale, timeScale } from './timescale';

// setTimeScale has no getter that resets it, so every test that changes the
// scale puts it back — the module is a shared singleton, same as any other
// test in this file would otherwise leak into the next.
afterEach(() => {
  setTimeScale(1);
});

describe('timescale', () => {
  it('defaults to 1, and scaled(x) is x unchanged at that default', () => {
    expect(timeScale()).toBe(1);
    expect(scaled(200)).toBe(200);
    expect(scaled(0)).toBe(0);
  });

  it('setTimeScale changes what timeScale() and scaled() report', () => {
    setTimeScale(2);
    expect(timeScale()).toBe(2);
    expect(scaled(200)).toBe(100);
  });

  it('ignores 0, negative, NaN and Infinity — a stray or malformed ?timescale= leaves normal-speed play alone', () => {
    setTimeScale(4);
    expect(timeScale()).toBe(4);
    setTimeScale(0);
    expect(timeScale()).toBe(4);
    setTimeScale(-1);
    expect(timeScale()).toBe(4);
    setTimeScale(NaN);
    expect(timeScale()).toBe(4);
    setTimeScale(Infinity);
    expect(timeScale()).toBe(4);
  });
});
