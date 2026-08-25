import { describe, test, expect } from 'vitest';
import {
  buildFlatMoveIndex,
  buildRawLog,
  buildReplaySrcdoc,
  classifyLine,
  nextMoveEndBoundary,
  rootLineIndices,
  STAGE_WIDTH,
  turnProgressForFlatIndex,
} from './replayLog';
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

describe('classifyLine', () => {
  test('treats the block-opening commands as roots', () => {
    expect(classifyLine('move|p1a: Bulbasaur|Tackle|p2a: Onix')).toBe('root');
    expect(classifyLine('switch|p1a: Bulbasaur|Bulbasaur, L13|38/38')).toBe('root');
    expect(classifyLine('win|Red')).toBe('root');
    expect(classifyLine('tie')).toBe('root');
  });

  test('treats protocol noise as skippable', () => {
    expect(classifyLine('t:|1700000000')).toBe('skip');
    expect(classifyLine('upkeep')).toBe('skip');
    expect(classifyLine('gen|9')).toBe('skip');
  });

  test('treats everything else as a consequence of the most recent root', () => {
    expect(classifyLine('-damage|p2a: Onix|20/32')).toBe('consequence');
    expect(classifyLine('-supereffective|p2a: Onix')).toBe('consequence');
    expect(classifyLine('faint|p2a: Onix')).toBe('consequence');
  });
});

describe('rootLineIndices', () => {
  test('opens a block on each root command and indents its consequences', () => {
    expect(
      rootLineIndices([
        'move|p1a: Bulbasaur|Vine Whip|p2a: Onix',
        '-supereffective|p2a: Onix',
        '-damage|p2a: Onix|8/32',
        'move|p2a: Onix|Tackle|p1a: Bulbasaur',
      ]),
    ).toEqual([true, false, false, true]);
  });

  test('promotes the first renderable line when a turn opens with a consequence', () => {
    expect(rootLineIndices(['-weather|Sandstorm', '-damage|p1a: Bulbasaur|30/38'])).toEqual([true, false]);
  });

  test('never promotes a skipped line, and never counts one as opening the block', () => {
    expect(rootLineIndices(['upkeep', '-weather|Sandstorm'])).toEqual([false, true]);
  });
});

describe('buildFlatMoveIndex', () => {
  const TURNS: BattleTurnLog[] = [
    { turn: 0, lines: ['gametype|doubles', 'switch|p1a: Bulbasaur|Bulbasaur, L13|38/38'] },
    {
      turn: 1,
      lines: [
        'move|p1a: Bulbasaur|Vine Whip|p2a: Onix',
        '-supereffective|p2a: Onix',
        '-crit|p2a: Onix',
        '-damage|p2a: Onix|0 fnt',
        'faint|p2a: Onix',
        'move|p2a: Geodude|Tackle|p1a: Bulbasaur',
        '-damage|p1a: Bulbasaur|30/38',
      ],
    },
  ];

  // The invariant the whole step-control design rests on: the widget stores
  // what it is handed as `stepQueue = log.split('\n')`, so if these two ever
  // disagree, `battle.currentStep` stops meaning what this app thinks it means
  // and every control lands somewhere the log doesn't.
  test('counts exactly the lines buildRawLog emits', () => {
    expect(buildFlatMoveIndex(TURNS).totalLines).toBe(buildRawLog(TURNS).split('\n').length);
  });

  test('places boundaries on the root lines, offset past the synthesized |turn|N markers', () => {
    const raw = buildRawLog(TURNS).split('\n');
    const { moveBoundaries } = buildFlatMoveIndex(TURNS);
    // turn 0: 'gametype' is skipped, so the switch is the only root; turn 1
    // contributes its two moves, both shifted one slot by the |turn|1 marker.
    expect(moveBoundaries.map((b) => raw[b])).toEqual([
      '|switch|p1a: Bulbasaur|Bulbasaur, L13|38/38',
      '|move|p1a: Bulbasaur|Vine Whip|p2a: Onix',
      '|move|p2a: Geodude|Tackle|p1a: Bulbasaur',
    ]);
  });

  test('marks where each turn bucket own lines start', () => {
    // Bucket 0 has no |turn|0 marker; bucket 1 is preceded by one.
    expect(buildFlatMoveIndex(TURNS).turnLinesStart).toEqual([0, 3]);
  });

  describe('nextMoveEndBoundary', () => {
    const index = buildFlatMoveIndex(TURNS);
    const raw = buildRawLog(TURNS).split('\n');

    test('stops a step at the start of the following move', () => {
      const afterSendOut = nextMoveEndBoundary(index, 0);
      expect(raw[afterSendOut]).toBe('|move|p1a: Bulbasaur|Vine Whip|p2a: Onix');
    });

    // The requirement in one assertion: one step resolves a move *and* every
    // consequence it produced - super effective, crit, damage, faint - and
    // stops dead at the next move rather than part-way through the chain.
    test('sweeps in a move whole consequence chain and nothing of the next move', () => {
      const start = index.moveBoundaries[1]!;
      const stop = nextMoveEndBoundary(index, start + 1);
      expect(raw.slice(start, stop)).toEqual([
        '|move|p1a: Bulbasaur|Vine Whip|p2a: Onix',
        '|-supereffective|p2a: Onix',
        '|-crit|p2a: Onix',
        '|-damage|p2a: Onix|0 fnt',
        '|faint|p2a: Onix',
      ]);
      expect(raw[stop]).toBe('|move|p2a: Geodude|Tackle|p1a: Bulbasaur');
    });

    test('runs out to the end of the battle once no later move remains', () => {
      const lastMove = index.moveBoundaries[index.moveBoundaries.length - 1]!;
      expect(nextMoveEndBoundary(index, lastMove + 1)).toBe(index.totalLines);
      expect(nextMoveEndBoundary(index, index.totalLines)).toBe(index.totalLines);
    });

    // Continuous playback parks the cursor wherever the widget stopped, which
    // is routinely part-way through a move - stepping from there has to finish
    // that move rather than skip the rest of it.
    test('finishes the move in progress when the cursor sits mid-consequence', () => {
      const start = index.moveBoundaries[1]!;
      const stop = nextMoveEndBoundary(index, start + 2);
      expect(stop).toBe(index.moveBoundaries[2]!);
      expect(raw[stop]).toBe('|move|p2a: Geodude|Tackle|p1a: Bulbasaur');
    });
  });

  describe('turnProgressForFlatIndex', () => {
    const index = buildFlatMoveIndex(TURNS);

    test('reports a whole turn revealed when the cursor sits on the next boundary', () => {
      expect(turnProgressForFlatIndex(index, TURNS, index.turnLinesStart[1]!)).toEqual({
        lastVisibleTurnIndex: 0,
        visibleLinesInLastTurn: 2,
      });
    });

    test('reports a partial count when a step lands mid-turn', () => {
      // Three lines into turn 1's own lines.
      expect(turnProgressForFlatIndex(index, TURNS, index.turnLinesStart[1]! + 3)).toEqual({
        lastVisibleTurnIndex: 1,
        visibleLinesInLastTurn: 3,
      });
    });

    test('reports nothing revealed at the very start', () => {
      expect(turnProgressForFlatIndex(index, TURNS, 0)).toEqual({
        lastVisibleTurnIndex: -1,
        visibleLinesInLastTurn: 0,
      });
    });

    test('never reports more lines than a turn actually has', () => {
      const { lastVisibleTurnIndex, visibleLinesInLastTurn } = turnProgressForFlatIndex(
        index,
        TURNS,
        index.totalLines,
      );
      expect(lastVisibleTurnIndex).toBe(1);
      expect(visibleLinesInLastTurn).toBe(TURNS[1]!.lines.length);
    });
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

  test('loads the vendored replay-embed.js and nothing from code.jquery.com', () => {
    const html = buildReplaySrcdoc('');
    expect(html).toContain('src="js/replay-embed.js"');
    expect(html).toContain('<base href="/vendor/showdown/">');
    expect(html).not.toContain('code.jquery.com');
  });

  test('routes sprite/fx/audio requests at Showdown\'s CDN via Config.routes.client', () => {
    const html = buildReplaySrcdoc('');
    expect(html).toContain("client: 'play.pokemonshowdown.com'");
  });
});
