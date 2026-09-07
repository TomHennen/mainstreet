/**
 * Where a suggestion box sends a player who has something to say.
 *
 * Address, subject and the note it starts them off with are all world data
 * (`world.json` `feedback` and `copy.json` `ui.suggest.body`, DESIGN.md §2) —
 * the engine only stitches them into a URL, so no address, subject or wording
 * ever appears in engine code (CLAUDE.md hard rule 1). A world with no
 * `feedback` gets no link at all and the box still reads fine (hard rule 3).
 *
 * There is no backend anywhere in this: a mailto opens the player's own mail
 * app, and nothing is sent, stored or counted by the game (hard rule 7).
 */
import type { Feedback } from './schema';

export function feedbackUrl(feedback: Feedback | undefined, body?: string[]): string | undefined {
  if (!feedback) return undefined;
  if (feedback.url) return feedback.url;
  if (!feedback.email) return undefined;

  const query: string[] = [];
  if (feedback.subject) query.push(`subject=${encodeURIComponent(feedback.subject)}`);
  const note = (body ?? []).join('\n');
  if (note) query.push(`body=${encodeURIComponent(note)}`);

  return `mailto:${feedback.email}${query.length ? `?${query.join('&')}` : ''}`;
}
