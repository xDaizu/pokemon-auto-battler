import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMoveCandidates } from './moveCandidates.js';

function active(moves: Array<{ move: string; target: string; disabled?: boolean }>) {
  return { moves };
}

test('deriveMoveCandidates drops disabled moves', () => {
  const candidates = deriveMoveCandidates(
    active([
      { move: 'Tackle', target: 'normal', disabled: false },
      { move: 'Earthquake', target: 'allAdjacent', disabled: true },
    ]),
    true
  );
  assert.deepEqual(
    candidates.map((c) => c.move.move),
    ['Tackle']
  );
});

test('deriveMoveCandidates drops adjacentAlly moves (e.g. Helping Hand) when there is no living ally', () => {
  const candidates = deriveMoveCandidates(
    active([
      { move: 'Tackle', target: 'normal' },
      { move: 'Helping Hand', target: 'adjacentAlly' },
    ]),
    false
  );
  assert.deepEqual(
    candidates.map((c) => c.move.move),
    ['Tackle']
  );
});

test('deriveMoveCandidates keeps adjacentAlly moves (e.g. Helping Hand) when an ally is alive', () => {
  const candidates = deriveMoveCandidates(
    active([
      { move: 'Tackle', target: 'normal' },
      { move: 'Helping Hand', target: 'adjacentAlly' },
    ]),
    true
  );
  assert.deepEqual(
    candidates.map((c) => c.move.move),
    ['Tackle', 'Helping Hand']
  );
});

test('deriveMoveCandidates falls back to the unfiltered move list if Helping Hand is the only legal move and there is no ally', () => {
  const candidates = deriveMoveCandidates(active([{ move: 'Helping Hand', target: 'adjacentAlly' }]), false);
  assert.deepEqual(
    candidates.map((c) => c.move.move),
    ['Helping Hand']
  );
});

test('deriveMoveCandidates resolves 1-based slot numbers and builds the base "move N" choice string', () => {
  const candidates = deriveMoveCandidates(
    active([
      { move: 'Rock Slide', target: 'allAdjacentFoes' },
      { move: 'Earthquake', target: 'allAdjacent' },
    ]),
    true
  );
  assert.deepEqual(
    candidates.map((c) => [c.choice, c.move.slot]),
    [
      ['move 1', 1],
      ['move 2', 2],
    ]
  );
});
