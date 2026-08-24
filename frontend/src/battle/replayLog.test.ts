import { describe, test, expect } from 'vitest';
import { buildRawLog, buildReplaySrcdoc, STAGE_WIDTH } from './replayLog';
import type { BattleTurnLog } from '../api/types';

describe('buildRawLog', () => {
  test('restores the leading | stripped by collectOmniscientLog', () => {
    const turns: BattleTurnLog[] = [{ turn: 0, lines: ['player|p1|Red', 'gametype|doubles'] }];
    expect(buildRawLog(turns)).toBe('|player|p1|Red\n|gametype|doubles');
  });

  test('re-synthesizes a |turn|N marker before each non-zero turn bucket', () => {
    const turns: BattleTurnLog[] = [
      { turn: 0, lines: ['gametype|doubles'] },
      { turn: 1, lines: ['move|p1a: Bulbasaur|Tackle|p2a: Onix'] },
      { turn: 2, lines: ['move|p2a: Onix|Rock Throw|p1a: Bulbasaur'] },
    ];
    const raw = buildRawLog(turns);
    expect(raw.split('\n')).toEqual([
      '|gametype|doubles',
      '|turn|1',
      '|move|p1a: Bulbasaur|Tackle|p2a: Onix',
      '|turn|2',
      '|move|p2a: Onix|Rock Throw|p1a: Bulbasaur',
    ]);
  });

  test('does not emit a |turn|0 marker for the pre-battle preamble bucket', () => {
    const turns: BattleTurnLog[] = [{ turn: 0, lines: ['gen|9'] }];
    expect(buildRawLog(turns)).not.toContain('|turn|0');
  });

  test('handles empty turn buckets without emitting stray blank lines from them', () => {
    const turns: BattleTurnLog[] = [
      { turn: 0, lines: [] },
      { turn: 1, lines: ['upkeep'] },
    ];
    expect(buildRawLog(turns)).toBe('|turn|1\n|upkeep');
  });
});

describe('buildReplaySrcdoc', () => {
  test('embeds the raw log as script-safe JSON inside the battle-log-data assignment', () => {
    const html = buildReplaySrcdoc('|gametype|doubles\n|turn|1');
    expect(html).toContain(JSON.stringify('|gametype|doubles\n|turn|1'));
  });

  test('escapes a literal </script sequence so it cannot close the tag early', () => {
    const html = buildReplaySrcdoc('|chat|p1|</script><script>alert(1)</script>');
    expect(html).not.toMatch(/<\/script><script>alert/);
    expect(html).toContain('<\\/script');
  });

  test('constrains the frame to the fixed stage width and hides the widget\'s own UI', () => {
    const html = buildReplaySrcdoc('');
    expect(html).toContain(`max-width: ${STAGE_WIDTH}px`);
    expect(html).toContain('.replay-controls');
    expect(html).toContain('display: none !important');
  });

  test('loads replay-embed.js from the Showdown CDN and nothing from code.jquery.com', () => {
    const html = buildReplaySrcdoc('');
    expect(html).toContain('play.pokemonshowdown.com/js/replay-embed.js');
    expect(html).not.toContain('code.jquery.com');
  });
});
