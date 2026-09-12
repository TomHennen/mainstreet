/**
 * `scripts/episode-script.ts` against route10's own episodes: every line the
 * schema counts as dialogue (`allLines`) has to show up in the rendered
 * Markdown exactly as many times as the doc says it should, and the JSON form
 * (what `--json` prints) has to agree with the Markdown's own doc — the two
 * are never allowed to drift apart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allLines, buildScript, renderMarkdown } from './episode-script.ts';
import type { Episode, World } from '../engine/schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..', 'worlds', 'route10');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

const world = readJson<World>(join(PACK, 'world.json'));

/** How many times `needle` occurs in `haystack`, non-overlapping. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) !== -1) {
    count++;
    at += needle.length;
  }
  return count;
}

describe.each(['ep001', 'ep002'])('episode-script: %s', (episodeId) => {
  const episode = readJson<Episode>(join(PACK, 'episodes', `${episodeId}.json`));
  const doc = buildScript('route10', world, episode);
  const markdown = renderMarkdown(doc);

  it('mentions every dialogue line exactly as many times as the doc has it', () => {
    const expected = new Map<string, number>();
    for (const line of allLines(doc)) expected.set(line, (expected.get(line) ?? 0) + 1);
    for (const [line, count] of expected) {
      expect(occurrences(markdown, line), `"${line}"`).toBe(count);
    }
  });

  it('round-trips through JSON with the same lines', () => {
    const fromJson = JSON.parse(JSON.stringify(doc));
    expect(allLines(fromJson)).toEqual(allLines(doc));
  });

  it('carries the episode id and title in its header', () => {
    expect(markdown.startsWith(`# ${episodeId} — ${episode.title}`)).toBe(true);
  });
});

describe('episode-script: ep002 specifics', () => {
  const episode = readJson<Episode>(join(PACK, 'episodes', 'ep002.json'));
  const doc = buildScript('route10', world, episode);

  it('tags dialogue entries with a stable, unambiguous anchor', () => {
    const walt = doc.npcs.find((npc) => npc.id === 'walt');
    expect(walt?.dialogue.map((entry) => entry.tag)).toEqual(['npc-walt-1', 'npc-walt-2', 'npc-walt-3', 'npc-walt-4']);
  });

  it('places an NPC at the building nearest their door, within 2 tiles', () => {
    // Priya's on Stamford Coffee's deck — equidistant (2 tiles) from that door
    // and 80 Main's, so the tie goes to whichever is listed first on the map.
    const priya = doc.npcs.find((npc) => npc.id === 'priya');
    expect(priya?.place).toBe('80 Main');
    // Nobody is standing at a door here, so it falls back to the map's own name.
    const jessK = doc.npcs.find((npc) => npc.id === 'stamford-main-walker');
    expect(jessK?.place).toBe('Stamford');
  });

  it('notes an NPC who leaves once a flag is set', () => {
    const walt = doc.npcs.find((npc) => npc.id === 'walt');
    expect(walt?.until).toBe('done');
  });

  it('reads scene moves as plain English, a vehicle showing where it starts', () => {
    const scene = doc.scenes.find((s) => s.id === 'a-jess-pulls-round');
    const steps = scene?.steps ?? [];
    expect(steps[0]).toEqual({
      kind: 'move',
      label: 'the wagon',
      verb: 'drives',
      via: [
        [47, 12],
        [45, 12]
      ]
    });
    expect(steps[2]).toEqual({ kind: 'move', label: 'Jess L.', verb: 'walks', via: [[43, 11]] });
  });

  it('reads a camera step following an NPC as "follow"', () => {
    const scene = doc.scenes.find((s) => s.id === 'a-jess-pulls-round');
    const steps = scene?.steps ?? [];
    expect(steps[1]).toEqual({ kind: 'camera', to: { follow: 'Jess L.' } });
  });

  it('gives dialogue effects a readable footer', () => {
    const priya = doc.npcs.find((npc) => npc.id === 'priya');
    const asks = priya?.dialogue.find((entry) => entry.requires.length === 0);
    expect(asks?.gives).toBe('costume-bag');
    expect(asks?.sets).toEqual(['heardAsk']);
    expect(asks?.toasts).toEqual(["You've got the costume bag."]);
  });
});
