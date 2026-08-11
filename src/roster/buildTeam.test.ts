import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedTeam, TeamSelectionError } from './buildTeam.js';

const PIKACHU = 'Pikachu\nAbility: Static\nLevel: 13\n- Thunder Shock\n- Quick Attack\n- Growl\n- Tail Whip';
const CATERPIE = 'Caterpie\nAbility: Shield Dust\nLevel: 13\n- Tackle\n- String Shot';

function assertRejected(exportText: string, message: string) {
  assert.throws(() => parseImportedTeam(exportText), (err: unknown) => {
    assert.ok(err instanceof TeamSelectionError);
    assert.equal((err as Error).message, message);
    return true;
  });
}

test('parseImportedTeam accepts a legal two-Pokemon export', () => {
  const selections = parseImportedTeam(`${PIKACHU}\n\n${CATERPIE}`);
  assert.deepEqual(selections, [
    { stageId: 'pikachu', moves: ['thundershock', 'quickattack', 'growl', 'tailwhip'] },
    { stageId: 'caterpie', moves: ['tackle', 'stringshot'] },
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
  // Thunder Punch is gen 7 tutor-only ('7T') for Pikachu, never level-up.
  const tutorMove = PIKACHU.replace('- Thunder Shock', '- Thunder Punch');
  assertRejected(`${tutorMove}\n\n${CATERPIE}`, 'Pokemon 1: "thunderpunch" is not legal for Pikachu at level 13.');
});

test('parseImportedTeam rejects duplicate moves', () => {
  const dup = 'Pikachu\nLevel: 13\n- Thunder Shock\n- Thunder Shock';
  assertRejected(`${dup}\n\n${CATERPIE}`, 'Pokemon 1: duplicate move selected.');
});

test('parseImportedTeam rejects more than 4 moves', () => {
  const fiveMoves = `${PIKACHU}\n- Thunder Wave`;
  assertRejected(`${fiveMoves}\n\n${CATERPIE}`, 'Pokemon 1: choose between 1 and 4 moves.');
});

test('parseImportedTeam rejects zero moves', () => {
  const noMoves = 'Pikachu\nLevel: 13';
  assertRejected(`${noMoves}\n\n${CATERPIE}`, 'Pokemon 1: choose between 1 and 4 moves.');
});

test('parseImportedTeam rejects two starters on the same team', () => {
  const bulbasaur = 'Bulbasaur\nLevel: 13\n- Tackle';
  const charmander = 'Charmander\nLevel: 13\n- Scratch';
  assertRejected(
    `${bulbasaur}\n\n${charmander}`,
    'Only one starter (Bulbasaur/Charmander/Squirtle) can be on your team.'
  );
});
