/**
 * Integration tests for runBattle.
 *
 * These are the only tests in the suite that touch a real @pkmn/sim
 * BattleStream: DoublesPlayerAI is driven by actual protocol messages from
 * the engine rather than synthetic request objects. The assertions are
 * intentionally coarse - we are not testing the AI's move choices here, only
 * that the orchestration layer (runBattle) produces a well-formed
 * RunBattleResult regardless of which side wins.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TeamConfig } from '../config/teams/types.js';
import { runBattle } from './runBattle.js';

// ---------------------------------------------------------------------------
// Minimal teams
//
// Two-Pokémon rosters because runBattle uses gen9doublescustomgame and the
// engine expects (at minimum) enough Pokémon to fill both active slots.
// Short move lists so battles stay to a few turns.
// ---------------------------------------------------------------------------

/** Pikachu + Butterfree - fast Electric/Normal and Psychic/Flying coverage. */
const teamA: TeamConfig = {
  label: 'TeamA',
  exportText: `
Pikachu (M)
Ability: Static
Level: 50
- Thunder Shock
- Quick Attack
- Growl
- Tail Whip

Butterfree (M)
Ability: Compound Eyes
Level: 50
- Air Slash
- Confusion
- Sleep Powder
- Tackle
`,
};

/** Geodude + Onix - heavy Rock/Ground wall typical of Brock's gym. */
const teamB: TeamConfig = {
  label: 'TeamB',
  exportText: `
Geodude (M)
Ability: Rock Head
Level: 50
- Tackle
- Defense Curl
- Rock Blast
- Magnitude

Onix (M)
Ability: Rock Head
Level: 50
- Tackle
- Rock Tomb
- Bind
- Harden
`,
};

/**
 * A highly asymmetric matchup that resolves quickly: a Water-type sweeper
 * with a super-effective STAB move versus the pure Rock/Ground team.
 * Used to get a battle that almost certainly has a clear winner.
 */
const strongTeam: TeamConfig = {
  label: 'StrongTeam',
  exportText: `
Blastoise (M)
Ability: Torrent
Level: 100
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
EVs: 252 SpA / 4 SpD / 252 Spe
- Surf
- Ice Beam
- Hydro Pump
- Flash Cannon

Gyarados (M)
Ability: Intimidate
Level: 100
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
EVs: 252 Atk / 4 Def / 252 Spe
- Waterfall
- Earthquake
- Ice Fang
- Dragon Dance
`,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('runBattle returns a RunBattleResult with the correct top-level shape', async () => {
  const result = await runBattle(teamA, teamB);

  // --- turns ----------------------------------------------------------------
  // Turn 0 (pre-battle preamble) is always present; at least one actual combat
  // turn must have been played.
  assert.ok(Array.isArray(result.turns), 'turns should be an array');
  assert.ok(result.turns.length >= 2, `expected at least 2 turn buckets (got ${result.turns.length})`);

  // Every bucket has the expected shape.
  for (const bucket of result.turns) {
    assert.equal(typeof bucket.turn, 'number');
    assert.ok(Array.isArray(bucket.lines), 'each turn bucket should have a lines array');
  }

  // --- winner / tie ---------------------------------------------------------
  const hasOutcome = result.winner !== undefined || result.tie === true;
  assert.ok(hasOutcome, 'battle must end with either a winner or a tie');

  // winner and tie are mutually exclusive.
  if (result.winner !== undefined) {
    assert.equal(result.tie, false, 'tie must be false when there is a winner');
  }
  if (result.tie) {
    assert.equal(result.winner, undefined, 'winner must be absent when the battle is a tie');
  }

  // --- decisions ------------------------------------------------------------
  assert.ok(Array.isArray(result.decisions), 'decisions should be an array');
  assert.ok(result.decisions.length > 0, 'at least one move decision should have been recorded');

  for (const d of result.decisions) {
    assert.ok(['p1', 'p2'].includes(d.side), `unexpected side: ${d.side}`);
    assert.ok(['a', 'b'].includes(d.slot), `unexpected slot: ${d.slot}`);
    assert.equal(typeof d.turn, 'number');
    assert.ok(Array.isArray(d.legalMoves));
    assert.equal(typeof d.chosenChoice, 'string');
  }
});

test('runBattle winner label matches one of the two team labels', async () => {
  // Use the asymmetric matchup so the battle ends quickly and reliably.
  const result = await runBattle(strongTeam, teamB);

  if (result.tie) {
    // A tie is a valid (if unlikely) outcome - nothing more to assert.
    return;
  }

  assert.ok(
    result.winner === strongTeam.label || result.winner === teamB.label,
    `winner "${result.winner}" should be one of "${strongTeam.label}" or "${teamB.label}"`
  );
});

test('runBattle turn buckets are numbered in ascending order starting at 0', async () => {
  const result = await runBattle(teamA, teamB);

  assert.equal(result.turns[0]!.turn, 0, 'first bucket is always the pre-battle preamble (turn 0)');

  for (let i = 1; i < result.turns.length; i++) {
    assert.equal(
      result.turns[i]!.turn,
      i,
      `turn bucket at index ${i} should have turn number ${i}, got ${result.turns[i]!.turn}`
    );
  }
});

test('runBattle decision snapshots reference only p1 or p2 as their side', async () => {
  const result = await runBattle(teamA, teamB);

  // Every snapshot must be for p1 (teamA) or p2 (teamB) - no stray sides.
  const sides = new Set(result.decisions.map((d) => d.side));
  assert.ok([...sides].every((s) => s === 'p1' || s === 'p2'));
});

test('runBattle records at least one decision for each side', async () => {
  const result = await runBattle(teamA, teamB);

  const p1Decisions = result.decisions.filter((d) => d.side === 'p1');
  const p2Decisions = result.decisions.filter((d) => d.side === 'p2');

  assert.ok(p1Decisions.length > 0, 'p1 (teamA) should have made at least one decision');
  assert.ok(p2Decisions.length > 0, 'p2 (teamB) should have made at least one decision');
});

test('runBattle throws when given an unparseable team export', async () => {
  const badTeam: TeamConfig = { label: 'Broken', exportText: 'this is not valid showdown export text' };

  await assert.rejects(
    () => runBattle(badTeam, teamB),
    (err: Error) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Failed to parse team/);
      return true;
    }
  );
});

test('runBattle can be called concurrently without cross-contaminating results', async () => {
  // Each call creates its own BattleStream, so results should be independent.
  const [r1, r2] = await Promise.all([runBattle(teamA, teamB), runBattle(strongTeam, teamB)]);

  // Both must have reached an outcome.
  assert.ok(r1.winner !== undefined || r1.tie);
  assert.ok(r2.winner !== undefined || r2.tie);

  // Each result must have its own non-empty decisions list.
  assert.ok(r1.decisions.length > 0);
  assert.ok(r2.decisions.length > 0);
});
