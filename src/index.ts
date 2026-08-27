import { playerTeam } from './config/teams/player.js';
import { DEFAULT_LEADER_ID, getLeader } from './config/leaders/index.js';
import { runBattle } from './battle/runBattle.js';
import { printBattleResult } from './battle/log.js';

// `npx tsx src/index.ts [leaderId]` - defaults to Brock.
const leader = getLeader(process.argv[2] ?? DEFAULT_LEADER_ID);

printBattleResult(await runBattle(playerTeam, leader.team));
