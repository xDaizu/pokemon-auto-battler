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

// The matchup this exists for: every attack the slot owns is resisted, so
// chipping is worse than debuffing. Asserted end-to-end through the joint
// search (not just `bestHit`) because it's the path battles actually take.
function spearowIntoRockWall(spearowMoves: Array<{ move: string; target: string; disabled: boolean }>) {
  return {
    side: {
      id: 'p1',
      pokemon: [{ condition: '100/100' }, { condition: '100/100' }],
    },
    active: [{ moves: spearowMoves }, { moves: [{ move: 'Tackle', target: 'normal', disabled: false }] }],
  } as never;
}

test('DoublesPlayerAI reaches for Growl when every attack it has is resisted by both foes', () => {
  // Spearow (Normal/Flying) into Geodude + Onix (both Rock/Ground): Peck and
  // Fury Attack are both resisted, and Growl drops the Attack of BOTH foes at
  // once - worth more than a turn of chip damage.
  const { ai, getChoice } = makeAI([{ species: 'Spearow' }, { species: 'Rattata' }]);
  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveLine('|switch|p2b: Onix|Onix, L13|45/45');

  ai.receiveRequest(
    spearowIntoRockWall([
      { move: 'Peck', target: 'any', disabled: false },
      { move: 'Fury Attack', target: 'normal', disabled: false },
      { move: 'Growl', target: 'allAdjacentFoes', disabled: false },
    ])
  );

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0], 'move 3', `expected Growl (move 3), got "${choice}"`);
});

test('DoublesPlayerAI stops Growling once both foes are already at the debuff cap', () => {
  // Same hopeless matchup, but the foes' Attack is already floored - another
  // Growl buys nothing, so the resisted STAB attack becomes the best play.
  const { ai, getChoice } = makeAI([{ species: 'Spearow' }, { species: 'Rattata' }]);
  ai.receiveLine('|switch|p2a: Geodude|Geodude, L13|35/35');
  ai.receiveLine('|switch|p2b: Onix|Onix, L13|45/45');
  for (let i = 0; i < 6; i++) {
    ai.receiveLine('|-unboost|p2a: Geodude|atk|1');
    ai.receiveLine('|-unboost|p2b: Onix|atk|1');
  }

  ai.receiveRequest(
    spearowIntoRockWall([
      { move: 'Peck', target: 'any', disabled: false },
      { move: 'Fury Attack', target: 'normal', disabled: false },
      { move: 'Growl', target: 'allAdjacentFoes', disabled: false },
    ])
  );

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0]!.startsWith('move 1'), true, `expected Peck (move 1), got "${choice}"`);
});

test('DoublesPlayerAI still attacks over Growling when the matchup is favourable', () => {
  // Identical Spearow and identical movepool - only the foes differ. Nothing
  // resists Flying here, so the status move must not win.
  const { ai, getChoice } = makeAI([{ species: 'Spearow' }, { species: 'Rattata' }]);
  ai.receiveLine('|switch|p2a: Caterpie|Caterpie, L13|35/35');
  ai.receiveLine('|switch|p2b: Weedle|Weedle, L13|35/35');

  ai.receiveRequest(
    spearowIntoRockWall([
      { move: 'Peck', target: 'any', disabled: false },
      { move: 'Fury Attack', target: 'normal', disabled: false },
      { move: 'Growl', target: 'allAdjacentFoes', disabled: false },
    ])
  );

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  assert.equal(choice!.split(', ')[0]!.startsWith('move 1'), true, `expected Peck (move 1), got "${choice}"`);
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

// Regression test for the bench-safety bug M1 fixes: both AIs used to assume
// `ownTeam[slotIdx]` named whoever was currently in that active slot, which
// only held for a 2-mon team that never switches. Here `ownTeam` is built in
// Squirtle/Pidgey/Charmander order, but Squirtle (originally active slot a)
// has fainted and Charmander (originally benched third) has switched into
// slot a - Showdown reorders `side.pokemon` so actives lead, so slot a's
// request entry now names Charmander even though `ownTeam[0]` is still
// Squirtle. Only one foe is revealed, so the joint search declines
// (foeSpecies[1] unset) and this exercises the per-slot fallback
// (HeuristicPlayerAI.chooseMove) that DoublesPlayerAI inherits.
test("DoublesPlayerAI scores the bench replacement's typing after the original lead faints, not the stale team-order slot", () => {
  const { ai, getChoice } = makeAI([{ species: 'Squirtle' }, { species: 'Pidgey' }, { species: 'Charmander' }]);
  ai.receiveLine('|switch|p2a: Rattata|Rattata, L50|100/100');

  ai.receiveRequest({
    side: {
      id: 'p1',
      pokemon: [
        { details: 'Charmander, L50, M', condition: '100/100' },
        { details: 'Pidgey, L50, M', condition: '100/100' },
        { details: 'Squirtle, L50, M', condition: '0 fnt' },
      ],
    },
    active: [
      {
        moves: [
          { move: 'Tackle', target: 'normal', disabled: false },
          { move: 'Water Gun', target: 'normal', disabled: false },
        ],
      },
      { moves: [{ move: 'Tackle', target: 'normal', disabled: false }] },
    ],
  } as never);

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  // Against a neutral Normal-type foe, Tackle and Water Gun have equal base
  // power (40) - only STAB can break the tie. Resolved correctly as
  // Charmander (Fire), neither move gets STAB and the first candidate
  // (Tackle) wins the tie. Resolved as the stale ownTeam[0] (Squirtle,
  // Water), Water Gun would falsely get STAB and win instead.
  assert.equal(
    choice!.split(', ')[0],
    'move 1 1',
    `expected Tackle (move 1) via Charmander's real typing, got "${choice}"`
  );
});

// Regression test for the `chooseSwitch` override: `RandomPlayerAI`'s default
// picks a bench candidate at random. With two bench options of different
// types against a revealed live foe, the AI should send in whichever one
// actually has a type-advantaged move rather than choosing arbitrarily.
test('DoublesPlayerAI.chooseSwitch sends in the bench Pokemon with the best matchup against the revealed foe', () => {
  const { ai, getChoice } = makeAI([
    { species: 'Squirtle' },
    { species: 'Pidgey' },
    { species: 'Growlithe' },
    { species: 'Poliwag' },
  ]);
  ai.receiveLine('|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100');

  ai.receiveRequest({
    side: {
      id: 'p1',
      pokemon: [
        { details: 'Squirtle, L50, M', condition: '0 fnt', moves: ['watergun'] },
        { details: 'Pidgey, L50, M', condition: '100/100', moves: ['tackle'] },
        { details: 'Growlithe, L50, M', condition: '100/100', moves: ['ember'] },
        { details: 'Poliwag, L50, M', condition: '100/100', moves: ['watergun'] },
      ],
    },
    forceSwitch: [true, false],
  } as never);

  const choice = getChoice();
  assert.ok(choice, 'AI should have submitted a choice');
  // Growlithe's Ember is super effective on Bulbasaur (Grass/Poison, team
  // slot 3); Poliwag's Water Gun (slot 4) is resisted by Grass.
  assert.equal(choice!.split(', ')[0], 'switch 3', `expected switch to Growlithe (slot 3), got "${choice}"`);
});
