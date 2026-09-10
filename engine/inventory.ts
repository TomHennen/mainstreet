/**
 * What the player has with them right now (DESIGN.md §2, "With you") — the
 * small glance-at-it list Tom asked for, not an inventory: no counts, no
 * slots, nothing to manage. Two things ever end up on it, and only two:
 *
 * - The carry-verb token this map handed over (`session().held`), if any —
 *   the log, on its way from the woodpile to the fire.
 * - Every episode item picked up and not yet handed back (`itemTaken`,
 *   `engine/session.ts`) — the pen, Scout.
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
import { itemTaken } from './session';
import type { Session } from './session';
import type { Fixture } from './schema';

export interface Entry {
  /** The token or item id this entry is for — stable, never shown as-is. */
  id: string;
  /** What the panel calls it: the id, title-cased ("log" → "Log"). */
  name: string;
  /** One line under the name, when the world pack wrote one. */
  blurb?: string;
}

/** "mill-pond-log" → "Mill Pond Log". Ids are plain words today; this reads fine either way. */
function humanize(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The `give` fixture that named the token currently held, if it's still on
 * this map to ask — overlays included, since an overlay can bring one
 * (DESIGN.md §3). Only its `heldBlurb` is wanted; a missing fixture (or one
 * with no blurb written) just means the panel shows the name alone.
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
    entries.push({ id: state.held, name: humanize(state.held), blurb: heldFixture(state)?.heldBlurb });
  }

  for (const item of state.episode.items ?? []) {
    if (!itemTaken(item, state)) continue;
    entries.push({ id: item.id, name: humanize(item.id), blurb: item.blurb });
  }

  return entries;
}
