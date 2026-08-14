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
    {
      species: 'pikachu',
      name: 'Pikachu',
      num: 25,
      level: 13,
      types: ['Electric'],
      ability: 'Static',
      nature: undefined,
      item: undefined,
      baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
    },
    {
      species: 'caterpie',
      name: 'Caterpie',
      num: 10,
      level: 13,
      types: ['Bug'],
      ability: 'Shield Dust',
      nature: undefined,
      item: undefined,
      baseStats: { hp: 45, atk: 30, def: 35, spa: 20, spd: 20, spe: 45 },
    },
  ]);
});

test('describeTeam throws if the export text cannot be parsed', () => {
  assert.throws(() => describeTeam({ label: 'Bad', exportText: 'not a showdown export at all' }));
});
