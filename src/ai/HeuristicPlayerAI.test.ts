import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PokemonSet, Streams } from '@pkmn/sim';
import { HeuristicPlayerAI } from './HeuristicPlayerAI.js';

// Regression test for a bug where `chooseMove` resolved the attacker as
// `ownTeam[moveCallIndex]` - a counter incremented once per call, assumed to
// start at slot 0. `chooseMove` is only invoked for *live* active slots
// though, so once slot 0 (not slot 1) is the one that faints, the first
// subsequent call is for slot 1's Pokemon but arrives with moveCallIndex
// still 0, silently attributing slot 1's moves to slot 0's species instead.
function makeAI(ownTeam: Array<{ species: string }>) {
  const stream = { write: async () => {} } as unknown as Streams.ObjectReadWriteStream<string>;
  const ai = new HeuristicPlayerAI(stream, ownTeam as unknown as PokemonSet[], 'gen9doublescustomgame');
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
