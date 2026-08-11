import type { TeamConfig } from './types.js';

// PLACEHOLDER — illustrative moveset only, not researched against real
// in-game learnsets. Swap this file out for a real player team later; the
// rest of the codebase only depends on the TeamConfig shape.
export const playerTeam: TeamConfig = {
  label: 'Player',
  exportText: `
Pikachu (M)
Ability: Static
Level: 13
- Thunder Shock
- Quick Attack
- Growl
- Tail Whip

Butterfree (M)
Ability: Compound Eyes
Level: 13
- Air Slash
- Confusion
- Stun Spore
- Tackle
`,
};
