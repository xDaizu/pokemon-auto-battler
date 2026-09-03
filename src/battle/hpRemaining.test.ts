import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHpRemaining } from './hpRemaining.js';
import type { BattleTurnLog } from '../../shared/apiTypes.js';

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);
}

test('computeHpRemaining sums remaining HP over total possible HP across the whole roster', () => {
  const turns: BattleTurnLog[] = [
    {
      turn: 0,
      lines: [
        'switch|p1a: Squirtle|Squirtle, L13|39/39',
        'switch|p1b: Caterpie|Caterpie, L13|35/35',
        'switch|p2a: Geodude|Geodude, L13|35/35',
        'switch|p2b: Onix|Onix, L13|45/45',
      ],
    },
    { turn: 1, lines: ['-damage|p1a: Squirtle|20/39', '-damage|p2a: Geodude|10/35'] },
  ];

  const { p1Pct, p2Pct } = computeHpRemaining(turns);

  assertClose(p1Pct, ((20 + 35) / (39 + 35)) * 100);
  assertClose(p2Pct, ((10 + 45) / (35 + 45)) * 100);
});

test('computeHpRemaining treats a fainted Pokemon as contributing 0, not dropping out', () => {
  // `-damage` on a lethal hit reads bare "0 fnt", with no maxhp field - the
  // roster's total possible HP must still count Geodude's real 35 maxhp, not
  // fall back to `parseCondition`'s maxhp:1 default for that shape.
  const turns: BattleTurnLog[] = [
    {
      turn: 0,
      lines: ['switch|p1a: Squirtle|Squirtle, L13|39/39', 'switch|p2a: Geodude|Geodude, L13|35/35'],
    },
    { turn: 1, lines: ['-damage|p2a: Geodude|0 fnt', 'faint|p2a: Geodude'] },
  ];

  const { p1Pct, p2Pct } = computeHpRemaining(turns);

  assertClose(p1Pct, 100);
  assertClose(p2Pct, 0);
});

test('computeHpRemaining picks up heals as well as damage', () => {
  const turns: BattleTurnLog[] = [
    { turn: 0, lines: ['switch|p1a: Chansey|Chansey, L13|70/70'] },
    { turn: 1, lines: ['-damage|p1a: Chansey|30/70'] },
    { turn: 2, lines: ['-heal|p1a: Chansey|55/70'] },
  ];

  const { p1Pct } = computeHpRemaining(turns);

  assertClose(p1Pct, (55 / 70) * 100);
});

test('computeHpRemaining keeps the last-seen condition per display name, across switches out and back in', () => {
  const turns: BattleTurnLog[] = [
    {
      turn: 0,
      lines: ['switch|p1a: Squirtle|Squirtle, L13|39/39', 'switch|p1b: Caterpie|Caterpie, L13|35/35'],
    },
    { turn: 1, lines: ['-damage|p1a: Squirtle|10/39', 'switch|p1a: Caterpie|Caterpie, L13|35/35'] },
  ];

  const { p1Pct } = computeHpRemaining(turns);

  // Squirtle's last-seen condition stays 10/39 even after switching out.
  assertClose(p1Pct, ((10 + 35) / (39 + 35)) * 100);
});

test('computeHpRemaining returns 0 for a side with no seen Pokemon', () => {
  const { p1Pct, p2Pct } = computeHpRemaining([{ turn: 0, lines: ['start'] }]);

  assert.equal(p1Pct, 0);
  assert.equal(p2Pct, 0);
});
