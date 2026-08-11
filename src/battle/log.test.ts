import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Streams } from '@pkmn/sim';
import { collectOmniscientLog } from './log.js';

function fakeStream(chunks: string[]): Streams.ObjectReadWriteStream<string> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })() as unknown as Streams.ObjectReadWriteStream<string>;
}

test('collectOmniscientLog buckets lines by turn and strips the leading pipe', async () => {
  const result = await collectOmniscientLog(
    fakeStream(['|start\n|player|p1|Red', '|turn|1\n|move|p1a: Pikachu|Thunder Shock|p2a: Geodude', '|turn|2'])
  );

  assert.equal(result.turns.length, 3);
  assert.deepEqual(result.turns[0], { turn: 0, lines: ['start', 'player|p1|Red'] });
  assert.deepEqual(result.turns[1], { turn: 1, lines: ['move|p1a: Pikachu|Thunder Shock|p2a: Geodude'] });
  assert.deepEqual(result.turns[2], { turn: 2, lines: [] });
});

test('collectOmniscientLog captures the winner', async () => {
  const result = await collectOmniscientLog(fakeStream(['|turn|1', '|win|Red']));

  assert.equal(result.winner, 'Red');
  assert.equal(result.tie, false);
});

test('collectOmniscientLog captures a tie', async () => {
  const result = await collectOmniscientLog(fakeStream(['|turn|1', '|tie']));

  assert.equal(result.tie, true);
  assert.equal(result.winner, undefined);
});
