import { describe, expect, it } from 'vitest';
import { Flags } from './flags';
import { bus, EV } from './bus';

describe('Flags', () => {
  it('starts every declared flag false', () => {
    const flags = new Flags(['a', 'b']);
    expect(flags.get('a')).toBe(false);
    expect(flags.get('b')).toBe(false);
  });

  it('declared() reports only names passed to the constructor', () => {
    const flags = new Flags(['a']);
    expect(flags.declared('a')).toBe(true);
    expect(flags.declared('b')).toBe(false);
  });

  it('set() flips a declared flag true by default', () => {
    const flags = new Flags(['a']);
    flags.set('a');
    expect(flags.get('a')).toBe(true);
  });

  it('set() accepts an explicit value, including turning a flag back off', () => {
    const flags = new Flags(['a']);
    flags.set('a', true);
    expect(flags.get('a')).toBe(true);
    flags.set('a', false);
    expect(flags.get('a')).toBe(false);
  });

  it('set() throws for an undeclared flag (declare-before-use, enforced at runtime too)', () => {
    const flags = new Flags(['a']);
    expect(() => flags.set('nope')).toThrow(/"nope" was set but never declared/);
  });

  it('get() on an undeclared flag returns false rather than throwing', () => {
    const flags = new Flags(['a']);
    expect(flags.get('nope')).toBe(false);
  });

  describe('met() — requires is an AND of flags', () => {
    it('treats undefined or an empty list as always met', () => {
      const flags = new Flags(['a']);
      expect(flags.met(undefined)).toBe(true);
      expect(flags.met([])).toBe(true);
    });

    it('is false until every listed flag is true', () => {
      const flags = new Flags(['a', 'b']);
      expect(flags.met(['a', 'b'])).toBe(false);
      flags.set('a');
      expect(flags.met(['a', 'b'])).toBe(false);
      flags.set('b');
      expect(flags.met(['a', 'b'])).toBe(true);
    });

    it('is false, not throwing, when a listed flag was never declared', () => {
      const flags = new Flags(['a']);
      flags.set('a');
      expect(flags.met(['a', 'nope'])).toBe(false);
    });
  });

  describe('apply()', () => {
    it('is a no-op for undefined effects', () => {
      const flags = new Flags(['a']);
      expect(() => flags.apply(undefined)).not.toThrow();
      expect(flags.get('a')).toBe(false);
    });

    it('applies a "set" effect', () => {
      const flags = new Flags(['a']);
      flags.apply([{ set: 'a' }]);
      expect(flags.get('a')).toBe(true);
    });

    it('emits a "toast" effect on the shared bus, without touching any flag', () => {
      const flags = new Flags(['a']);
      const seen: string[] = [];
      const onToast = (message: string) => seen.push(message);
      bus.on(EV.toast, onToast);
      try {
        flags.apply([{ toast: 'Episode complete' }]);
      } finally {
        bus.off(EV.toast, onToast);
      }
      expect(seen).toEqual(['Episode complete']);
      expect(flags.get('a')).toBe(false);
    });

    it('applies every effect in one list, set before toast, exactly as ep000 does', () => {
      const flags = new Flags(['done']);
      const seen: string[] = [];
      const onToast = (message: string) => seen.push(message);
      bus.on(EV.toast, onToast);
      try {
        flags.apply([{ set: 'done' }, { toast: 'Episode complete — new story next week' }]);
      } finally {
        bus.off(EV.toast, onToast);
      }
      expect(flags.get('done')).toBe(true);
      expect(seen).toEqual(['Episode complete — new story next week']);
    });

    it('propagates the declare-before-use error for a "set" on an undeclared flag', () => {
      const flags = new Flags([]);
      expect(() => flags.apply([{ set: 'nope' }])).toThrow(/never declared/);
    });
  });

  it('snapshot() returns a plain object with every declared flag', () => {
    const flags = new Flags(['a', 'b']);
    flags.set('a');
    expect(flags.snapshot()).toEqual({ a: true, b: false });
  });
});
