import type { Dex } from '@pkmn/sim';
import type { MoveCandidate } from './moveCandidates.js';

const FOE_SINGLE = new Set(['normal', 'any', 'adjacentFoe']);
const FOE_SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);
// 'allAdjacent' (Earthquake, Discharge, ...) hits your own adjacent ally
// too, unlike 'allAdjacentFoes' (Rock Slide, Muddy Water, ...) which is
// foe-only - the ally's share counts as a cost, not a benefit.
const HITS_ALLY = new Set(['allAdjacent']);
const SPREAD_MODIFIER = 0.75; // matches the real engine's multi-target damage reduction

// Floor for status moves we don't model (Protect, Substitute, Helping Hand,
// Leech Seed, confusion, screens, ...): rankable but always last, so they're
// only picked when literally nothing else is legal.
export const STATUS_SCORE = -1;

// --- Status-move valuation -------------------------------------------------
//
// Scoring *every* status move at that floor is wrong for the matchups this
// format keeps producing. A Spearow (Normal/Flying) facing Geodude + Onix
// (both Rock/Ground) has no attack that isn't resisted - chipping for ~26 a
// turn is plainly worse than dropping both foes' Attack with one Growl. So
// the modeled status moves (stat-stage changes and non-volatile status) are
// scored on the *same* basePower x STAB x effectiveness scale as attacks and
// ranked against them directly, rather than being categorically excluded.
//
// STAT_STAGE_VALUE is the anchor: one stage on one full-HP foe sits below a
// neutral 40 BP attack but above a resisted one, so status wins exactly when
// the matchup is bad - and a spread debuff (Growl/Leer, both foes at once)
// wins roughly twice as often as a single-target one.
export const STAT_STAGE_VALUE = 20;

// Non-volatile status, valued by how much of the foe's turn it actually takes
// away. Sleep/freeze stop it acting outright; paralysis and Toxic compound
// over the fight; plain poison is the weakest of the set.
const AILMENT_VALUE: Record<string, number> = {
  slp: 90,
  frz: 90,
  par: 60,
  tox: 60,
  brn: 50,
  psn: 35,
};

// Types that can't take the matching ailment at all - keeps the AI from
// Thunder Waving an Electric-type or Will-O-Wisping a Fire-type.
const AILMENT_IMMUNE_TYPES: Record<string, readonly string[]> = {
  brn: ['Fire'],
  par: ['Electric'],
  frz: ['Ice'],
  psn: ['Poison', 'Steel'],
  tox: ['Poison', 'Steel'],
};

// Each stage already applied in the same direction makes the next one worth
// less - the first -1 Atk is a real dent, the fifth barely moves the needle.
// Without this the AI happily spams Growl forever in a bad matchup instead of
// debuffing a couple of times and then attacking.
const STAGE_DIMINISHING = 0.6;

// A setup move only pays off through the single mon that used it, and only if
// that mon lives to swing again - worth less than the same number of stages
// stripped off a foe.
const SELF_BOOST_FACTOR = 0.6;

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

// Seismic Toss/Night Shade deal damage equal to the *user's* level, which is
// always known for a real attacker - this only fires when a caller builds a
// FoeLike without one (shouldn't happen in practice), so the function stays
// total instead of producing NaN.
export const UNKNOWN_LEVEL_FALLBACK = 100;

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
  // This Pokemon's real battle level - needed only as an *attacker*, for
  // Seismic Toss/Night Shade's flat user-level damage (see
  // isFixedLevelDamageMove). Per-Pokemon since a leader's team is no longer
  // uniformly at one level cap. Omitted by callers that don't track it
  // (falls back to UNKNOWN_LEVEL_FALLBACK).
  level?: number;
  // Publicly-revealed stat stages and non-volatile status, as tracked from
  // protocol lines. Only status-move valuation reads these; damage scoring
  // deliberately ignores them (no real damage calculator here). Omitted by
  // callers that don't track them, which then values every debuff as if it
  // were the first one landed.
  boosts?: Record<string, number>;
  status?: string;
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
  if (isFixedLevelDamageMove(moveData.id)) return attacker.level ?? UNKNOWN_LEVEL_FALLBACK;

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

function accuracyFactor(accuracy: number | true): number {
  return accuracy === true ? 1 : accuracy / 100;
}

// How many stat stages a `delta`-stage change actually buys, given the target
// is already at `current` - clamped at the ±6 cap and discounted for every
// stage already stacked in the same direction. Stripping a stage off a foe
// that's *boosted* the other way is worth full value, hence the directional
// exponent rather than Math.abs(current).
function stagesGained(current: number, delta: number): number {
  const landed = Math.abs(Math.max(-6, Math.min(6, current + delta)) - current);
  const alreadyInDirection = Math.max(0, delta > 0 ? current : -current);
  return landed * STAGE_DIMINISHING ** alreadyInDirection;
}

function ailmentImmune(status: string, types: readonly string[]): boolean {
  return (AILMENT_IMMUNE_TYPES[status] ?? []).some((t) => types.includes(t));
}

// What landing this status move on `defender` is worth, in damage-score
// units. Returns 0 for anything we don't model (or that can't land), letting
// the caller drop back to STATUS_SCORE.
function debuffValue(
  dex: ReturnType<typeof Dex.forFormat>,
  moveData: ReturnType<ReturnType<typeof Dex.forFormat>['moves']['get']>,
  defender: FoeLike
): number {
  if (defender.fainted) return 0;
  // Status moves ignore type immunity by default; `ignoreImmunity: false` is
  // the explicit opt-in (Thunder Wave vs a Ground-type).
  if (moveData.ignoreImmunity === false && !dex.getImmunity(moveData.type, [...defender.types])) return 0;

  let value = 0;
  for (const [stat, delta] of Object.entries(moveData.boosts ?? {})) {
    value += stagesGained(defender.boosts?.[stat] ?? 0, delta ?? 0) * STAT_STAGE_VALUE;
  }
  // A foe can only carry one non-volatile status, so a second one is wasted.
  if (moveData.status && !defender.status && !ailmentImmune(moveData.status, defender.types)) {
    value += AILMENT_VALUE[moveData.status] ?? 0;
  }
  if (value <= 0) return 0;

  // A debuff only pays off over the turns the foe is still around to act, so
  // it's worth less against a nearly-fainted target than a fresh one.
  const hpFraction = defender.maxhp > 0 ? defender.hp / defender.maxhp : 1;
  return value * hpFraction * accuracyFactor(moveData.accuracy);
}

function selfBoostValue(
  moveData: ReturnType<ReturnType<typeof Dex.forFormat>['moves']['get']>,
  attacker: FoeLike
): number {
  let value = 0;
  for (const [stat, delta] of Object.entries(moveData.boosts ?? {})) {
    value += stagesGained(attacker.boosts?.[stat] ?? 0, delta ?? 0) * STAT_STAGE_VALUE;
  }
  if (value <= 0) return 0;
  // Same "only pays off if you're still standing" logic as debuffValue, but
  // measured against the setter-upper's own remaining HP.
  const hpFraction = attacker.maxhp > 0 ? attacker.hp / attacker.maxhp : 1;
  return value * SELF_BOOST_FACTOR * hpFraction * accuracyFactor(moveData.accuracy);
}

/**
 * `bestHit` for a Status-category move - see the STAT_STAGE_VALUE comment for
 * why these get a real score instead of a flat "always last". Spread status
 * (Growl, Leer) applies at full strength to every live foe, with no
 * SPREAD_MODIFIER: unlike spread damage, the engine doesn't weaken it.
 * Anything outside the modeled families falls through to STATUS_SCORE.
 */
export function bestStatusHit(
  dex: ReturnType<typeof Dex.forFormat>,
  candidate: MoveCandidate,
  attacker: FoeLike,
  foes: readonly FoeLike[]
): HitResult {
  const moveData = dex.moves.get(candidate.move.move);
  const { target } = candidate.move;

  if (target === 'self') {
    const value = selfBoostValue(moveData, attacker);
    return { choice: candidate.choice, value: value > 0 ? value : STATUS_SCORE };
  }

  const live = foes.map((f, i) => ({ foe: f, i })).filter((e) => !e.foe.fainted);

  if (FOE_SPREAD.has(target) && live.length) {
    const total = live.reduce((sum, e) => sum + debuffValue(dex, moveData, e.foe), 0);
    return { choice: candidate.choice, value: total > 0 ? total : STATUS_SCORE };
  }

  if (FOE_SINGLE.has(target) && live.length) {
    let best: { value: number; i: number } | undefined;
    for (const e of live) {
      const value = debuffValue(dex, moveData, e.foe);
      if (!best || value > best.value) best = { value, i: e.i };
    }
    // Built from `candidate.move.slot`, not appended onto `candidate.choice`:
    // in a doubles request (always two active slots - invariant 6) the
    // per-slot fallback path's own move list already bakes a random target
    // index into `choice` (see RandomPlayerAI.receiveRequest), so appending
    // a second one here would submit an invalid three-part choice like
    // "move 3 2 2". The joint search's candidates never carry a baked-in
    // target, so this produces the identical string there.
    // Keep the resolved target index even when the move scores nothing - a
    // targetless single-target choice makes the engine roll for a target.
    return {
      choice: `move ${candidate.move.slot} ${best!.i + 1}${candidate.move.zMove ? ' zmove' : ''}`,
      value: best!.value > 0 ? best!.value : STATUS_SCORE,
    };
  }

  return { choice: candidate.choice, value: STATUS_SCORE };
}

// The best a single candidate can do against the given foes: picks its best
// target (or its spread total), weighted to favor finishing off low-HP
// targets, and resolves the target index into the submittable choice
// string. Status moves are routed to `bestStatusHit`, which scores the
// modeled ones on the same scale and floors the rest at STATUS_SCORE.
export function bestHit(
  dex: ReturnType<typeof Dex.forFormat>,
  candidate: MoveCandidate,
  attacker: FoeLike,
  foes: readonly FoeLike[],
  ally?: FoeLike
): HitResult {
  if (dex.moves.get(candidate.move.move).category === 'Status') {
    return bestStatusHit(dex, candidate, attacker, foes);
  }

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
