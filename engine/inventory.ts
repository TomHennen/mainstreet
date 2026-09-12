/**
 * What the player has with them right now (DESIGN.md §2, "With you") — the
 * small glance-at-it list Tom asked for, not an inventory: no counts, no
 * slots, nothing to manage. Two things ever end up on it, and only two:
 *
 * - The carry-verb token this map handed over (`session().held`), if any —
 *   the log, on its way from the woodpile to the fire.
 * - Every episode item picked up (`session().taken`) and not yet handed back
 *   (`item.until`, below) — the pen, Scout.
 *
 * There is no companion mechanic to fold in here. Scout (ep001, "The Dog Who
 * Got Around") is an ordinary episode item: picked up off the ground exactly
 * like the pen, and carried the same way — nothing in the engine or the
 * schema makes anything follow the player around. If a later episode wants
 * that, it is new engine work, not a gap in this list.
 *
 * Pure: everything here is a lookup over an already-loaded session, like
 * `engine/session.ts`'s own helpers, so `engine/scenes/ui.ts`'s panel and
 * `engine/inventory.test.ts` both call this and nothing else.
 */
import { activeOverlays, withOverlays } from './overlay';
import type { Session } from './session';
import type { Fixture } from './schema';

export interface Entry {
  /** The token or item id this entry is for — stable, never shown as-is. */
  id: string;
  /** What the panel calls it: `name`/`heldName` off the world data, or the id verbatim. */
  name: string;
  /** One line under the name, when the world pack wrote one. */
  blurb?: string;
}

/**
 * The `give` fixture that named the token currently held, if it's still on
 * this map to ask — overlays included, since an overlay can bring one
 * (DESIGN.md §3). A missing fixture just means the panel falls back to the
 * token's own id, with no blurb.
 */
function heldFixture(state: Session): Fixture | undefined {
  const base = state.maps[state.place.map];
  if (!base) return undefined;
  const overlays = activeOverlays(state.episode.overlays, state.place.map, state.flags);
  const fixtures = withOverlays(base, overlays).fixtures ?? [];
  return fixtures.find((fixture) => fixture.give === state.held);
}

export function withYou(state: Session): Entry[] {
  const entries: Entry[] = [];

  if (state.held) {
    const fixture = heldFixture(state);
    entries.push({ id: state.held, name: fixture?.heldName ?? state.held, blurb: fixture?.heldBlurb });
  }

  for (const item of state.episode.items ?? []) {
    // `withYou` only ever reads `taken` — never `item.effects`, the way
    // `itemTaken` (engine/session.ts) does for "is it still on the ground" —
    // because a flag an item happens to set can go true from something else
    // entirely, and this list is about what's in hand, not what's known.
    if (!state.taken.has(item.id)) continue;
    // `until` is the item's own way off this list: a declared flag, usually
    // the same one that closes out the episode, set the moment it's handed
    // back or used up. No `until` and a picked-up item simply stays.
    if (item.until && state.flags.get(item.until)) continue;
    entries.push({ id: item.id, name: item.name ?? item.id, blurb: item.blurb });
  }

  return entries;
}
