import type { Streams } from '@pkmn/sim';

/**
 * Consumes the omniscient battle stream (sees both sides' info) and prints
 * a turn-grouped, lightly-cleaned protocol log to the console. Raw-ish
 * protocol output is an acceptable v1 - @pkmn/protocol is the optional
 * upgrade path for a fully humanized log, not installed here.
 */
export async function printOmniscientLog(stream: Streams.ObjectReadWriteStream<string>): Promise<void> {
  let result: string | undefined;

  for await (const chunk of stream) {
    for (const line of chunk.split('\n')) {
      if (!line) continue;

      const turnMatch = /^\|turn\|(\d+)/.exec(line);
      if (turnMatch) {
        console.log(`\n--- Turn ${turnMatch[1]} ---`);
        continue;
      }

      const winMatch = /^\|win\|(.+)/.exec(line);
      if (winMatch) {
        result = `Winner: ${winMatch[1]}`;
      } else if (/^\|tie\|?/.test(line)) {
        result = 'Result: Tie';
      }

      console.log(line.startsWith('|') ? line.slice(1) : line);
    }
  }

  if (result) console.log(`\n${result}`);
}
