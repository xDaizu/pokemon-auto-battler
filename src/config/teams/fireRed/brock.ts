import type { TeamConfig } from '../types.js';

// Brock's fixed team. No EVs/nature were specified, so they're left out of the
// export text and default to 0 EVs / neutral nature via the importer — this is
// an intentional simplification, not a claim about in-game Brock's real stats.
export const rivalTeam: TeamConfig = {
  label: 'Brock',
  exportText: `
Geodude (M)
Ability: Rock Head
Level: 12
- Tackle
- Defense Curl

Onix (M)
Ability: Rock Head
Level: 14
- Tackle
- Rock Tomb
- Bind
- Harden
`,
};
