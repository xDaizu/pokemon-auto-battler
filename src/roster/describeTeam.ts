import { Dex, Teams } from '@pkmn/sim';
import type { TeamConfig } from '../config/teams/types.js';
import { FORMAT_ID } from './roster.js';

const dex = Dex.forFormat(FORMAT_ID);

export interface TeamMemberSummary {
  species: string;
  name: string;
  num: number;
  level: number;
  types: string[];
}

export interface TeamSummary {
  label: string;
  pokemon: TeamMemberSummary[];
}

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
      };
    }),
  };
}
