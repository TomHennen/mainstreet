/**
 * Picks the world intro's first line by the real calendar (DESIGN.md §2/§3,
 * `WorldCopy.intro.byDate` in schema.ts). Pure and Node-clean — no Phaser, no
 * DOM beyond `Date` — so it runs the same in the browser
 * (`engine/scenes/map.ts`, at boot) and under plain Node
 * (`scripts/playtest.mjs`, `engine/validate.ts`/`scripts/validate-episodes.ts`).
 */
import type { WorldCopy } from './schema';

type Intro = NonNullable<WorldCopy['intro']>;
type DateRange = NonNullable<Intro['byDate']>[number];

const MMDD = /^(\d{2})-(\d{2})$/;
// Generous per-month bound (Feb allows 29) — the ranges only ever need to
// name real days, never to reject a leap-year edge, so this stays simple.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidMonthDay(value: string): boolean {
  const match = MMDD.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/** "MM-DD" for a date's local month and day — zero-padded so it sorts lexically like a calendar. */
function monthDay(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Inclusive "MM-DD" range containment, allowing a range to wrap the year end (e.g. "12-01" to "02-28"). */
function inRange(key: string, from: string, to: string): boolean {
  return from <= to ? key >= from && key <= to : key >= from || key <= to;
}

/**
 * The intro's first line for a given date: the first `byDate` range
 * containing it wins, else `intro.lines[0]`. The caller supplies the device's
 * local date at boot (`engine/scenes/map.ts`) — the choice is never saved.
 */
export function introLineFor(intro: Intro, date: Date): string {
  const key = monthDay(date);
  const match = intro.byDate?.find((range) => inRange(key, range.from, range.to));
  return match?.line ?? intro.lines[0];
}

/**
 * Load-time validation of `intro.byDate` (DESIGN.md §3): every range needs a
 * real "MM-DD" `from` and `to`, and a non-empty `line`. Called from
 * `engine/scenes/boot.ts` and mirrored by `scripts/validate-episodes.ts`.
 */
export function validateIntroByDate(intro: WorldCopy['intro'] | undefined): string[] {
  const problems: string[] = [];
  const ranges: DateRange[] = intro?.byDate ?? [];
  ranges.forEach((range, index) => {
    if (!isValidMonthDay(range.from)) {
      problems.push(`intro.byDate[${index}].from "${range.from}" isn't a valid "MM-DD" date`);
    }
    if (!isValidMonthDay(range.to)) {
      problems.push(`intro.byDate[${index}].to "${range.to}" isn't a valid "MM-DD" date`);
    }
    if (typeof range.line !== 'string' || range.line.trim() === '') {
      problems.push(`intro.byDate[${index}].line is empty`);
    }
  });
  return problems;
}
