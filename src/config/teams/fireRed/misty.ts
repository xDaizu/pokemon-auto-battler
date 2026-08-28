import type { TeamConfig } from '../types.js';

// Misty's fixed team. No EVs/nature were specified, so - same
// simplification as brock.ts - they're left out of the export text and
// default to 0 EVs / neutral nature via the importer, not a claim about
// in-game Misty's real stats. Psyduck is (M); Starmie is genderless (no
// gender line, same as the dex). Starmie is the ace (aceIndex 1 in
// leaders/index.ts) but sits last in battle order, so it starts on the
// bench.
export const mistyTeam: TeamConfig = {
  label: 'Misty',
  exportText: `
Psyduck (M)
Ability: Cloud Nine
Level: 18
- Confusion
- Water Gun

Starmie
Ability: Analytic
Level: 19
- Scald
- Swift
- Psywave
`,
};
