import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PokemonSet, Streams } from '@pkmn/sim';
import { DoublesPlayerAI } from './DoublesPlayerAI.js';
import type { MoveDecisionSnapshot } from './decisionSnapshot.js';

// DoublesPlayerAI.tryJointMove never touches the real battle engine, so it
// can be driven directly with a synthetic request - no BattleStream needed.
// `choose` is overridden to capture the submitted choice string instead of
// writing to a stream.
function makeAI(ownTeam: Array<{ species: string }>, onDecision?: (snapshot: MoveDecisionSnapshot) => void) {
  const stream = { write: async () => {} } as unknown as Streams.ObjectReadWriteStream<string>;
  const ai = new DoublesPlayerAI(stream, ownTeam as unknown as PokemonSet[], 'gen9doublescustomgame', onDecision);
  let captured: string | undefined;
  ai.choose = (choice: string) => {
    captured = choice;
  };
  ai.receiveRequest({ side: { id: 'p1' } } as never); // establishes mySide without side effects
  return { ai, getChoice: () => captured };
}

function moveRequest(myConditions: [string, string]) {
  return {
    side: {
      id: 'p1',
      pokemon: [{ condition: myConditions[0] }, { condition: myConditions[1] }],
    },
    active: [
      {
        moves: [
          { move: 'Earthquake', target: 'allAdjacent', disabled: false },
          { move: 'Rock Slide', target: 'allAdjacentFoes', disabled: false },
        ],
      },
      { moves: [{ move: 'Rock Throw', target: 'normal', disabled: false }] },
    ],
  } as never;
}

test('DoublesPlayerAI avoids an allAdjacent move that would friendly-fire a vulnerable ally, picking the foe-only spread move instead', () => {
  // Rhydon (Ground/Rock) can Earthquake (higher base power, hits everyone
  // adjacent) or Rock Slide (foe-only). Its ally, Onix (Rock/Ground), takes
  // 2x from Earthquake - so despite Earthquake's raw power advantage, Rock
  // Slide should score higher once the ally damage is priced in.
  const { ai, getChoice } = makeAI([{ species: 'Rhydon' }, { species: 'Onix' }]);
  ai.receiveLine('|switch|p2a: Growlithe|Growlithe, L50, M|100/100');
  ai.receiveLine('|switch|p2b: Vulpix|Vulpix, L50, M|100/100');

  ai.receiveRequest(moveRequest(['100/100', '100/100']));

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0]!.startsWith('move 2'), true, `expected Rock Slide (move 2), got "${choice}"`);
});

test('DoublesPlayerAI uses the allAdjacent move when the ally is immune to it', () => {
  // Pidgeot (Normal/Flying) is immune to Ground moves, so Earthquake's
  // friendly fire never materializes and its higher base power should win.
  const { ai, getChoice } = makeAI([{ species: 'Rhydon' }, { species: 'Pidgeot' }]);
  ai.receiveLine('|switch|p2a: Growlithe|Growlithe, L50, M|100/100');
  ai.receiveLine('|switch|p2b: Vulpix|Vulpix, L50, M|100/100');

  ai.receiveRequest(moveRequest(['100/100', '100/100']));

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0]!.startsWith('move 1'), true, `expected Earthquake (move 1), got "${choice}"`);
});

test('DoublesPlayerAI aims Low Kick at the heavier of two same-typed foes (Onix over Geodude)', () => {
  // Both foes are Rock/Ground, so type effectiveness and STAB are identical
  // either way - only Onix's far greater weight (210kg vs Geodude's 20kg,
  // real Low Kick power 120 vs 40) should decide the target.
  const { ai, getChoice } = makeAI([{ species: 'Mankey' }, { species: 'Rattata' }]);
  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveLine('|switch|p2b: Onix|Onix, L13|45/45');

  ai.receiveRequest({
    side: {
      id: 'p1',
      pokemon: [{ condition: '100/100' }, { condition: '100/100' }],
    },
    active: [
      { moves: [{ move: 'Low Kick', target: 'normal', disabled: false }] },
      { moves: [{ move: 'Tackle', target: 'normal', disabled: false }] },
    ],
  } as never);

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0], 'move 1 2', `expected Low Kick on Onix (foe slot 2), got "${choice}"`);
});

// The joint search commits both slots' choices in one `tryJointMove` call,
// so unlike the per-slot fallback (see HeuristicPlayerAI.test.ts) it should
// report one decision snapshot per slot, not one for the whole turn.
test('DoublesPlayerAI reports one decision snapshot per slot for a joint move', () => {
  const decisions: MoveDecisionSnapshot[] = [];
  const { ai, getChoice } = makeAI([{ species: 'Rhydon' }, { species: 'Pidgeot' }], (d) => decisions.push(d));
  ai.receiveLine('|turn|1');
  ai.receiveLine('|switch|p2a: Growlithe|Growlithe, L50, M|100/100');
  ai.receiveLine('|switch|p2b: Vulpix|Vulpix, L50, M|100/100');

  ai.receiveRequest(moveRequest(['80/100', '100/100']));

  assert.ok(getChoice(), 'AI should have submitted a choice');
  assert.equal(decisions.length, 2);

  const [decisionA, decisionB] = decisions;
  assert.equal(decisionA!.slot, 'a');
  assert.equal(decisionA!.own[0]!.species, 'Rhydon');
  assert.equal(decisionA!.own[0]!.hp, 80);
  assert.equal(decisionA!.legalMoves.length, 2, 'Rhydon had two legal moves to choose from');

  assert.equal(decisionB!.slot, 'b');
  assert.equal(decisionB!.own[1]!.species, 'Pidgeot');
  assert.deepEqual(decisionB!.legalMoves, [{ move: 'Rock Throw', target: 'normal' }]);

  for (const d of [decisionA!, decisionB!]) {
    assert.equal(d.turn, 1);
    assert.equal(d.side, 'p1');
    assert.equal(d.foe[0]!.species, 'Growlithe');
    assert.equal(d.foe[1]!.species, 'Vulpix');
  }
});
