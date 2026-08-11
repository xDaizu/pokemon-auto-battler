import { BattleStreams, Teams } from '@pkmn/sim';
import type { TeamConfig } from '../config/teams/types.js';
import { HeuristicPlayerAI } from '../ai/HeuristicPlayerAI.js';
import { printOmniscientLog } from './log.js';

const FORMAT_ID = 'gen9doublescustomgame';

function importTeamOrThrow(team: TeamConfig) {
  const sets = Teams.import(team.exportText);
  if (!sets) throw new Error(`Failed to parse team "${team.label}" export text`);
  return sets;
}

export async function runBattle(playerTeam: TeamConfig, rivalTeam: TeamConfig): Promise<void> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());

  const playerSets = importTeamOrThrow(playerTeam);
  const rivalSets = importTeamOrThrow(rivalTeam);

  const spec = { formatid: FORMAT_ID };
  const p1spec = { name: playerTeam.label, team: Teams.pack(playerSets) };
  const p2spec = { name: rivalTeam.label, team: Teams.pack(rivalSets) };

  const p1 = new HeuristicPlayerAI(streams.p1, playerSets, FORMAT_ID);
  const p2 = new HeuristicPlayerAI(streams.p2, rivalSets, FORMAT_ID);
  void p1.start();
  void p2.start();

  const logPromise = printOmniscientLog(streams.omniscient);

  await streams.omniscient.write(
    `>start ${JSON.stringify(spec)}\n` +
      `>player p1 ${JSON.stringify(p1spec)}\n` +
      `>player p2 ${JSON.stringify(p2spec)}`
  );

  await logPromise;
}
