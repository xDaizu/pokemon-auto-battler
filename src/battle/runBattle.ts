import { BattleStreams, Teams } from '@pkmn/sim';
import type { TeamConfig } from '../config/teams/types.js';
import { DoublesPlayerAI } from '../ai/DoublesPlayerAI.js';
import type { MoveDecisionSnapshot } from '../ai/decisionSnapshot.js';
import { FORMAT_ID } from '../roster/roster.js';
import { collectOmniscientLog, type BattleResult } from './log.js';

/** `BattleResult` plus every move decision either side's AI made along the
 * way. Kept separate from `BattleApiResponse`/`BattleResult` on purpose -
 * this is server-internal telemetry for `persistBattle` (see
 * `battle_decisions`), not something that should ever get spread into the
 * JSON the client receives. */
export interface RunBattleResult extends BattleResult {
  decisions: MoveDecisionSnapshot[];
}

function importTeamOrThrow(team: TeamConfig) {
  const sets = Teams.import(team.exportText);
  if (!sets) throw new Error(`Failed to parse team "${team.label}" export text`);
  return sets;
}

export async function runBattle(playerTeam: TeamConfig, rivalTeam: TeamConfig): Promise<RunBattleResult> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());

  const playerSets = importTeamOrThrow(playerTeam);
  const rivalSets = importTeamOrThrow(rivalTeam);

  const spec = { formatid: FORMAT_ID };
  const p1spec = { name: playerTeam.label, team: Teams.pack(playerSets) };
  const p2spec = { name: rivalTeam.label, team: Teams.pack(rivalSets) };

  const decisions: MoveDecisionSnapshot[] = [];
  const p1 = new DoublesPlayerAI(streams.p1, playerSets, FORMAT_ID, (d) => decisions.push(d));
  const p2 = new DoublesPlayerAI(streams.p2, rivalSets, FORMAT_ID, (d) => decisions.push(d));
  void p1.start();
  void p2.start();

  const logPromise = collectOmniscientLog(streams.omniscient);

  await streams.omniscient.write(
    `>start ${JSON.stringify(spec)}\n` +
      `>player p1 ${JSON.stringify(p1spec)}\n` +
      `>player p2 ${JSON.stringify(p2spec)}`
  );

  const result = await logPromise;
  return { ...result, decisions };
}
