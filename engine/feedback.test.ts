import { describe, expect, it } from 'vitest';
import { feedbackUrl } from './feedback';

describe('feedbackUrl', () => {
  it('builds a mailto with the subject and the note', () => {
    expect(
      feedbackUrl({ email: 'someone@example.test', subject: 'A story idea' }, ['Which village:', 'Who is in it:'])
    ).toBe('mailto:someone@example.test?subject=A%20story%20idea&body=Which%20village%3A%0AWho%20is%20in%20it%3A');
  });

  it('leaves out what the world did not give it', () => {
    expect(feedbackUrl({ email: 'someone@example.test' })).toBe('mailto:someone@example.test');
    expect(feedbackUrl({ email: 'someone@example.test' }, [])).toBe('mailto:someone@example.test');
  });

  it('opens a page instead when the world gives a url', () => {
    expect(feedbackUrl({ url: 'https://example.test/ideas', email: 'x@example.test', subject: 'ignored' }, ['hi'])).toBe(
      'https://example.test/ideas'
    );
  });

  it('offers no link when the world has nowhere to write to (CLAUDE.md #3)', () => {
    expect(feedbackUrl(undefined, ['hi'])).toBeUndefined();
    expect(feedbackUrl({}, ['hi'])).toBeUndefined();
    expect(feedbackUrl({ subject: 'no address' })).toBeUndefined();
  });
});
