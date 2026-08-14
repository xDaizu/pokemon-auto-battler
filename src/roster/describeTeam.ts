import { Dex, Teams } from '@pkmn/sim';
import type { TeamConfig } from '../config/teams/types.js';
import type { TeamSummary } from '../../shared/apiTypes.js';
import { FORMAT_ID } from './roster.js';

const dex = Dex.forFormat(FORMAT_ID);

/** Parses a team's Showdown export text back into display-friendly data
 * (species name/number/types, for sprites) without duplicating what's
 * already in the export text. */
export function describeTeam(team: TeamConfig): TeamSummary {
  const sets = Teams.import(team.exportText);
  if (!sets) throw new Error(`Failed to parse team "${team.label}" export text`);

  return {
    label: team.label,
    pokemon: sets.map((set) => {
      const species = dex.species.get(set.species);
      return {
        species: species.id,
        name: species.name,
        num: species.num,
        level: set.level,
        types: [...species.types],
        ability: dex.abilities.get(set.ability ?? '').name,
        nature: set.nature ? dex.natures.get(set.nature).name : undefined,
        item: set.item ? dex.items.get(set.item).name : undefined,
        baseStats: { ...species.baseStats },
      };
    }),
  };
}
