import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evoBranches, getRoster, speciesLineage } from './roster.js';

/** Mirrors the same-family conflict check in buildTeam.ts and TeamBuilder.tsx:
 * two stages conflict iff one's id is on the other's lineage (self included). */
function conflicts(a: string, b: string): boolean {
  return speciesLineage(a).includes(b) || speciesLineage(b).includes(a);
}

function movesFor(groupId: string) {
  const line = getRoster('brock').find((l) => l.groupId === groupId)!;
  return line.stages[0]!.moves;
}

test('roster prefers gen 9 level-up moves for species in Scarlet/Violet\'s dex', () => {
  const ids = movesFor('pikachu').map((m) => m.id);

  // Thunder Shock/Growl/Quick Attack are gen 9 level-up moves for Pikachu.
  assert.ok(ids.includes('thundershock'));
  assert.ok(ids.includes('growl'));
  assert.ok(ids.includes('quickattack'));

  // Thunder Punch and Substitute have no level-up entry in any generation for
  // Pikachu (TM/tutor-only) — must never appear regardless of reference gen.
  assert.ok(!ids.includes('thunderpunch'));
  assert.ok(!ids.includes('substitute'));
});

test('roster falls back to gen 8 for species Scarlet/Violet never assigned a learnset (e.g. Caterpie)', () => {
  const ids = movesFor('caterpie').map((m) => m.id);

  // Tackle/String Shot/Bug Bite are Caterpie's gen 8 level-up moves — its
  // newest generation with any level-up data, verified against PokeAPI.
  assert.ok(ids.includes('tackle'));
  assert.ok(ids.includes('stringshot'));
  assert.ok(ids.includes('bugbite'));
});

test('roster move levels never exceed the level cap', () => {
  for (const groupId of ['pikachu', 'caterpie']) {
    for (const move of movesFor(groupId)) {
      assert.ok(move.learnedAt <= 13, `${move.name} learned at ${move.learnedAt}, above the level 13 cap`);
    }
  }
});

test('evoBranches ignores an item-gated evolution when its item is not listed', () => {
  assert.deepEqual(evoBranches('clefairy', 19, []), [['clefairy']]);
});

test('evoBranches walks an item-gated evolution once its item is listed', () => {
  assert.deepEqual(evoBranches('clefairy', 19, ['Moon Stone']), [['clefairy', 'clefable']]);
  // The listed item unlocks the useItem edge, but level-up gating still
  // applies to every earlier edge in the same chain.
  assert.deepEqual(evoBranches('nidoranf', 19, ['Moon Stone']), [['nidoranf', 'nidorina', 'nidoqueen']]);
  assert.deepEqual(evoBranches('nidoranf', 15, ['Moon Stone']), [['nidoranf']]);
});

test('evoBranches does not unlock an unrelated item-gated evolution', () => {
  // Clefairy's evolution is Moon Stone-gated; listing an unrelated item must
  // not walk it.
  assert.deepEqual(evoBranches('clefairy', 19, ['Water Stone']), [['clefairy']]);
});

test('evoBranches stops a branching family at the shared pre-evolution when no branch item is unlocked', () => {
  // Oddish -> Gloom is a plain level-up; Gloom's own two evolutions
  // (Vileplume/Bellossom) are both item-gated. With neither item listed,
  // every branch collapses to the same single chain ending at Gloom.
  assert.deepEqual(evoBranches('oddish', 50, []), [['oddish', 'gloom']]);
});

test('evoBranches yields one branch per reachable evolution out of a branch point', () => {
  // With only the Leaf Stone unlocked, Gloom's line has exactly one
  // reachable evolution (Vileplume) - still a single, non-branching chain.
  assert.deepEqual(evoBranches('oddish', 50, ['Leaf Stone']), [['oddish', 'gloom', 'vileplume']]);

  // With both stones unlocked, the same family splits into two branches -
  // one per final stage - instead of only ever returning the first evo
  // found (the pre-fix behavior).
  assert.deepEqual(evoBranches('oddish', 50, ['Leaf Stone', 'Sun Stone']).sort(), [
    ['oddish', 'gloom', 'bellossom'],
    ['oddish', 'gloom', 'vileplume'],
  ]);
});

test('evoBranches only branches on item-gated evolutions, never on friendship (out of scope)', () => {
  // Eevee's non-item evolutions (Espeon, Umbreon, Leafeon, Glaceon, Sylveon)
  // are friendship/location-gated, never reachable regardless of items
  // listed - only Vaporeon/Jolteon/Flareon (stone-gated) can ever appear.
  assert.deepEqual(evoBranches('eevee', 50, ['Water Stone', 'Thunder Stone', 'Fire Stone']).sort(), [
    ['eevee', 'flareon'],
    ['eevee', 'jolteon'],
    ['eevee', 'vaporeon'],
  ]);
  // With none of those items listed, Eevee has no reachable evolution at all.
  assert.deepEqual(evoBranches('eevee', 50, []), [['eevee']]);
});

test('speciesLineage walks a linear chain and a branching one to the same root-first shape', () => {
  // Pichu is Pikachu's real (breeding-only) pre-evolution - never obtainable
  // in any roster here, but still part of the dex's lineage.
  assert.deepEqual(speciesLineage('pikachu'), ['pichu', 'pikachu']);
  assert.deepEqual(speciesLineage('venusaur'), ['bulbasaur', 'ivysaur', 'venusaur']);
  assert.deepEqual(speciesLineage('vileplume'), ['oddish', 'gloom', 'vileplume']);
  assert.deepEqual(speciesLineage('bellossom'), ['oddish', 'gloom', 'bellossom']);
  assert.deepEqual(speciesLineage('jolteon'), ['eevee', 'jolteon']);
});

test('same-family conflict: sibling branches coexist, ancestor/descendant pairs do not', () => {
  // The exact scenarios from the family rule.
  assert.equal(conflicts('jolteon', 'flareon'), false, 'Jolteon and Flareon are sibling branches');
  assert.equal(conflicts('jolteon', 'eevee'), true, 'Eevee is Jolteon\'s own pre-evolution');
  assert.equal(conflicts('bellossom', 'vileplume'), false, 'Bellossom and Vileplume are sibling branches');
  assert.equal(conflicts('vileplume', 'gloom'), true, 'Gloom is Vileplume\'s own pre-evolution');
  assert.equal(conflicts('bellossom', 'gloom'), true, 'Gloom is Bellossom\'s own pre-evolution too');
  // A linear (non-branching) family still conflicts stage-to-stage.
  assert.equal(conflicts('growlithe', 'arcanine'), true);
  // Unrelated families never conflict.
  assert.equal(conflicts('pikachu', 'caterpie'), false);
  // A species trivially conflicts with itself (the plain duplicate case).
  assert.equal(conflicts('pikachu', 'pikachu'), true);
});

test("getRoster produces one line per reachable branch, using the final stage as its own line's tip", () => {
  const roster = getRoster('brock');
  const pikachu = roster.find((l) => l.groupId === 'pikachu')!.stages[0]!;
  // Pikachu is a real, non-branching line already in Brock's roster; its
  // groupId stays the bare species id, and its lineage is Pichu's real
  // (unreachable) pre-evolution plus itself.
  assert.deepEqual(pikachu.lineage, ['pichu', 'pikachu']);
});

test("Misty's roster adds Mr. Mime as a trade-only line, mutually exclusive with Clefairy", () => {
  const roster = getRoster('misty');
  const mrMime = roster.find((l) => l.groupId === 'mrmime');
  const clefairy = roster.find((l) => l.groupId === 'clefairy');

  assert.ok(mrMime, 'Mr. Mime should appear in Misty\'s roster even though it is not a wild encounter');
  assert.equal(mrMime!.stages[0]!.name, 'Mr. Mime');
  assert.equal(mrMime!.exclusiveGroupKind, 'trade');
  assert.equal(clefairy!.exclusiveGroupKind, 'trade');
  assert.equal(mrMime!.exclusiveGroup, clefairy!.exclusiveGroup);
  assert.ok(mrMime!.exclusiveGroup);
});

test("Mr. Mime's trade exclusivity does not leak into Brock's roster", () => {
  const roster = getRoster('brock');
  assert.equal(
    roster.find((l) => l.groupId === 'mrmime'),
    undefined
  );
});
