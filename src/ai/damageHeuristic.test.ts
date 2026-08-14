import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dex } from '@pkmn/sim';
import {
  bestHit,
  estimateDamageScore,
  jointValue,
  variableMovePower,
  STATUS_SCORE,
  VARIABLE_POWER_FALLBACK,
  type FoeLike,
} from './damageHeuristic.js';
import type { MoveCandidate } from './moveCandidates.js';
import { LEVEL_CAP } from '../roster/roster.js';

const dex = Dex.forFormat('gen9doublescustomgame');

function candidate(move: string, target: string, slot = 1): MoveCandidate {
  return { choice: `move ${slot}`, move: { slot, move, target, zMove: false } };
}

function foe(types: string[], hp = 100, maxhp = 100, fainted = false, weightkg?: number): FoeLike {
  return { types, hp, maxhp, fainted, weightkg };
}

test('estimateDamageScore applies STAB and type effectiveness', () => {
  const withStab = estimateDamageScore(dex, 'quickattack', foe(['Normal']), foe(['Rock']));
  const withoutStab = estimateDamageScore(dex, 'quickattack', foe(['Water']), foe(['Rock']));
  // quickattack: 40 BP, Normal vs Rock is not-very-effective (0.5x).
  assert.equal(withStab, 40 * 1.5 * 0.5);
  assert.equal(withoutStab, 40 * 1 * 0.5);
});

test('estimateDamageScore returns 0 for moves the defender is immune to', () => {
  assert.equal(estimateDamageScore(dex, 'earthquake', foe(['Ground']), foe(['Flying'])), 0);
});

test('estimateDamageScore returns 0 for status moves', () => {
  assert.equal(estimateDamageScore(dex, 'helpinghand', foe(['Normal']), foe(['Rock'])), 0);
});

test('estimateDamageScore treats a variable-power move (Low Kick) as damaging, not as a status move', () => {
  // Low Kick's real power depends on the target's weight and isn't captured
  // by the dex's static basePower field (reported as 0), so it must not be
  // scored the same as an actual status move like Helping Hand.
  const lowKick = estimateDamageScore(dex, 'lowkick', foe(['Fighting']), foe(['Rock', 'Ground'], 100, 100, false, 20));
  const helpingHand = estimateDamageScore(dex, 'helpinghand', foe(['Fighting']), foe(['Rock', 'Ground']));
  assert.ok(lowKick > 0);
  assert.ok(lowKick > helpingHand);
});

test('estimateDamageScore computes Low Kick power from the defender\'s actual weight, not a flat guess', () => {
  const attacker = foe(['Fighting']);
  // Onix (210kg, real BP 120) vs Geodude (20kg, real BP 40) - same Rock/Ground
  // typing, so the only thing that should differ is the weight breakpoint.
  const onix = estimateDamageScore(dex, 'lowkick', attacker, foe(['Rock', 'Ground'], 100, 100, false, 210));
  const geodude = estimateDamageScore(dex, 'lowkick', attacker, foe(['Rock', 'Ground'], 100, 100, false, 20));
  assert.equal(onix, 120 * 1.5 * 2);
  assert.equal(geodude, 40 * 1.5 * 2);
  assert.ok(onix > geodude);
});

test('estimateDamageScore gives Seismic Toss/Night Shade flat level-based damage, ignoring STAB and resistances', () => {
  const attacker = foe(['Fighting']);
  // Flying resists Fighting (0.5x) and shares no type with the attacker (no
  // STAB) - neither should matter, since the real move ignores both.
  const resisted = estimateDamageScore(dex, 'seismictoss', attacker, foe(['Flying']));
  assert.equal(resisted, LEVEL_CAP);
});

test('estimateDamageScore keeps Seismic Toss at 0 against an immune target', () => {
  // Fighting-type moves never hit Ghost-types.
  assert.equal(estimateDamageScore(dex, 'seismictoss', foe(['Fighting']), foe(['Ghost'])), 0);
});

test('estimateDamageScore scales Wring Out/Crush Grip with the target\'s remaining HP', () => {
  const attacker = foe(['Normal']);
  const fullHp = estimateDamageScore(dex, 'wringout', attacker, foe(['Rock'], 100, 100));
  const halfHp = estimateDamageScore(dex, 'wringout', attacker, foe(['Rock'], 50, 100));
  assert.ok(fullHp > halfHp);
  assert.ok(halfHp > 0);
});

test('variableMovePower falls back to the flat estimate when the needed public data is unavailable', () => {
  // e.g. the singles-fallback path, which doesn't track its own current HP.
  assert.equal(variableMovePower('flail', {}), VARIABLE_POWER_FALLBACK);
  assert.equal(variableMovePower('lowkick', {}), VARIABLE_POWER_FALLBACK);
});

test('variableMovePower never guesses at hidden state (abilities, Speed, boosts, PP)', () => {
  // Gyro Ball (Speed-dependent) isn't one of the modeled public-info
  // families, so it always falls back regardless of what's passed in.
  assert.equal(variableMovePower('gyroball', { attackerWeightKg: 1, defenderWeightKg: 1000 }), VARIABLE_POWER_FALLBACK);
});

test('bestHit sums a foe-only spread move (Rock Slide) across live foes with the spread modifier, skipping fainted ones', () => {
  const foes = [foe(['Flying']), foe(['Normal'], 0, 100, true)];
  const result = bestHit(dex, candidate('rockslide', 'allAdjacentFoes'), foe(['Rock']), foes);
  // Rock vs Flying is super effective (2x); STAB applies; fainted foe contributes nothing.
  const expected = 75 * 1.5 * 2 * 0.75;
  assert.equal(result.value, expected);
  assert.equal(result.choice, 'move 1'); // spread moves keep the bare choice, no target index
});

test('bestHit penalizes an allAdjacent move (Earthquake) for the damage it deals to a live, vulnerable ally', () => {
  const foes = [foe(['Fire']), foe(['Fire'])];
  const vulnerableAlly = foe(['Rock', 'Ground']); // Ground move hits this ally for 2x
  const withAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), foe(['Ground']), foes, vulnerableAlly);
  const withoutAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), foe(['Ground']), foes);

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
  const withAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), foe(['Ground']), foes, immuneAlly);
  const withoutAlly = bestHit(dex, candidate('earthquake', 'allAdjacent'), foe(['Ground']), foes);
  assert.equal(withAlly.value, withoutAlly.value);
});

test('bestHit treats a support move (Helping Hand) as unranked/deprioritized, never as a damage source', () => {
  const foes = [foe(['Rock']), foe(['Steel'])];
  const result = bestHit(dex, candidate('helpinghand', 'adjacentAlly'), foe(['Normal']), foes);
  assert.equal(result.value, STATUS_SCORE);
  assert.equal(result.choice, 'move 1'); // no target index for a non-single-target move
});

test('bestHit targets the heavier foe with Low Kick when both share the same type matchup', () => {
  // Same reasoning as the standalone estimateDamageScore test above, but
  // through the target-selection path: given a choice, Low Kick should aim
  // at the foe it actually hits harder.
  const geodude = foe(['Rock', 'Ground'], 35, 35, false, 20);
  const onix = foe(['Rock', 'Ground'], 45, 45, false, 210);
  const result = bestHit(dex, candidate('lowkick', 'normal'), foe(['Fighting']), [geodude, onix]);
  assert.equal(result.choice, 'move 1 2'); // foe index 1 (Onix), 1-based
});

test('jointValue gives each slot its own allAdjacent ally exposure via alliesBySlot', () => {
  const foes = [foe(['Fire']), foe(['Fire'])];
  const eqUser = candidate('earthquake', 'allAdjacent', 1);
  const support = candidate('helpinghand', 'adjacentAlly', 1);
  const vulnerableAlly = foe(['Rock', 'Ground']);

  const attackers = [foe(['Ground']), foe(['Normal'])];
  const total = jointValue(dex, [eqUser, support], attackers, foes, [vulnerableAlly, undefined]);
  const expectedEq = bestHit(dex, eqUser, attackers[0]!, foes, vulnerableAlly).value;
  const expectedSupport = bestHit(dex, support, attackers[1]!, foes).value;
  assert.equal(total, expectedEq + expectedSupport);
});
