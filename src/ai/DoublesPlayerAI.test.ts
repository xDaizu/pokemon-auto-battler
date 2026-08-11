import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PokemonSet, Streams } from '@pkmn/sim';
import { DoublesPlayerAI } from './DoublesPlayerAI.js';

// DoublesPlayerAI.tryJointMove never touches the real battle engine, so it
// can be driven directly with a synthetic request - no BattleStream needed.
// `choose` is overridden to capture the submitted choice string instead of
// writing to a stream.
function makeAI(ownTeam: Array<{ species: string }>) {
  const stream = { write: async () => {} } as unknown as Streams.ObjectReadWriteStream<string>;
  const ai = new DoublesPlayerAI(stream, ownTeam as unknown as PokemonSet[], 'gen9doublescustomgame');
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
