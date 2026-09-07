import { describe, expect, it } from 'vitest';
import { introLineFor, validateIntroByDate } from './season';
import type { WorldCopy } from './schema';

const intro: NonNullable<WorldCopy['intro']> = {
  speaker: 'Route 10',
  lines: ['fallback line'],
  byDate: [
    { from: '03-15', to: '04-30', line: 'first green' },
    { from: '08-21', to: '09-20', line: 'the last of it' },
    { from: '12-11', to: '02-28', line: 'deep winter' }
  ]
};

describe('introLineFor', () => {
  it('picks the range containing the date', () => {
    expect(introLineFor(intro, new Date(2026, 2, 20))).toBe('first green'); // Mar 20
    expect(introLineFor(intro, new Date(2026, 8, 7))).toBe('the last of it'); // Sep 7, Labor Day
  });

  it('matches a range that wraps the year end', () => {
    expect(introLineFor(intro, new Date(2026, 11, 25))).toBe('deep winter'); // Dec 25
    expect(introLineFor(intro, new Date(2026, 0, 15))).toBe('deep winter'); // Jan 15
  });

  it('is inclusive of both boundary dates', () => {
    expect(introLineFor(intro, new Date(2026, 2, 15))).toBe('first green'); // Mar 15 (from)
    expect(introLineFor(intro, new Date(2026, 3, 30))).toBe('first green'); // Apr 30 (to)
    expect(introLineFor(intro, new Date(2026, 11, 11))).toBe('deep winter'); // Dec 11 (from)
    expect(introLineFor(intro, new Date(2026, 1, 28))).toBe('deep winter'); // Feb 28 (to)
  });

  it('falls back to lines[0] when no range contains the date', () => {
    expect(introLineFor(intro, new Date(2026, 4, 15))).toBe('fallback line'); // May 15, in the gap
  });

  it('falls back to lines[0] when the world declares no byDate at all', () => {
    const noRanges: NonNullable<WorldCopy['intro']> = { speaker: 'Route 10', lines: ['only line'] };
    expect(introLineFor(noRanges, new Date(2026, 5, 1))).toBe('only line');
  });

  it('takes the first matching range when ranges are given in order', () => {
    const overlapping: NonNullable<WorldCopy['intro']> = {
      speaker: 'Route 10',
      lines: ['fallback'],
      byDate: [
        { from: '01-01', to: '12-31', line: 'first' },
        { from: '06-01', to: '06-30', line: 'second' }
      ]
    };
    expect(introLineFor(overlapping, new Date(2026, 5, 15))).toBe('first');
  });
});

describe('validateIntroByDate', () => {
  it('accepts well-formed ranges, and an intro with none at all', () => {
    expect(validateIntroByDate(intro)).toEqual([]);
    expect(validateIntroByDate({ speaker: 'Route 10', lines: ['hi'] })).toEqual([]);
    expect(validateIntroByDate(undefined)).toEqual([]);
  });

  it('rejects a from/to that is not a valid MM-DD date', () => {
    const bad: NonNullable<WorldCopy['intro']> = {
      speaker: 'Route 10',
      lines: ['hi'],
      byDate: [{ from: '2026-03-15', to: '04-31', line: 'ok' }]
    };
    const problems = validateIntroByDate(bad);
    expect(problems).toContain('intro.byDate[0].from "2026-03-15" isn\'t a valid "MM-DD" date');
    expect(problems).toContain('intro.byDate[0].to "04-31" isn\'t a valid "MM-DD" date');
  });

  it('rejects an empty line', () => {
    const bad: NonNullable<WorldCopy['intro']> = {
      speaker: 'Route 10',
      lines: ['hi'],
      byDate: [{ from: '03-01', to: '03-14', line: '   ' }]
    };
    expect(validateIntroByDate(bad)).toEqual(['intro.byDate[0].line is empty']);
  });
});
