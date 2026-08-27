import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedTeam, TeamSelectionError } from './buildTeam.js';

const PIKACHU =
  'Pikachu\nAbility: Static\nLevel: 13\nAdamant Nature\n- Thunder Shock\n- Quick Attack\n- Growl\n- Tail Whip';
const CATERPIE = 'Caterpie\nAbility: Shield Dust\nLevel: 13\nBashful Nature\n- Tackle\n- String Shot';

function assertRejected(exportText: string, message: string, leaderId = 'brock') {
  assert.throws(() => parseImportedTeam(leaderId, exportText), (err: unknown) => {
    assert.ok(err instanceof TeamSelectionError);
    assert.equal((err as Error).message, message);
    return true;
  });
}

test('parseImportedTeam accepts a legal two-Pokemon export', () => {
  const selections = parseImportedTeam('brock', `${PIKACHU}\n\n${CATERPIE}`);
  assert.deepEqual(selections, [
    {
      stageId: 'pikachu',
      ability: 'static',
      nature: 'adamant',
      moves: ['thundershock', 'quickattack', 'growl', 'tailwhip'],
    },
    { stageId: 'caterpie', ability: 'shielddust', nature: 'bashful', moves: ['tackle', 'stringshot'] },
  ]);
});

test('parseImportedTeam rejects unparsable text', () => {
  assertRejected('not a showdown export at all', 'Could not parse that as a Showdown export.');
});

test('parseImportedTeam rejects an empty export', () => {
  assertRejected('', 'Could not parse that as a Showdown export.');
});

test('parseImportedTeam rejects a single Pokemon', () => {
  assertRejected(PIKACHU, 'Choose exactly 2 Pokemon.');
});

test('parseImportedTeam rejects three Pokemon', () => {
  const weedle = 'Weedle\nLevel: 13\n- Poison Sting';
  assertRejected(`${PIKACHU}\n\n${CATERPIE}\n\n${weedle}`, 'Choose exactly 2 Pokemon.');
});

test('parseImportedTeam rejects a held item', () => {
  const pikachuWithItem = PIKACHU.replace('Pikachu\n', 'Pikachu @ Light Ball\n');
  assertRejected(`${pikachuWithItem}\n\n${CATERPIE}`, "Pokemon 1: items aren't allowed.");
});

test('parseImportedTeam rejects a level above the cap', () => {
  const overLevel = PIKACHU.replace('Level: 13', 'Level: 50');
  assertRejected(`${overLevel}\n\n${CATERPIE}`, 'Pokemon 1: must be Level 13.');
});

test('parseImportedTeam rejects a level below the cap', () => {
  const underLevel = PIKACHU.replace('Level: 13', 'Level: 5');
  assertRejected(`${underLevel}\n\n${CATERPIE}`, 'Pokemon 1: must be Level 13.');
});

test('parseImportedTeam rejects a species not obtainable before Brock', () => {
  const mewtwo = 'Mewtwo\nLevel: 13\n- Psychic';
  assertRejected(`${mewtwo}\n\n${CATERPIE}`, 'Pokemon 1: "mewtwo" is not a legal choice.');
});

test('parseImportedTeam rejects a move not legal for the species at the level cap', () => {
  const illegalMove = PIKACHU.replace('- Thunder Shock', '- Thunderbolt');
  assertRejected(`${illegalMove}\n\n${CATERPIE}`, 'Pokemon 1: "thunderbolt" is not legal for Pikachu at level 13.');
});

test('parseImportedTeam rejects a TM/tutor-only move that is never learnt by level-up', () => {
  // Thunder Punch is TM/tutor-only for Pikachu in every generation, never level-up.
  const tutorMove = PIKACHU.replace('- Thunder Shock', '- Thunder Punch');
  assertRejected(`${tutorMove}\n\n${CATERPIE}`, 'Pokemon 1: "thunderpunch" is not legal for Pikachu at level 13.');
});

test('parseImportedTeam rejects duplicate moves', () => {
  const dup = 'Pikachu\nAbility: Static\nLevel: 13\nAdamant Nature\n- Thunder Shock\n- Thunder Shock';
  assertRejected(`${dup}\n\n${CATERPIE}`, 'Pokemon 1: duplicate move selected.');
});

test('parseImportedTeam rejects more than 4 moves', () => {
  const fiveMoves = `${PIKACHU}\n- Thunder Wave`;
  assertRejected(`${fiveMoves}\n\n${CATERPIE}`, 'Pokemon 1: choose between 1 and 4 moves.');
});

test('parseImportedTeam rejects zero moves', () => {
  const noMoves = 'Pikachu\nAbility: Static\nLevel: 13\nAdamant Nature';
  assertRejected(`${noMoves}\n\n${CATERPIE}`, 'Pokemon 1: choose between 1 and 4 moves.');
});

test('parseImportedTeam rejects an illegal ability', () => {
  const badAbility = PIKACHU.replace('Ability: Static', 'Ability: Levitate');
  assertRejected(`${badAbility}\n\n${CATERPIE}`, 'Pokemon 1: "levitate" is not a legal ability for Pikachu.');
});

test('parseImportedTeam rejects two starters on the same team', () => {
  const bulbasaur = 'Bulbasaur\nAbility: Overgrow\nLevel: 13\nAdamant Nature\n- Tackle';
  const charmander = 'Charmander\nAbility: Blaze\nLevel: 13\nAdamant Nature\n- Scratch';
  assertRejected(
    `${bulbasaur}\n\n${charmander}`,
    'Only one starter (Bulbasaur/Charmander/Squirtle) can be on your team.'
  );
});

test('parseImportedTeam rejects two identical Pokemon on the same team', () => {
  assertRejected(`${PIKACHU}\n\n${PIKACHU}`, 'Your team cannot contain the same Pokemon twice.');
});

test('parseImportedTeam rejects two stages of the same evolution family on the same team', () => {
  // Nidoran(F) -> Nidorina -> Nidoqueen is a plain (non-branching) chain;
  // both the base and its own evolution are individually legal picks under
  // Misty's level 19 cap, but not together.
  const nidoranf = 'Nidoran-F\nAbility: Poison Point\nLevel: 19\nBashful Nature\n- Growl';
  const nidorina = 'Nidorina\nAbility: Poison Point\nLevel: 19\nBashful Nature\n- Growl';
  const pikachu19 = 'Pikachu\nAbility: Static\nLevel: 19\nAdamant Nature\n- Thunder Shock';
  assertRejected(
    `${nidoranf}\n\n${nidorina}\n\n${pikachu19}`,
    'Your team cannot contain two Pokemon from the same evolution family.',
    'misty'
  );
});

test('parseImportedTeam rejects Clefairy and Mr. Mime on the same team (traded for each other)', () => {
  const clefairy = 'Clefairy\nAbility: Cute Charm\nLevel: 19\nBashful Nature\n- Pound';
  const mrMime = 'Mr. Mime\nAbility: Soundproof\nLevel: 19\nBashful Nature\n- Pound';
  const pikachu19 = 'Pikachu\nAbility: Static\nLevel: 19\nAdamant Nature\n- Thunder Shock';
  assertRejected(
    `${clefairy}\n\n${mrMime}\n\n${pikachu19}`,
    "Your team can't include both sides of an in-game trade (e.g. Clefairy and Mr. Mime).",
    'misty'
  );
});
