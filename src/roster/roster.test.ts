import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRoster } from './roster.js';

function pikachuMoves() {
  const line = getRoster().find((l) => l.groupId === 'pikachu')!;
  return line.stages[0]!.moves;
}

test('roster only includes gen 7 level-up moves, not TM/HM/tutor/egg moves', () => {
  const moves = pikachuMoves();
  const ids = moves.map((m) => m.id);

  // Thunder Shock/Growl/Tail Whip/Quick Attack are gen 7 level-up moves for Pikachu.
  assert.ok(ids.includes('thundershock'));
  assert.ok(ids.includes('growl'));

  // Thunder Punch is gen 7 tutor-only ('7T') for Pikachu — never level-up — so
  // it must not appear regardless of how low its level requirement is in other gens.
  assert.ok(!ids.includes('thunderpunch'));
  // Substitute is TM-only ('9M'/'8M'/'7M') for Pikachu, not level-up.
  assert.ok(!ids.includes('substitute'));
});

test('roster move levels never exceed the level cap', () => {
  const moves = pikachuMoves();
  for (const move of moves) {
    assert.ok(move.learnedAt <= 13, `${move.name} learned at ${move.learnedAt}, above the level 13 cap`);
  }
});
