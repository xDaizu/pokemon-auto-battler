import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dex } from '@pkmn/sim';
import { bestHit, estimateDamageScore, jointValue, STATUS_SCORE, type FoeLike } from './damageHeuristic.js';
import type { MoveCandidate } from './moveCandidates.js';

const dex = Dex.forFormat('gen9doublescustomgame');

function candidate(move: string, target: string, slot = 1): MoveCandidate {
  return { choice: `move ${slot}`, move: { slot, move, target, zMove: false } };
}

function foe(types: string[], hp = 100, maxhp = 100, fainted = false): FoeLike {
  return { types, hp, maxhp, fainted };
}

test('estimateDamageScore applies STAB and type effectiveness', () => {
  const withStab = estimateDamageScore(dex, 'quickattack', ['Normal'], ['Rock']);
  const withoutStab = estimateDamageScore(dex, 'quickattack', ['Water'], ['Rock']);
  // quickattack: 40 BP, Normal vs Rock is not-very-effective (0.5x).
  assert.equal(withStab, 40 * 1.5 * 0.5);
  assert.equal(withoutStab, 40 * 1 * 0.5);
});

test('estimateDamageScore returns 0 for moves the defender is immune to', () => {
  assert.equal(estimateDamageScore(dex, 'earthquake', ['Ground'], ['Flying']), 0);
});

test('estimateDamageScore returns 0 for status moves', () => {
  assert.equal(estimateDamageScore(dex, 'helpinghand', ['Normal'], ['Rock']), 0);
});

test('bestHit sums a foe-only spread move (Rock Slide) across live foes with the spread modifier, skipping fainted ones', () => {
  const foes = [foe(['Flying']), foe(['Normal'], 0, 100, true)];
  const result = bestHit(dex, candidate('rockslide', 'allAdjacentFoes'), ['Rock'], foes);
  // Rock vs Flying is super effective (2x); STAB applies; fainted foe contributes nothing.
  const expected = 75 * 1.5 * 2 * 0.75;
  assert.equal(result.value, expected);
  assert.equal(result.choice, 'move 1'); // spread moves keep the bare choice, no target index
});

test('bestHit penalizes an allAdjacent move (Earthquake) for the damage it deals to a live, vulnerable ally', () => {
  const foes = [foe(['Fire']), foe(['Fire'])];
  const vulnerableAlly = foe(['Rock', 'Ground']); // Ground move hits this ally for 2x
  const withAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), ['Ground'], foes, vulnerableAlly);
  const withoutAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), ['Ground'], foes);

  const perFoe = 100 * 1.5 * 2; // basePower * STAB * effectiveness (Ground vs Fire)
  const foeTotal = 0.75 * perFoe * 2;
  const allyPenalty = 0.75 * (100 * 1.5 * 2); // Ground vs Rock/Ground defender is also 2x

  assert.equal(withoutAlly.value, foeTotal);
  assert.equal(withAlly.value, foeTotal - allyPenalty);
  assert.ok(withAlly.value < withoutAlly.value);
});

test('bestHit does not penalize an allAdjacent move when the ally is immune to it', () => {
  const foes = [foe(['Fire']), foe(['Fire'])];
  const immuneAlly = foe(['Flying']); // Ground moves never hit Flying-types
  const withAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), ['Ground'], foes, immuneAlly);
  const withoutAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), ['Ground'], foes);
  assert.equal(withAlly.value, withoutAlly.value);
});

test('bestHit treats a support move (Helping Hand) as unranked/deprioritized, never as a damage source', () => {
  const foes = [foe(['Rock']), foe(['Steel'])];
  const result = bestHit(dex, candidate('helpinghand', 'adjacentAlly'), ['Normal'], foes);
  assert.equal(result.value, STATUS_SCORE);
  assert.equal(result.choice, 'move 1'); // no target index for a non-single-target move
});

test('jointValue gives each slot its own allAdjacent ally exposure via alliesBySlot', () => {
  const foes = [foe(['Fire']), foe(['Fire'])];
  const eqUser = candidate('earthquake', 'allAdjacent', 1);
  const support = candidate('helpinghand', 'adjacentAlly', 1);
  const vulnerableAlly = foe(['Rock', 'Ground']);

  const total = jointValue(dex, [eqUser, support], [['Ground'], ['Normal']], foes, [vulnerableAlly, undefined]);
  const expectedEq = bestHit(dex, eqUser, ['Ground'], foes, vulnerableAlly).value;
  const expectedSupport = bestHit(dex, support, ['Normal'], foes).value;
  assert.equal(total, expectedEq + expectedSupport);
});
