import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dex } from '@pkmn/sim';
import {
  bestHit,
  estimateDamageScore,
  jointValue,
  variableMovePower,
  STATUS_SCORE,
  STAT_STAGE_VALUE,
  UNKNOWN_LEVEL_FALLBACK,
  VARIABLE_POWER_FALLBACK,
  type FoeLike,
} from './damageHeuristic.js';
import type { MoveCandidate } from './moveCandidates.js';

const dex = Dex.forFormat('gen9doublescustomgame');

function candidate(move: string, target: string, slot = 1): MoveCandidate {
  return { choice: `move ${slot}`, move: { slot, move, target, zMove: false } };
}

function foe(types: string[], hp = 100, maxhp = 100, fainted = false, weightkg?: number, level?: number): FoeLike {
  return { types, hp, maxhp, fainted, weightkg, level };
}

/** A real species as a FoeLike, for the matchup-shaped status-move tests
 * below - typing and weight come from the dex rather than being hand-picked,
 * so they stay honest about the matchup they claim to model. */
function mon(species: string, extra: Partial<FoeLike> = {}): FoeLike {
  const data = dex.species.get(species);
  return { types: data.types, weightkg: data.weightkg, hp: 100, maxhp: 100, fainted: false, ...extra };
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

test('estimateDamageScore gives Seismic Toss/Night Shade flat damage equal to the attacker\'s real level, ignoring STAB and resistances', () => {
  // A leader's team is no longer all at one shared level cap, so this has to
  // be the specific attacker's level, not a format-wide constant.
  const attacker = foe(['Fighting'], 100, 100, false, undefined, 21);
  // Flying resists Fighting (0.5x) and shares no type with the attacker (no
  // STAB) - neither should matter, since the real move ignores both.
  const resisted = estimateDamageScore(dex, 'seismictoss', attacker, foe(['Flying']));
  assert.equal(resisted, 21);
});

test('estimateDamageScore falls back to UNKNOWN_LEVEL_FALLBACK for Seismic Toss/Night Shade when the attacker\'s level is not tracked', () => {
  const attacker = foe(['Fighting']);
  assert.equal(estimateDamageScore(dex, 'seismictoss', attacker, foe(['Flying'])), UNKNOWN_LEVEL_FALLBACK);
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

test('bestHit treats an unmodeled support move (Helping Hand) as unranked/deprioritized, never as a damage source', () => {
  const foes = [foe(['Rock']), foe(['Steel'])];
  const result = bestHit(dex, candidate('helpinghand', 'adjacentAlly'), foe(['Normal']), foes);
  assert.equal(result.value, STATUS_SCORE);
  assert.equal(result.choice, 'move 1'); // no target index for a non-single-target move
});

// --- Status-move valuation -------------------------------------------------
//
// The behaviour these pin down: a Pokemon with nothing but resisted attacks
// should reach for a debuff instead of chipping. Guard it - the previous flat
// "status always ranks last" made this matchup unwinnable-looking, and it is
// an easy thing to regress back into while tuning damage numbers.

test('bestHit values Growl above every attack Spearow has into a Geodude + Onix wall', () => {
  // Spearow is Normal/Flying and its whole level-13 movepool is Normal/Flying
  // attacks; Geodude and Onix are both Rock/Ground, which resists all of it.
  // Growl hits BOTH foes, so it should comfortably outscore even the best
  // (still resisted, still STAB) attack.
  const spearow = mon('Spearow');
  const foes = [mon('Geodude'), mon('Onix')];

  const growl = bestHit(dex, candidate('growl', 'allAdjacentFoes', 1), spearow, foes);
  const peck = bestHit(dex, candidate('peck', 'any', 2), spearow, foes);
  const furyAttack = bestHit(dex, candidate('furyattack', 'normal', 3), spearow, foes);

  assert.equal(peck.value, 35 * 1.5 * 0.5, 'Peck: STAB but resisted');
  assert.equal(growl.value, 2 * STAT_STAGE_VALUE, 'one Atk stage off each of the two live foes');
  assert.ok(growl.value > peck.value, `Growl (${growl.value}) should beat Peck (${peck.value})`);
  assert.ok(growl.value > furyAttack.value);
  assert.equal(growl.choice, 'move 1', 'spread status keeps the bare choice, no target index');
});

test('bestHit goes back to attacking once the matchup is actually favourable', () => {
  // Same Spearow, same Growl - only the foes change. Against targets that do
  // not resist Flying, the attack has to win, or the AI just debuffs forever.
  const spearow = mon('Spearow');
  const foes = [mon('Rattata'), mon('Pidgey')];

  const growl = bestHit(dex, candidate('growl', 'allAdjacentFoes', 1), spearow, foes);
  const peck = bestHit(dex, candidate('peck', 'any', 2), spearow, foes);

  assert.ok(peck.value > growl.value, `Peck (${peck.value}) should beat Growl (${growl.value})`);
});

test('bestHit counts a spread debuff once per live foe, not once per use', () => {
  // The reason Growl in particular is worth reaching for in doubles: it is a
  // two-for-one. With a foe already down, it is worth half as much.
  const spearow = mon('Spearow');
  const bothLive = bestHit(dex, candidate('growl', 'allAdjacentFoes'), spearow, [mon('Geodude'), mon('Onix')]);
  const oneLeft = bestHit(dex, candidate('growl', 'allAdjacentFoes'), spearow, [
    mon('Geodude'),
    mon('Onix', { hp: 0, fainted: true }),
  ]);

  assert.equal(bothLive.value, 2 * oneLeft.value);
});

test('bestHit discounts a debuff the foes are already carrying, so it stops re-Growling', () => {
  const spearow = mon('Spearow');
  const growl = candidate('growl', 'allAdjacentFoes');
  const fresh = bestHit(dex, growl, spearow, [mon('Geodude'), mon('Onix')]);
  const onceDebuffed = bestHit(dex, growl, spearow, [
    mon('Geodude', { boosts: { atk: -1 } }),
    mon('Onix', { boosts: { atk: -1 } }),
  ]);
  const capped = bestHit(dex, growl, spearow, [
    mon('Geodude', { boosts: { atk: -6 } }),
    mon('Onix', { boosts: { atk: -6 } }),
  ]);

  assert.ok(onceDebuffed.value < fresh.value, 'the second Growl is worth less than the first');
  assert.equal(capped.value, STATUS_SCORE, 'at the -6 stage cap it buys literally nothing');
  // ...and by then even a resisted STAB attack is the better play.
  assert.ok(bestHit(dex, candidate('peck', 'any', 2), spearow, [mon('Geodude'), mon('Onix')]).value > capped.value);
});

test('bestHit values stripping a stage off a boosted foe at full price', () => {
  // Diminishing returns are directional: Growl into a Swords-Danced foe is
  // undoing a buff, not stacking a sixth debuff.
  const spearow = mon('Spearow');
  const growl = candidate('growl', 'allAdjacentFoes');
  const boostedFoes = [mon('Geodude', { boosts: { atk: 2 } }), mon('Onix', { boosts: { atk: 2 } })];
  assert.equal(bestHit(dex, growl, spearow, boostedFoes).value, 2 * STAT_STAGE_VALUE);
});

test('bestHit scales a debuff down against a nearly-fainted foe', () => {
  // A -1 Atk on something about to faint buys almost nothing; the attack that
  // finishes it should win instead.
  const spearow = mon('Spearow');
  const dying = [mon('Geodude', { hp: 10 }), mon('Onix', { hp: 10 })];
  const growl = bestHit(dex, candidate('growl', 'allAdjacentFoes', 1), spearow, dying);
  const peck = bestHit(dex, candidate('peck', 'any', 2), spearow, dying);

  assert.ok(growl.value < 2 * STAT_STAGE_VALUE);
  assert.ok(peck.value > growl.value);
});

test('bestHit scores a status ailment and picks a target for it', () => {
  const grass = mon('Bulbasaur');
  const result = bestHit(dex, candidate('sleeppowder', 'normal'), grass, [mon('Geodude'), mon('Onix')]);
  assert.ok(result.value > 0);
  assert.equal(result.choice, 'move 1 1', 'single-target status still resolves a target index');
});

test('bestHit will not spend a turn on a status the foe cannot take or already has', () => {
  const grass = mon('Bulbasaur');
  const sleepPowder = candidate('sleeppowder', 'normal');
  // Both foes already asleep: nothing left to inflict.
  const alreadyAsleep = bestHit(dex, sleepPowder, grass, [
    mon('Geodude', { status: 'slp' }),
    mon('Onix', { status: 'slp' }),
  ]);
  assert.equal(alreadyAsleep.value, STATUS_SCORE);

  // Thunder Wave is one of the few status moves that does respect type
  // immunity (`ignoreImmunity: false`) - Ground-types are simply not valid.
  const electric = mon('Pikachu');
  const groundFoes = [mon('Geodude'), mon('Onix')];
  assert.equal(bestHit(dex, candidate('thunderwave', 'normal'), electric, groundFoes).value, STATUS_SCORE);
});

test('bestHit ranks a self-boost below the same stages taken off both foes', () => {
  // Growth (+1 Atk/+1 SpA on itself) helps one mon for as long as it lives;
  // Growl's -1 Atk lands on two foes. Both are modeled, and the spread debuff
  // should win.
  const bulbasaur = mon('Bulbasaur');
  const foes = [mon('Geodude'), mon('Onix')];
  const growth = bestHit(dex, candidate('growth', 'self', 1), bulbasaur, foes);
  const growl = bestHit(dex, candidate('growl', 'allAdjacentFoes', 2), bulbasaur, foes);

  assert.ok(growth.value > 0, 'a setup move is still worth more than the unmodeled floor');
  assert.ok(growth.value < growl.value);
  assert.equal(growth.choice, 'move 1', 'self-targeting moves take no target index');
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
