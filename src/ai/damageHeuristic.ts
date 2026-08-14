import type { Dex } from '@pkmn/sim';
import type { MoveCandidate } from './moveCandidates.js';
import { LEVEL_CAP } from '../roster/roster.js';

const FOE_SINGLE = new Set(['normal', 'any', 'adjacentFoe']);
const FOE_SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);
// 'allAdjacent' (Earthquake, Discharge, ...) hits your own adjacent ally
// too, unlike 'allAdjacentFoes' (Rock Slide, Muddy Water, ...) which is
// foe-only - the ally's share counts as a cost, not a benefit.
const HITS_ALLY = new Set(['allAdjacent']);
const SPREAD_MODIFIER = 0.75; // matches the real engine's multi-target damage reduction

export const STATUS_SCORE = -1;

// Moves whose real power isn't a static number - Low Kick/Grass Knot (target
// weight), Seismic Toss/Night Shade (user level), Gyro Ball/Electro Ball
// (speed), Flail/Reversal (user HP), etc. - report basePower 0 in the dex,
// same as an actual status move. Without a full damage calculator we can't
// compute their real power from here, so treat them as a mid-tier attack
// instead of miscategorizing them as non-damaging and letting a weaker fixed-
// power move always outscore them.
export const VARIABLE_POWER_FALLBACK = 60;

// Sub-families of the above whose real formula only depends on information a
// player already has - species weight (public dex data, the same number
// every player can look up before the fight), this format's fixed level cap,
// or currently-visible HP - rather than hidden state we don't track (an
// opponent's ability, e.g. Light Metal/Heavy Metal changing weight, or
// Autotomize's weight reduction earlier in the battle; Speed for Gyro
// Ball/Electro Ball; stat boosts for Punishment/Stored Power; PP for Trump
// Card). Those still fall back to VARIABLE_POWER_FALLBACK below.
const WEIGHT_BASED = new Set(['lowkick', 'grassknot']);
const WEIGHT_RATIO_BASED = new Set(['heavyslam', 'heatcrash']);
const FIXED_LEVEL_DAMAGE = new Set(['seismictoss', 'nightshade']);
const OWN_HP_BASED = new Set(['flail', 'reversal']);
const TARGET_HP_BASED = new Set(['wringout', 'crushgrip']);

export function isFixedLevelDamageMove(moveId: string): boolean {
  return FIXED_LEVEL_DAMAGE.has(moveId);
}

// Low Kick/Grass Knot's official weight breakpoints.
function lowKickPower(defenderWeightKg: number): number {
  if (defenderWeightKg < 10) return 20;
  if (defenderWeightKg < 25) return 40;
  if (defenderWeightKg < 50) return 60;
  if (defenderWeightKg < 100) return 80;
  if (defenderWeightKg < 200) return 100;
  return 120;
}

// Heavy Slam/Heat Crash's official user-to-target weight ratio breakpoints.
function weightRatioPower(attackerWeightKg: number, defenderWeightKg: number): number {
  if (defenderWeightKg <= 0) return 40;
  const ratio = attackerWeightKg / defenderWeightKg;
  if (ratio >= 5) return 120;
  if (ratio >= 4) return 100;
  if (ratio >= 3) return 80;
  if (ratio >= 2) return 60;
  return 40;
}

// Flail/Reversal's official user-HP breakpoints.
function flailPower(ownHpFraction: number): number {
  const ratio = Math.floor(ownHpFraction * 48);
  if (ratio < 2) return 200;
  if (ratio < 6) return 150;
  if (ratio < 13) return 100;
  if (ratio < 22) return 80;
  if (ratio < 43) return 40;
  return 20;
}

// Wring Out/Crush Grip's official target-HP formula.
function wringOutPower(targetHpFraction: number): number {
  return Math.max(1, Math.floor(120 * targetHpFraction));
}

/**
 * Resolves the effective base power for a move whose static dex basePower is
 * 0, using only the public/known-HP data named above. Any field the caller
 * doesn't actually have should be left undefined rather than guessed - that
 * family (or this move outside all of them) then falls back to
 * VARIABLE_POWER_FALLBACK. Seismic Toss/Night Shade aren't handled here since
 * they don't scale off a "power" number at all - see isFixedLevelDamageMove.
 */
export function variableMovePower(
  moveId: string,
  info: {
    attackerWeightKg?: number;
    defenderWeightKg?: number;
    ownHpFraction?: number; // for Flail/Reversal
    targetHpFraction?: number; // for Wring Out/Crush Grip
  }
): number {
  if (WEIGHT_BASED.has(moveId) && info.defenderWeightKg !== undefined) {
    return lowKickPower(info.defenderWeightKg);
  }
  if (WEIGHT_RATIO_BASED.has(moveId) && info.attackerWeightKg !== undefined && info.defenderWeightKg !== undefined) {
    return weightRatioPower(info.attackerWeightKg, info.defenderWeightKg);
  }
  if (OWN_HP_BASED.has(moveId) && info.ownHpFraction !== undefined) {
    return flailPower(info.ownHpFraction);
  }
  if (TARGET_HP_BASED.has(moveId) && info.targetHpFraction !== undefined) {
    return wringOutPower(info.targetHpFraction);
  }
  return VARIABLE_POWER_FALLBACK;
}

export interface FoeLike {
  types: readonly string[];
  hp: number;
  maxhp: number;
  fainted: boolean;
  // Omitted where the caller has no use for weight-based power (e.g. a bare
  // ally reference). See the WEIGHT_BASED comment above for what this is -
  // and isn't - allowed to reflect.
  weightkg?: number;
}

interface TargetedScore {
  foeIdx: number; // -1 for spread hits (all live foes at once)
  score: number;
  spread: boolean;
}

export function estimateDamageScore(
  dex: ReturnType<typeof Dex.forFormat>,
  moveId: string,
  attacker: FoeLike,
  defender: FoeLike
): number {
  const moveData = dex.moves.get(moveId);
  if (moveData.category === 'Status') return 0;
  if (!dex.getImmunity(moveData.type, [...defender.types])) return 0;

  // Seismic Toss/Night Shade deal flat damage equal to the user's level -
  // that's the real move mechanic, not an approximation, so STAB and type
  // effectiveness never apply (only immunity, already checked above, does).
  // Uses moveData.id (the normalized dex id, e.g. "lowkick") rather than the
  // raw moveId argument, which may be a display name like "Low Kick" -
  // WEIGHT_BASED/FIXED_LEVEL_DAMAGE/etc. are keyed by id.
  if (isFixedLevelDamageMove(moveData.id)) return LEVEL_CAP;

  const basePower =
    moveData.basePower ||
    variableMovePower(moveData.id, {
      attackerWeightKg: attacker.weightkg,
      defenderWeightKg: defender.weightkg,
      ownHpFraction: attacker.maxhp > 0 ? attacker.hp / attacker.maxhp : undefined,
      targetHpFraction: defender.maxhp > 0 ? defender.hp / defender.maxhp : undefined,
    });
  const stab = attacker.types.includes(moveData.type) ? 1.5 : 1;
  const effectiveness = 2 ** dex.getEffectiveness(moveData.type, [...defender.types]);
  return basePower * stab * effectiveness;
}

function scoreAgainstFoes(
  dex: ReturnType<typeof Dex.forFormat>,
  candidate: MoveCandidate,
  attacker: FoeLike,
  foes: readonly FoeLike[],
  ally?: FoeLike
): TargetedScore[] {
  const { target } = candidate.move;
  const live = foes.map((f, i) => ({ ...f, i })).filter((f) => !f.fainted);

  if (FOE_SPREAD.has(target)) {
    const hitsAlly = HITS_ALLY.has(target) && !!ally && !ally.fainted;
    if (!live.length && !hitsAlly) return [];
    let total = live.reduce(
      (sum, f) => sum + estimateDamageScore(dex, candidate.move.move, attacker, f) * SPREAD_MODIFIER,
      0
    );
    if (hitsAlly) {
      total -= estimateDamageScore(dex, candidate.move.move, attacker, ally!) * SPREAD_MODIFIER;
    }
    return [{ foeIdx: -1, score: total, spread: true }];
  }

  if (!live.length) return [];

  if (FOE_SINGLE.has(target)) {
    return live.map((f) => ({
      foeIdx: f.i,
      score: estimateDamageScore(dex, candidate.move.move, attacker, f),
      spread: false,
    }));
  }

  return []; // self/ally/status/field moves
}

function averageLiveHpFraction(foes: readonly FoeLike[]): number {
  const live = foes.filter((f) => !f.fainted);
  if (!live.length) return 1;
  return live.reduce((sum, f) => sum + f.hp / f.maxhp, 0) / live.length;
}

// Weights a raw score by how much of the target's remaining HP it
// represents. We don't have a full damage calculator (stats/level/modifiers)
// to know real KO breakpoints, so this is a proxy for "finish off a
// weakened target" rather than a claim about actual damage dealt.
function finishingWeight(score: number, hpFraction: number): number {
  if (score <= 0) return score;
  return score / Math.max(hpFraction, 0.05);
}

export interface HitResult {
  // The actual submittable choice string, target index resolved (e.g.
  // "move 1 2") for single-target moves; unchanged for spread/status/self/
  // ally moves, which don't take a target index in doubles.
  choice: string;
  value: number;
}

// The best a single candidate can do against the given foes: picks its best
// target (or its spread total), weighted to favor finishing off low-HP
// targets, and resolves the target index into the submittable choice
// string. Falls back to STATUS_SCORE for moves that don't damage (status/
// self/ally/field moves), keeping them rankable-but-deprioritized rather
// than excluded.
export function bestHit(
  dex: ReturnType<typeof Dex.forFormat>,
  candidate: MoveCandidate,
  attacker: FoeLike,
  foes: readonly FoeLike[],
  ally?: FoeLike
): HitResult {
  const scored = scoreAgainstFoes(dex, candidate, attacker, foes, ally);
  if (!scored.length) return { choice: candidate.choice, value: STATUS_SCORE };

  let best: { hit: TargetedScore; value: number } | undefined;
  for (const hit of scored) {
    const hpFraction = hit.spread
      ? averageLiveHpFraction(foes)
      : (foes[hit.foeIdx] ? foes[hit.foeIdx]!.hp / foes[hit.foeIdx]!.maxhp : 1);
    const value = finishingWeight(hit.score, hpFraction);
    if (!best || value > best.value) best = { hit, value };
  }
  const { hit, value } = best!;
  const choice = hit.spread ? candidate.choice : `${candidate.choice} ${hit.foeIdx + 1}`;
  return { choice, value };
}

// Sum of each slot's best-hit value against a shared pool of foes - the
// evaluation function for one joint (slot A, slot B) action pair.
// alliesBySlot[i], if given, is who slot i's own 'allAdjacent' moves would
// also hit - i.e. the *other* slot's mon, not itself.
export function jointValue(
  dex: ReturnType<typeof Dex.forFormat>,
  pair: readonly MoveCandidate[],
  attackers: readonly FoeLike[],
  foes: readonly FoeLike[],
  alliesBySlot?: readonly (FoeLike | undefined)[]
): number {
  let total = 0;
  for (let i = 0; i < pair.length; i++) {
    const candidate = pair[i];
    const attacker = attackers[i];
    if (!candidate || !attacker) continue;
    total += bestHit(dex, candidate, attacker, foes, alliesBySlot?.[i]).value;
  }
  return total;
}
