import type { TeamConfig } from '../types.js';

// Lt. Surge's fixed team. No EVs/nature were specified, so - same
// simplification as brock.ts - they're left out of the export text and
// default to 0 EVs / neutral nature via the importer, not a claim about
// in-game Surge's real stats. Voltorb is genderless (no gender line, same as
// the dex); Pikachu and Raichu are both (M).
export const ltSurgeTeam: TeamConfig = {
  label: 'Lt. Surge',
  exportText: `
Voltorb
Ability: Soundproof
Level: 21
- Shock Wave
- Tackle
- Screech
- Sonic Boom

Pikachu (M)
Ability: Static
Level: 18
- Shock Wave
- Thunder Wave
- Quick Attack
- Double Team

Raichu (M)
Ability: Static
Level: 24
- Shock Wave
- Thunder Wave
- Quick Attack
- Double Team
`,
};
