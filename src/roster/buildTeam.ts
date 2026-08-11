import { Dex, Teams } from '@pkmn/sim';
import type { TeamConfig } from '../config/teams/types.js';
import type { PlayerPokemonSelection } from '../../shared/apiTypes.js';
import { FORMAT_ID, LEVEL_CAP, findStage, getNatures } from './roster.js';

const dex = Dex.forFormat(FORMAT_ID);

const TEAM_SIZE = 2;
const MIN_MOVES = 1;
const MAX_MOVES = 4;

export class TeamSelectionError extends Error {}

function validatePokemon(selection: PlayerPokemonSelection, index: number) {
  const found = findStage(selection.stageId);
  if (!found) throw new TeamSelectionError(`Pokemon ${index + 1}: "${selection.stageId}" is not a legal choice.`);

  if (!found.stage.abilities.some((a) => a.id === selection.ability)) {
    throw new TeamSelectionError(
      `Pokemon ${index + 1}: "${selection.ability}" is not a legal ability for ${found.stage.name}.`
    );
  }
  if (!getNatures().some((n) => n.id === selection.nature)) {
    throw new TeamSelectionError(`Pokemon ${index + 1}: "${selection.nature}" is not a legal nature.`);
  }

  const moves = selection.moves;
  if (!Array.isArray(moves) || moves.length < MIN_MOVES || moves.length > MAX_MOVES) {
    throw new TeamSelectionError(`Pokemon ${index + 1}: choose between ${MIN_MOVES} and ${MAX_MOVES} moves.`);
  }
  if (new Set(moves).size !== moves.length) {
    throw new TeamSelectionError(`Pokemon ${index + 1}: duplicate move selected.`);
  }

  const legalMoveIds = new Set(found.stage.moves.map((m) => m.id));
  for (const moveId of moves) {
    if (!legalMoveIds.has(moveId)) {
      throw new TeamSelectionError(
        `Pokemon ${index + 1}: "${moveId}" is not legal for ${found.stage.name} at level ${LEVEL_CAP}.`
      );
    }
  }

  return found;
}

/** Validates a player's two-Pokemon selection against the level-13,
 * no-items, evolution-stage-legal roster rules and builds the Showdown
 * export text `runBattle` expects. Throws `TeamSelectionError` with a
 * user-facing message on any violation. */
export function buildPlayerTeamConfig(selections: PlayerPokemonSelection[]): TeamConfig {
  if (selections.length !== TEAM_SIZE) {
    throw new TeamSelectionError(`Choose exactly ${TEAM_SIZE} Pokemon.`);
  }

  const resolved = selections.map(validatePokemon);

  const exclusiveGroupsUsed = new Set<string>();
  for (const { line } of resolved) {
    if (!line.exclusiveGroup) continue;
    if (exclusiveGroupsUsed.has(line.exclusiveGroup)) {
      throw new TeamSelectionError('Only one starter (Bulbasaur/Charmander/Squirtle) can be on your team.');
    }
    exclusiveGroupsUsed.add(line.exclusiveGroup);
  }

  const stageIdsUsed = new Set<string>();
  for (const { stage } of resolved) {
    if (stageIdsUsed.has(stage.id)) {
      throw new TeamSelectionError('Your team cannot contain the same Pokemon twice.');
    }
    stageIdsUsed.add(stage.id);
  }

  const exportText = resolved
    .map(({ stage }, i) => {
      const selection = selections[i]!;
      const ability = dex.abilities.get(selection.ability).name;
      const nature = dex.natures.get(selection.nature).name;
      const moveLines = selection.moves
        .map((moveId) => `- ${dex.moves.get(moveId).name}`)
        .join('\n');
      return `${stage.name}\nAbility: ${ability}\nLevel: ${LEVEL_CAP}\n${nature} Nature\n${moveLines}`;
    })
    .join('\n\n');

  return { label: 'Red', exportText };
}

/** Parses pasted Showdown export text into a `PlayerPokemonSelection[]`,
 * rejecting anything `buildPlayerTeamConfig` wouldn't accept (items, wrong
 * level, species/moves not legal at the level cap, duplicate starters,
 * wrong team size). Reuses that validation rather than duplicating it, so
 * the two entry points can never drift apart on what counts as legal. */
export function parseImportedTeam(exportText: string): PlayerPokemonSelection[] {
  let sets;
  try {
    sets = Teams.import(exportText);
  } catch {
    sets = null;
  }
  if (!sets || sets.length === 0) {
    throw new TeamSelectionError('Could not parse that as a Showdown export.');
  }

  const selections = sets.map((set, index): PlayerPokemonSelection => {
    if (set.item) {
      throw new TeamSelectionError(`Pokemon ${index + 1}: items aren't allowed.`);
    }
    if (set.level !== LEVEL_CAP) {
      throw new TeamSelectionError(`Pokemon ${index + 1}: must be Level ${LEVEL_CAP}.`);
    }
    return {
      stageId: dex.species.get(set.species).id,
      ability: dex.abilities.get(set.ability ?? '').id,
      nature: dex.natures.get(set.nature ?? '').id,
      moves: (set.moves ?? []).map((name) => dex.moves.get(name).id),
    };
  });

  buildPlayerTeamConfig(selections);
  return selections;
}
