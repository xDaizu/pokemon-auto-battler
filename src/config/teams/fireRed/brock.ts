import type { TeamConfig } from '../types.js';

// Brock's fixed team. No EVs/nature were specified, so they're left out of the
// export text and default to 0 EVs / neutral nature via the importer — this is
// an intentional simplification, not a claim about in-game Brock's real stats.
export const brockTeam: TeamConfig = {
  label: 'Brock',
  exportText: `
Geodude (M)
Ability: Sturdy
Level: 11
- Tackle

Onix (M)
Ability: Sturdy
Level: 12
- Headbutt
- Bind
- Rock Throw
`,
};
