import { brockTeam } from '../teams/fireRed/brock.js';
import { mistyTeam } from '../teams/fireRed/misty.js';
import type { LeaderConfig, LeaderEntry } from './types.js';

// Every Pokemon legitimately obtainable in FireRed/LeafGreen before beating
// Brock (starters + wild encounters on Route 1/2/22 and Viridian Forest —
// see scripts/pokemon-before-brock.ts), grouped into mutually-exclusive
// "lines" the player can build an evolution stage and moveset from.
const BROCK_BASE_SPECIES = [
  'bulbasaur',
  'charmander',
  'squirtle',
  'caterpie',
  'weedle',
  'pidgey',
  'rattata',
  'spearow',
  'mankey',
  'pikachu',
] as const;

// Same idea, extended through Route 3, Mt. Moon, Route 4, and Route 24/25 -
// everything legitimately obtainable before beating Misty (see
// scripts/pokemon-before-misty.ts). Base (lowest-stage) species only: e.g.
// Kakuna/Metapod aren't listed because weedle/caterpie's own level-up chain
// already reaches them under a 19 cap. Species ids are dex-normalized
// (`nidoranf`, not PokeAPI's `nidoran-f`) - evoChainStageIds echoes whatever
// id it's given as stage 0, so this list has to match @pkmn/sim's ids
// directly rather than the script's PokeAPI-slug output.
const MISTY_BASE_SPECIES = [
  'bulbasaur',
  'charmander',
  'squirtle',
  'caterpie',
  'weedle',
  'pidgey',
  'rattata',
  'spearow',
  'ekans',
  'pikachu',
  'sandshrew',
  'nidoranf',
  'nidoranm',
  'clefairy',
  'jigglypuff',
  'zubat',
  'oddish',
  'paras',
  'mankey',
  'abra',
  'bellsprout',
  'geodude',
] as const;

export const DEFAULT_LEADER_ID = 'brock';

// All eight FRLG gym leaders, in gym order. Brock and Misty are playable -
// every other slot is a bare placeholder with no label/team/art, so nothing
// about an unshipped leader can leak into the UI.
const LEADERS: readonly LeaderEntry[] = [
  {
    id: 'brock',
    available: true,
    label: 'Brock',
    rules: { teamSize: 2, levelCap: 13, baseSpecies: BROCK_BASE_SPECIES, allowItems: false, evolutionItems: [] },
    team: brockTeam,
    aceIndex: 1, // Onix - the last (and biggest) mon, shown big on the intro
    primaryType: 'Rock',
  },
  {
    id: 'misty',
    available: true,
    label: 'Misty',
    rules: {
      teamSize: 3,
      levelCap: 19,
      baseSpecies: MISTY_BASE_SPECIES,
      allowItems: false,
      // The Moon Stone found in Mt. Moon, before the Cerulean Gym - see
      // evoChainStageIds (roster.ts). Unlocks Nidoqueen/Nidoking/Clefable/
      // Wigglytuff from their pre-evolutions already in MISTY_BASE_SPECIES.
      evolutionItems: ['Moon Stone'],
    },
    team: mistyTeam,
    aceIndex: 2, // Starmie - last in battle order (starts on the bench), but the signature mon shown big on the intro
    primaryType: 'Water',
  },
  { id: 'lt-surge', available: false },
  { id: 'erika', available: false },
  { id: 'koga', available: false },
  { id: 'sabrina', available: false },
  { id: 'blaine', available: false },
  { id: 'giovanni', available: false },
];

const byId = new Map<string, LeaderEntry>(LEADERS.map((leader) => [leader.id, leader]));

export function listLeaders(): readonly LeaderEntry[] {
  return LEADERS;
}

/**
 * Resolves a leader id to its full config. Throws on an unknown id or one
 * that isn't playable yet - every call site today passes a known, available
 * id (`DEFAULT_LEADER_ID`), so this is a bug guard, not user-input handling.
 * A caller that needs to accept arbitrary (possibly unavailable) leader ids
 * from a request - the API layer, from M4 on - checks `listLeaders()`
 * itself and 400s before ever reaching here.
 */
export function getLeader(id: string): LeaderConfig {
  const entry = byId.get(id);
  if (!entry || !entry.available) {
    throw new Error(`Leader "${id}" is not available.`);
  }
  return entry;
}
