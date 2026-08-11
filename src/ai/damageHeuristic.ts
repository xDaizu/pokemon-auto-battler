import type { Dex } from '@pkmn/sim';
import type { MoveCandidate } from './moveCandidates.js';

const FOE_SINGLE = new Set(['normal', 'any', 'adjacentFoe']);
const FOE_SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);
// 'allAdjacent' (Earthquake, Discharge, ...) hits your own adjacent ally
// too, unlike 'allAdjacentFoes' (Rock Slide, Muddy Water, ...) which is
// foe-only - the ally's share counts as a cost, not a benefit.
const HITS_ALLY = new Set(['allAdjacent']);
const SPREAD_MODIFIER = 0.75; // matches the real engine's multi-target damage reduction

export const STATUS_SCORE = -1;

export interface FoeLike {
  types: readonly string[];
  hp: number;
  maxhp: number;
  fainted: boolean;
}

interface TargetedScore {
  foeIdx: number; // -1 for spread hits (all live foes at once)
  score: number;
  spread: boolean;
}

export function estimateDamageScore(
  dex: ReturnType<typeof Dex.forFormat>,
  moveId: string,
  attackerTypes: readonly string[],
  defenderTypes: readonly string[]
): number {
  const moveData = dex.moves.get(moveId);
  if (moveData.category === 'Status' || !moveData.basePower) return 0;
  if (!dex.getImmunity(moveData.type, [...defenderTypes])) return 0;
  const stab = attackerTypes.includes(moveData.type) ? 1.5 : 1;
  const effectiveness = 2 ** dex.getEffectiveness(moveData.type, [...defenderTypes]);
  return moveData.basePower * stab * effectiveness;
}

function scoreAgainstFoes(
  dex: ReturnType<typeof Dex.forFormat>,
  candidate: MoveCandidate,
  attackerTypes: readonly string[],
  foes: readonly FoeLike[],
  ally?: FoeLike
): TargetedScore[] {
  const { target } = candidate.move;
  const live = foes.map((f, i) => ({ ...f, i })).filter((f) => !f.fainted);

  if (FOE_SPREAD.has(target)) {
    const hitsAlly = HITS_ALLY.has(target) && !!ally && !ally.fainted;
    if (!live.length && !hitsAlly) return [];
    let total = live.reduce(
      (sum, f) => sum + estimateDamageScore(dex, candidate.move.move, attackerTypes, f.types) * SPREAD_MODIFIER,
      0
    );
    if (hitsAlly) {
      total -= estimateDamageScore(dex, candidate.move.move, attackerTypes, ally!.types) * SPREAD_MODIFIER;
    }
    return [{ foeIdx: -1, score: total, spread: true }];
  }

  if (!live.length) return [];

  if (FOE_SINGLE.has(target)) {
    return live.map((f) => ({
      foeIdx: f.i,
      score: estimateDamageScore(dex, candidate.move.move, attackerTypes, f.types),
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
  attackerTypes: readonly string[],
  foes: readonly FoeLike[],
  ally?: FoeLike
): HitResult {
  const scored = scoreAgainstFoes(dex, candidate, attackerTypes, foes, ally);
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
  attackerTypesBySlot: readonly (readonly string[])[],
  foes: readonly FoeLike[],
  alliesBySlot?: readonly (FoeLike | undefined)[]
): number {
  let total = 0;
  for (let i = 0; i < pair.length; i++) {
    const candidate = pair[i];
    if (!candidate) continue;
    total += bestHit(dex, candidate, attackerTypesBySlot[i] ?? [], foes, alliesBySlot?.[i]).value;
  }
  return total;
}
