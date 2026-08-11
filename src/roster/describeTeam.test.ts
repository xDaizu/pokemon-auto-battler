import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTeam } from './describeTeam.js';

const TEAM = {
  label: 'Red',
  exportText:
    'Pikachu\nAbility: Static\nLevel: 13\n- Thunder Shock\n- Quick Attack\n\n' +
    'Caterpie\nAbility: Shield Dust\nLevel: 13\n- Tackle\n- String Shot',
};

test('describeTeam parses export text into display data', () => {
  const summary = describeTeam(TEAM);

  assert.equal(summary.label, 'Red');
  assert.deepEqual(summary.pokemon, [
    { species: 'pikachu', name: 'Pikachu', num: 25, level: 13, types: ['Electric'] },
    { species: 'caterpie', name: 'Caterpie', num: 10, level: 13, types: ['Bug'] },
  ]);
});

test('describeTeam throws if the export text cannot be parsed', () => {
  assert.throws(() => describeTeam({ label: 'Bad', exportText: 'not a showdown export at all' }));
});
