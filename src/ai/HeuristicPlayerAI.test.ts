import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PokemonSet, Streams } from '@pkmn/sim';
import { HeuristicPlayerAI } from './HeuristicPlayerAI.js';
import type { MoveDecisionSnapshot } from './decisionSnapshot.js';

// Regression test for a bug where `chooseMove` resolved the attacker as
// `ownTeam[moveCallIndex]` - a counter incremented once per call, assumed to
// start at slot 0. `chooseMove` is only invoked for *live* active slots
// though, so once slot 0 (not slot 1) is the one that faints, the first
// subsequent call is for slot 1's Pokemon but arrives with moveCallIndex
// still 0, silently attributing slot 1's moves to slot 0's species instead.
function makeAI(ownTeam: Array<{ species: string }>, onDecision?: (snapshot: MoveDecisionSnapshot) => void) {
  const stream = { write: async () => {} } as unknown as Streams.ObjectReadWriteStream<string>;
  const ai = new HeuristicPlayerAI(stream, ownTeam as unknown as PokemonSet[], 'gen9doublescustomgame', onDecision);
  let captured: string | undefined;
  ai.choose = (choice: string) => {
    captured = choice;
  };
  return { ai, getChoice: () => captured };
}

// Slot 0 (Squirtle) has already fainted; slot 1 (Charmander) is the sole
// survivor and must choose between a same-power Fire move (STAB for
// Charmander) and a same-power Water move (STAB for Squirtle). Correctly
// resolving the attacker as Charmander should prefer the Fire move.
function moveRequestWithSlot0Fainted() {
  return {
    side: {
      id: 'p1',
      pokemon: [{ condition: '0 fnt' }, { condition: '100/100' }],
    },
    active: [
      {},
      {
        moves: [
          { move: 'Ember', target: 'normal', disabled: false },
          { move: 'Water Gun', target: 'normal', disabled: false },
        ],
      },
    ],
  } as never;
}

test('HeuristicPlayerAI attributes a live slot to the right team member after an earlier slot has fainted', () => {
  const { ai, getChoice } = makeAI([{ species: 'Squirtle' }, { species: 'Charmander' }]);

  ai.receiveRequest(moveRequestWithSlot0Fainted());

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  // Squirtle's slot (0) is fainted and passes automatically; Charmander's
  // slot (1) should pick Ember (move 1, Fire STAB) over Water Gun (move 2),
  // which only scores higher if the attacker is wrongly resolved as Squirtle.
  assert.equal(choice, 'pass, move 1 1');
});

// Regression test for a bug where variable-power moves (Low Kick, Seismic
// Toss, ...) report basePower 0 in the dex - same as an actual status move -
// so they always lost to any fixed-power move regardless of type matchup,
// even a not-very-effective one.
test('HeuristicPlayerAI prefers a variable-power STAB move (Low Kick) over a resisted fixed-power move (Scratch)', () => {
  const { ai, getChoice } = makeAI([{ species: 'Mankey' }]);

  // Foe is Geodude (Rock/Ground): Fighting is super effective, Normal is
  // resisted.
  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveRequest({
    side: { id: 'p1', pokemon: [{ condition: '100/100' }] },
    active: [
      {
        moves: [
          { move: 'Scratch', target: 'normal', disabled: false },
          { move: 'Low Kick', target: 'normal', disabled: false },
        ],
      },
    ],
  } as never);

  assert.equal(getChoice(), 'move 2 1');
});

// Same underlying fix, but exercising target *selection* rather than move
// selection: Low Kick's real power depends on the target's weight, so
// against two same-typed foes it should aim at the one it actually hits
// harder rather than scoring both identically.
test('HeuristicPlayerAI aims Low Kick at the heavier of two same-typed foes (Onix over Geodude)', () => {
  const { ai, getChoice } = makeAI([{ species: 'Mankey' }]);

  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveLine('|switch|p2b: Onix|Onix, L13|45/45');
  ai.receiveRequest({
    side: { id: 'p1', pokemon: [{ condition: '100/100' }] },
    active: [{ moves: [{ move: 'Low Kick', target: 'normal', disabled: false }] }],
  } as never);

  assert.equal(getChoice(), 'move 1 2');
});

// Covers the `onDecision` telemetry hook (see decisionSnapshot.ts): every
// field a later re-scoring pass would need should reflect exactly what the
// AI itself saw at decision time - the live slot's own state, the fainted
// slot, and only the foe state actually revealed by protocol lines so far.
test('HeuristicPlayerAI reports a decision snapshot with the state it actually used', () => {
  const decisions: MoveDecisionSnapshot[] = [];
  const { ai, getChoice } = makeAI([{ species: 'Squirtle' }, { species: 'Charmander' }], (d) => decisions.push(d));

  ai.receiveLine('|turn|3');
  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveLine('|-weather|Sandstorm');
  ai.receiveLine('|-boost|p2a: Geodude|def|1');
  ai.receiveRequest(moveRequestWithSlot0Fainted());

  // Water Gun (move 2) now scores higher than Ember (move 1): Water is super
  // effective against Geodude (Rock/Ground) while Fire is resisted, which
  // outweighs Ember's STAB - unlike the plain fainted-slot test above, this
  // one deliberately reveals a foe so the snapshot has something to capture.
  assert.equal(getChoice(), 'pass, move 2 1');
  assert.equal(decisions.length, 1, 'only the live slot (b) should have chosen a move');

  const [decision] = decisions;
  assert.equal(decision!.turn, 3);
  assert.equal(decision!.side, 'p1');
  assert.equal(decision!.slot, 'b', 'slot 0 (Squirtle) is fainted; the decision is for slot 1 (Charmander)');
  assert.equal(decision!.weather, 'Sandstorm');
  assert.equal(decision!.chosenChoice, 'move 2 1');
  assert.deepEqual(
    decision!.legalMoves,
    [
      { move: 'Ember', target: 'normal' },
      { move: 'Water Gun', target: 'normal' },
    ],
    'legalMoves should be exactly what was scored, not just the chosen move'
  );

  assert.equal(decision!.own[0]!.species, 'Squirtle');
  assert.equal(decision!.own[0]!.fainted, true);
  assert.equal(decision!.own[1]!.species, 'Charmander');
  assert.equal(decision!.own[1]!.hp, 100);
  assert.equal(decision!.own[1]!.fainted, false);

  assert.equal(decision!.foe[0]!.species, 'Geodude');
  assert.equal(decision!.foe[0]!.hp, 35);
  assert.equal(decision!.foe[0]!.boosts.def, 1);
  assert.equal(decision!.foe[1]!.species, undefined, 'the second foe slot was never revealed');
});
