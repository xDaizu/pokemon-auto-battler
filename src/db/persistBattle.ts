import { Dex, Teams } from '@pkmn/sim';
import { db } from './pool.js';
import { FORMAT_ID } from '../roster/roster.js';
import type { BattleOutcome, PlayerPokemonSelection, TeamSummary } from '../../shared/apiTypes.js';
import type { TeamConfig } from '../config/teams/types.js';
import type { FaintResult } from '../battle/faints.js';
import type { MoveDecisionSnapshot } from '../ai/decisionSnapshot.js';

const dex = Dex.forFormat(FORMAT_ID);

/**
 * Both sides' movesets end up in one column, but they arrive in different
 * formats: player selections carry dex ids ("growl") while a rival's export
 * text carries display names ("Defense Curl"). Storing them as-is would split
 * every future GROUP BY on a move or ability in half, so normalise to ids.
 */
function toMoveIds(moves: readonly string[] | undefined): string {
  return JSON.stringify((moves ?? []).map((move) => dex.moves.get(move).id));
}

function toAbilityId(ability: string | undefined): string | null {
  if (!ability) return null;
  return dex.abilities.get(ability).id;
}

export interface PersistBattleParams {
  userId: number;
  /** The request's selections, already validated by `buildPlayerTeamConfig`. */
  playerSelections: PlayerPokemonSelection[];
  playerSummary: TeamSummary;
  rivalTeam: TeamConfig;
  rivalSummary: TeamSummary;
  outcome: BattleOutcome;
  faints: FaintResult;
  /** Every move decision either AI made this battle (`runBattle`'s
   * server-internal `RunBattleResult.decisions`) - written to
   * `battle_decisions` so a move-suggestion report can later be traced back
   * to exactly what the AI knew when it chose, not just the log line. */
  decisions: MoveDecisionSnapshot[];
}

/**
 * Writes one finished battle: the `battles` header, a `battle_pokemon` row
 * per Pokemon per side, and a `battle_decisions` row per move decision either
 * AI made, in a single transaction so a stats query never sees a battle with
 * half its team. Returns the new `battles.id` so the caller can hand it back
 * to the client - move-suggestion reports (§ move_suggestions migration)
 * need it to attribute feedback to the battle it's about.
 *
 * The two sides read their movesets from different places because the export
 * text is the only thing that survives the whole pipeline: the player's come
 * from the original request (`TeamSummary` deliberately carries only display
 * data), the rival's from re-importing its config.
 */
export async function persistBattle(params: PersistBattleParams): Promise<number> {
  const { userId, playerSelections, playerSummary, rivalTeam, rivalSummary, outcome, faints, decisions } = params;

  const rivalSets = Teams.import(rivalTeam.exportText) ?? [];
  // Precomputed at write time so "tier list of teams" is a plain GROUP BY
  // rather than a per-query reconstruction from battle_pokemon.
  const teamKey = playerSummary.pokemon
    .map((mon) => mon.species)
    .sort()
    .join('+');

  const tx = await db.transaction('write');
  try {
    const battleResult = await tx.execute({
      sql: `INSERT INTO battles (user_id, player_label, rival_label, outcome, player_team_key)
            VALUES (?, ?, ?, ?, ?) RETURNING id`,
      args: [userId, playerSummary.label, rivalSummary.label, outcome, teamKey],
    });
    const battleId = Number(battleResult.rows[0]!.id);

    for (let i = 0; i < playerSummary.pokemon.length; i++) {
      const mon = playerSummary.pokemon[i]!;
      // Index-aligned: buildPlayerTeamConfig emits export text in selection
      // order and describeTeam maps Teams.import output in that same order.
      const selection = playerSelections[i];
      await tx.execute({
        sql: `INSERT INTO battle_pokemon
                (battle_id, user_id, side, slot, species, display_name, level, ability, nature, moves, fainted)
              VALUES (?, ?, 'player', ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          battleId,
          userId,
          i,
          mon.species,
          mon.name,
          mon.level,
          toAbilityId(selection?.ability),
          selection?.nature ? dex.natures.get(selection.nature).id : null,
          toMoveIds(selection?.moves),
          faints.p1.has(mon.name) ? 1 : 0,
        ],
      });
    }

    for (let i = 0; i < rivalSummary.pokemon.length; i++) {
      const mon = rivalSummary.pokemon[i]!;
      const set = rivalSets[i];
      await tx.execute({
        sql: `INSERT INTO battle_pokemon
                (battle_id, user_id, side, slot, species, display_name, level, ability, nature, moves, fainted)
              VALUES (?, NULL, 'rival', ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          battleId,
          i,
          mon.species,
          mon.name,
          mon.level,
          toAbilityId(set?.ability),
          set?.nature ? dex.natures.get(set.nature).id : null,
          toMoveIds(set?.moves),
          faints.p2.has(mon.name) ? 1 : 0,
        ],
      });
    }

    for (const decision of decisions) {
      await tx.execute({
        sql: `INSERT INTO battle_decisions (battle_id, turn, side, slot, weather, own, foe, legal_moves, chosen_choice)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          battleId,
          decision.turn,
          decision.side,
          decision.slot,
          decision.weather ?? null,
          JSON.stringify(decision.own),
          JSON.stringify(decision.foe),
          JSON.stringify(decision.legalMoves),
          decision.chosenChoice,
        ],
      });
    }

    await tx.commit();
    return battleId;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
