import type { TeamConfig } from '../types.js';

// Lt. Surge's fixed team. No EVs/nature were specified, so - same
// simplification as brock.ts - they're left out of the export text and
// default to 0 EVs / neutral nature via the importer, not a claim about
// in-game Surge's real stats. Voltorb and Magnemite are genderless (no
// gender line, same as the dex); Raichu is (M).
export const ltSurgeTeam: TeamConfig = {
  label: 'Lt. Surge',
  exportText: `
Voltorb
Ability: Soundproof
Level: 25
- Thunderbolt
- Swift
- Light Screen

Magnemite
Ability: Magnet Pull
Level: 25
- Thunderbolt
- Sonic Boom

Raichu (M)
Ability: Static
Level: 26
- Thunderbolt
- Quick Attack
- Double Kick
`,
};
