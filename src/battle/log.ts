import type { Streams } from '@pkmn/sim';
import type { BattleTurnLog } from '../../shared/apiTypes.js';

export interface BattleResult {
  turns: BattleTurnLog[];
  winner?: string;
  tie: boolean;
}

/**
 * Consumes the omniscient battle stream (sees both sides' info) and groups
 * it into a turn-by-turn, lightly-cleaned protocol log. Raw-ish protocol
 * lines are an acceptable v1 - @pkmn/protocol is the optional upgrade path
 * for a fully humanized log, not installed here.
 */
export async function collectOmniscientLog(stream: Streams.ObjectReadWriteStream<string>): Promise<BattleResult> {
  const turns: BattleTurnLog[] = [{ turn: 0, lines: [] }];
  let winner: string | undefined;
  let tie = false;

  for await (const chunk of stream) {
    for (const line of chunk.split('\n')) {
      if (!line) continue;

      const turnMatch = /^\|turn\|(\d+)/.exec(line);
      if (turnMatch) {
        turns.push({ turn: Number(turnMatch[1]), lines: [] });
        continue;
      }

      const winMatch = /^\|win\|(.+)/.exec(line);
      if (winMatch) {
        winner = winMatch[1];
      } else if (/^\|tie$/.test(line)) {
        tie = true;
      }

      turns[turns.length - 1]!.lines.push(line.startsWith('|') ? line.slice(1) : line);
    }
  }

  return { turns, winner, tie };
}

export function printBattleResult({ turns, winner, tie }: BattleResult): void {
  for (const { turn, lines } of turns) {
    if (turn > 0) console.log(`\n--- Turn ${turn} ---`);
    for (const line of lines) console.log(line);
  }

  if (winner) console.log(`\nWinner: ${winner}`);
  else if (tie) console.log('\nResult: Tie');
}
