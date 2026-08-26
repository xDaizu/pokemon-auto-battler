import type { TeamConfig } from '../types.js';

// Misty's fixed team - see "Misty's team (data)" in the leaders plan for the
// research behind each set. Unlike brock.ts, every set carries a Nature line
// (TeamMemberSummary.nature stays optional to cover Brock's export text,
// which has none). Starmie is the ace (aceIndex 2 in leaders/index.ts) but
// sits last in battle order, so it starts on the bench.
export const mistyTeam: TeamConfig = {
  label: 'Misty',
  exportText: `
Staryu
Ability: Analytic
Level: 19
Quiet Nature
- Aqua Jet
- Flip Turn
- Water Gun
- Reflect

Horsea
Ability: Sniper
Level: 19
Timid Nature
- Water Gun
- Smokescreen
- Twister
- Focus Energy

Starmie
Ability: Natural Cure
Level: 21
Timid Nature
- Bubble Beam
- Swift
- Aqua Jet
- Flip Turn
`,
};
