import { playerTeam } from './config/teams/player.js';
import { rivalTeam } from './config/teams/rival.js';
import { runBattle } from './battle/runBattle.js';
import { printBattleResult } from './battle/log.js';

printBattleResult(await runBattle(playerTeam, rivalTeam));
