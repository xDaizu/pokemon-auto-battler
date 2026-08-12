import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFaints } from './faints.js';
import type { BattleTurnLog } from '../../shared/apiTypes.js';

test('detectFaints buckets faints by side across turns', () => {
  const turns: BattleTurnLog[] = [
    { turn: 0, lines: ['start', 'player|p1|Red'] },
    { turn: 1, lines: ['move|p1a: Pikachu|Thunder Shock|p2a: Geodude', 'faint|p2a: Geodude'] },
    { turn: 2, lines: ['faint|p1b: Caterpie', 'faint|p2b: Onix'] },
  ];

  const { p1, p2 } = detectFaints(turns);

  assert.deepEqual([...p1], ['Caterpie']);
  assert.deepEqual([...p2].sort(), ['Geodude', 'Onix']);
});

test('detectFaints reads both active slots', () => {
  const turns: BattleTurnLog[] = [{ turn: 1, lines: ['faint|p1a: Bulbasaur', 'faint|p1b: Pidgey'] }];

  const { p1, p2 } = detectFaints(turns);

  assert.deepEqual([...p1].sort(), ['Bulbasaur', 'Pidgey']);
  assert.equal(p2.size, 0);
});

test('detectFaints ignores lines that merely mention fainting', () => {
  // `-damage` lines carry an hp field that reads `0 fnt`, and switch lines name
  // Pokemon without any faint having happened. Neither is a faint event.
  const turns: BattleTurnLog[] = [
    { turn: 1, lines: ['-damage|p2a: Geodude|0 fnt', 'switch|p1a: Squirtle|Squirtle, L13|39/39', 'faint|p2a: Geodude'] },
  ];

  const { p1, p2 } = detectFaints(turns);

  assert.equal(p1.size, 0);
  assert.deepEqual([...p2], ['Geodude']);
});

test('detectFaints returns empty sets for a battle with no faints', () => {
  const { p1, p2 } = detectFaints([{ turn: 0, lines: ['start'] }, { turn: 1, lines: ['turn|1'] }]);

  assert.equal(p1.size, 0);
  assert.equal(p2.size, 0);
});

test('detectFaints deduplicates a name fainting more than once', () => {
  // Defensive: the same display name should collapse to one entry, since the
  // caller treats these as a per-Pokemon boolean.
  const turns: BattleTurnLog[] = [
    { turn: 1, lines: ['faint|p1a: Pikachu'] },
    { turn: 2, lines: ['faint|p1a: Pikachu'] },
  ];

  assert.deepEqual([...detectFaints(turns).p1], ['Pikachu']);
});
