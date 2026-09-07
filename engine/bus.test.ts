import { describe, expect, it } from 'vitest';
import { bus, EV } from './bus';

/**
 * bus.ts used to be a bare `new Phaser.Events.EventEmitter()`. It's now a
 * small hand-rolled emitter (see the comment in bus.ts) so that flags.ts —
 * and anything that imports it — can be tested under plain Node. These tests
 * pin the exact on/off/emit/context behaviour the rest of the engine relies
 * on, so a future change to bus.ts can't silently break scene wiring.
 *
 * Event names below are unique per test to stay independent of any other
 * file that shares this module's singleton `bus`.
 */
describe('bus', () => {
  it('emits to a registered listener with its arguments', () => {
    const calls: unknown[] = [];
    const handler = (payload: unknown) => calls.push(payload);
    bus.on('probe:basic', handler);
    bus.emit('probe:basic', { hello: 'world' });
    bus.off('probe:basic', handler);

    expect(calls).toEqual([{ hello: 'world' }]);
  });

  it('does nothing when a event has no listeners', () => {
    expect(() => bus.emit('probe:nobody-listening', 1, 2, 3)).not.toThrow();
  });

  it('binds the listener to the given context, like Phaser.Events.EventEmitter', () => {
    const seen: string[] = [];
    const target = {
      name: 'ui',
      greet(msg: string) {
        seen.push(`${this.name}: ${msg}`);
      }
    };
    bus.on('probe:context', target.greet, target);
    bus.emit('probe:context', 'hi');
    bus.off('probe:context', target.greet, target);

    expect(seen).toEqual(['ui: hi']);
  });

  it('off() removes only the matching fn+context pair, leaving other listeners on the same event', () => {
    const calls: string[] = [];
    const a = () => calls.push('a');
    const b = () => calls.push('b');
    bus.on('probe:pair', a);
    bus.on('probe:pair', b);

    bus.off('probe:pair', a);
    bus.emit('probe:pair');
    bus.off('probe:pair', b);

    expect(calls).toEqual(['b']);
  });

  it('off() with a different context leaves the original registration in place', () => {
    const calls: string[] = [];
    const fn = () => calls.push('called');
    const contextA = {};
    const contextB = {};

    bus.on('probe:context-mismatch', fn, contextA);
    bus.off('probe:context-mismatch', fn, contextB); // wrong context: should not remove it
    bus.emit('probe:context-mismatch');
    bus.off('probe:context-mismatch', fn, contextA);

    expect(calls).toEqual(['called']);
  });

  it('supports multiple listeners on the same event, called in registration order', () => {
    const order: string[] = [];
    const first = () => order.push('first');
    const second = () => order.push('second');
    bus.on('probe:order', first);
    bus.on('probe:order', second);

    bus.emit('probe:order');
    bus.off('probe:order', first);
    bus.off('probe:order', second);

    expect(order).toEqual(['first', 'second']);
  });

  it('EV names the engine-wide events', () => {
    expect(EV).toEqual({ say: 'say', toast: 'toast', flags: 'flags' });
  });
});
