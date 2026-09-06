import { bus, EV } from './bus';
import type { Effect } from './schema';

/**
 * Episode flags. Declare-before-use is enforced at load time by `validate.ts`;
 * this class enforces it again at runtime so a schema hole fails loudly rather
 * than silently creating a flag nobody declared.
 */
export class Flags {
  private readonly values = new Map<string, boolean>();

  constructor(declared: string[]) {
    for (const name of declared) this.values.set(name, false);
  }

  declared(name: string): boolean {
    return this.values.has(name);
  }

  get(name: string): boolean {
    return this.values.get(name) === true;
  }

  set(name: string, value = true): void {
    if (!this.values.has(name)) {
      throw new Error(`flag "${name}" was set but never declared`);
    }
    this.values.set(name, value);
  }

  /** `requires` is an AND of flags, per DESIGN.md §3. */
  met(requires: string[] | undefined): boolean {
    if (!requires || requires.length === 0) return true;
    return requires.every((name) => this.get(name));
  }

  apply(effects: Effect[] | undefined): void {
    if (!effects) return;
    for (const effect of effects) {
      if (effect.set) this.set(effect.set);
      if (effect.toast) bus.emit(EV.toast, effect.toast);
    }
  }

  snapshot(): Record<string, boolean> {
    return Object.fromEntries(this.values);
  }
}
