import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRoster } from './roster.js';

function movesFor(groupId: string) {
  const line = getRoster().find((l) => l.groupId === groupId)!;
  return line.stages[0]!.moves;
}

test('roster prefers gen 9 level-up moves for species in Scarlet/Violet\'s dex', () => {
  const ids = movesFor('pikachu').map((m) => m.id);

  // Thunder Shock/Growl/Quick Attack are gen 9 level-up moves for Pikachu.
  assert.ok(ids.includes('thundershock'));
  assert.ok(ids.includes('growl'));
  assert.ok(ids.includes('quickattack'));

  // Thunder Punch and Substitute have no level-up entry in any generation for
  // Pikachu (TM/tutor-only) — must never appear regardless of reference gen.
  assert.ok(!ids.includes('thunderpunch'));
  assert.ok(!ids.includes('substitute'));
});

test('roster falls back to gen 8 for species Scarlet/Violet never assigned a learnset (e.g. Caterpie)', () => {
  const ids = movesFor('caterpie').map((m) => m.id);

  // Tackle/String Shot/Bug Bite are Caterpie's gen 8 level-up moves — its
  // newest generation with any level-up data, verified against PokeAPI.
  assert.ok(ids.includes('tackle'));
  assert.ok(ids.includes('stringshot'));
  assert.ok(ids.includes('bugbite'));
});

test('roster move levels never exceed the level cap', () => {
  for (const groupId of ['pikachu', 'caterpie']) {
    for (const move of movesFor(groupId)) {
      assert.ok(move.learnedAt <= 13, `${move.name} learned at ${move.learnedAt}, above the level 13 cap`);
    }
  }
});
