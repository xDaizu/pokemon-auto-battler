import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSpeciesList } from './nationalDex.js';

test('getSpeciesList returns the full national dex, in dex order', () => {
  const species = getSpeciesList();

  // The whole national dex through gen 9, not roster.ts's tiny battle pool.
  assert.equal(species.length, 1025);

  const nums = species.map((s) => s.num);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  assert.equal(species[0]!.id, 'bulbasaur');
});

test('getSpeciesList keeps species outside the gen 9 dex', () => {
  const ids = new Set(getSpeciesList().map((s) => s.id));

  // These are isNonstandard: 'Past' under FORMAT_ID. A Pokemon picker that
  // can't pick Pidgey would be absurd, so 'Past' is deliberately included.
  assert.ok(ids.has('pidgey'));
  assert.ok(ids.has('caterpie'));
});

test('getSpeciesList has no duplicate ids', () => {
  const ids = getSpeciesList().map((s) => s.id);

  assert.equal(new Set(ids).size, ids.length);
});

test('getSpeciesList excludes alternate formes, keeping the base species', () => {
  const ids = new Set(getSpeciesList().map((s) => s.id));

  assert.ok(ids.has('charizard'));
  assert.ok(!ids.has('charizardmegax'));
  assert.ok(!ids.has('raichualola'));
  assert.ok(!ids.has('venusaurgmax'));
});

test('getSpeciesList is memoised across calls', () => {
  assert.equal(getSpeciesList(), getSpeciesList());
});
