import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BattleTurnLog } from '../../shared/apiTypes.js';
import { collectMoveTargets } from './moveTargets.js';

test('collectMoveTargets maps each distinct move used to its dex target category', () => {
  const turns: BattleTurnLog[] = [
    { turn: 0, lines: [] },
    {
      turn: 1,
      lines: [
        'move|p1a: Mankey|Low Kick|p2a: Charmander', // normal: single foe
        'move|p2b: Squirtle|Withdraw|p2b: Squirtle', // self
        'move|p1b: Pikachu|Earthquake|p2a: Charmander', // allAdjacent
      ],
    },
  ];

  const result = collectMoveTargets(turns);

  assert.equal(result['lowkick'], 'normal');
  assert.equal(result['withdraw'], 'self');
  assert.equal(result['earthquake'], 'allAdjacent');
});

test('collectMoveTargets ignores non-move lines and unknown move names', () => {
  const turns: BattleTurnLog[] = [
    {
      turn: 1,
      lines: ['switch|p1a: Bulbasaur|Bulbasaur, L5|20/20', 'move|p1a: Bulbasaur|Not A Real Move|p2a: Charmander'],
    },
  ];

  assert.deepEqual(collectMoveTargets(turns), {});
});
