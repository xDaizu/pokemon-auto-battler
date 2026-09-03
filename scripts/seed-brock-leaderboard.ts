// Seeds the Brock leaderboard with a handful of NPC trainers so it's never
// empty, even right after release. Not wired into the runtime (like the
// other scripts/ one-offs) - run by hand, locally against `local.db` or
// against production via `migrate-prod.ps1 -Command 'npx tsx
// scripts/seed-brock-leaderboard.ts'` (see docs/RELEASING.md §3).
//
// Each trainer is an 'npc' account (src/db/migrations/0006_npc_accounts.sql)
// with a fixed two-Pokemon team, run through the exact same pipeline a real
// battle takes (buildPlayerTeamConfig -> runBattle -> persistBattle) so the
// rows are indistinguishable from a real game from the leaderboard query's
// point of view. Every trainer is battled twice, with a different nature
// spread each time, per the fixtures brief - ties are fine, nothing here
// forces a particular outcome.
//
// Species/levels/movesets are lightly adapted from real FireRed/LeafGreen
// pre-Brock trainer data (Cazabichos Jano, Azul's lead pair, a Youngster and
// a Bird Keeper) rather than invented: the source listed each Pokemon's
// actual in-game level and moveset, but Brock's roster only ever fields
// Pokemon at his own level cap (buildPlayerTeamConfig always stamps
// `Level: <levelCap>`, same as a player-built team) - so the original level
// is discarded and only the *species* carries over. Moves are recomputed the
// same way: keep whatever was named in the source (translated out of
// Spanish) if it's still legal at the cap, then fill any empty move slots
// with whatever else that line naturally learns leveling up to the cap,
// from `getRoster('brock')` - the same legal-movepool data the team builder
// itself is driven by. Squirtle's source moveset named "Burbuja" (Bubble),
// which isn't a level-up move in the gen this app reads Squirtle's learnset
// from (gen 9 - Bubble was retired after gen 7); Water Gun, its closest
// same-slot equivalent (also a weak Water-type damaging move, similarly
// early in the line), stands in for it.
import 'dotenv/config';
import { getLeader } from '../src/config/leaders/index.js';
import { buildPlayerTeamConfig } from '../src/roster/buildTeam.js';
import { describeTeam } from '../src/roster/describeTeam.js';
import { runBattle } from '../src/battle/runBattle.js';
import { detectFaints } from '../src/battle/faints.js';
import { computeHpRemaining } from '../src/battle/hpRemaining.js';
import { persistBattle } from '../src/db/persistBattle.js';
import { createUser, findUserByUsername } from '../src/auth/users.js';
import type { PlayerPokemonSelection, BattleApiResponse } from '../shared/apiTypes.js';

const LEADER_ID = 'brock';

interface FixturePokemon {
  stageId: string;
  ability: string;
  moves: string[];
}

interface FixtureTrainer {
  username: string;
  displayName: string;
  /** Login-combo filler only - NPCs never sign in through the UI. */
  loginCombo: [string, string, string];
  pokemon: [FixturePokemon, FixturePokemon];
  /** One nature pair per simulated battle - run at least twice, each with a
   * different spread, per the fixtures brief. */
  natureRuns: [string, string][];
}

// See the header comment for how species/abilities/moves were derived.
const TRAINERS: FixtureTrainer[] = [
  {
    username: 'npc_cazabichos_jano',
    displayName: 'Cazabichos Jano',
    loginCombo: ['weedle', 'caterpie', 'onix'],
    pokemon: [
      { stageId: 'weedle', ability: 'shielddust', moves: ['poisonsting', 'stringshot', 'bugbite'] },
      { stageId: 'caterpie', ability: 'shielddust', moves: ['tackle', 'stringshot', 'bugbite'] },
    ],
    natureRuns: [
      ['serious', 'serious'],
      ['jolly', 'jolly'],
    ],
  },
  {
    username: 'npc_azul',
    displayName: 'Azul',
    loginCombo: ['pidgey', 'squirtle', 'onix'],
    pokemon: [
      { stageId: 'pidgey', ability: 'keeneye', moves: ['tackle', 'sandattack', 'gust'] },
      { stageId: 'squirtle', ability: 'torrent', moves: ['tackle', 'tailwhip', 'watergun', 'withdraw'] },
    ],
    natureRuns: [
      ['serious', 'serious'],
      ['jolly', 'modest'],
    ],
  },
  {
    username: 'npc_joven_kai',
    displayName: 'Joven Kai',
    loginCombo: ['pidgey', 'rattata', 'onix'],
    pokemon: [
      { stageId: 'pidgey', ability: 'keeneye', moves: ['tackle', 'sandattack', 'gust'] },
      { stageId: 'rattata', ability: 'runaway', moves: ['tailwhip', 'quickattack', 'focusenergy', 'bite'] },
    ],
    natureRuns: [
      ['serious', 'serious'],
      ['timid', 'adamant'],
    ],
  },
  {
    username: 'npc_ave_mel',
    displayName: 'Ave Mel',
    loginCombo: ['spearow', 'pidgey', 'onix'],
    pokemon: [
      { stageId: 'spearow', ability: 'keeneye', moves: ['peck', 'leer', 'pursuit', 'furyattack'] },
      { stageId: 'pidgey', ability: 'keeneye', moves: ['tackle', 'sandattack', 'gust'] },
    ],
    natureRuns: [
      ['serious', 'serious'],
      ['jolly', 'timid'],
    ],
  },
];

async function ensureNpcUser(trainer: FixtureTrainer): Promise<number> {
  const existing = await findUserByUsername(trainer.username);
  if (existing) {
    if (existing.accountType !== 'npc') {
      throw new Error(`"${trainer.username}" already exists and is not an NPC account - refusing to reuse it.`);
    }
    return existing.id;
  }
  const created = await createUser(trainer.username, trainer.displayName, trainer.loginCombo, 'npc');
  return created.id;
}

async function runOneBattle(trainer: FixtureTrainer, userId: number, natures: [string, string]): Promise<void> {
  const leader = getLeader(LEADER_ID);
  const selections: PlayerPokemonSelection[] = trainer.pokemon.map((mon, i) => ({
    stageId: mon.stageId,
    ability: mon.ability,
    nature: natures[i]!,
    moves: mon.moves,
  }));

  const team = buildPlayerTeamConfig(LEADER_ID, selections);
  const { decisions, ...result } = await runBattle(team, leader.team);
  const outcome: BattleApiResponse['outcome'] = result.tie ? 'tie' : result.winner === team.label ? 'player' : 'rival';

  const playerSummary = describeTeam(team);
  const rivalSummary = describeTeam(leader.team);
  const { p1Pct: playerHpPct, p2Pct: rivalHpPct } = computeHpRemaining(result.turns);

  const battleId = await persistBattle({
    userId,
    leaderId: LEADER_ID,
    playerSelections: selections,
    playerSummary,
    rivalTeam: leader.team,
    rivalSummary,
    outcome,
    faints: detectFaints(result.turns),
    turns: result.turns[result.turns.length - 1]!.turn,
    playerHpPct,
    rivalHpPct,
    decisions,
  });

  console.log(
    `  battle ${battleId}: ${natures.join('/')} -> ${outcome} in ${result.turns[result.turns.length - 1]!.turn} turns` +
      ` (you ${playerHpPct.toFixed(0)}% / rival ${rivalHpPct.toFixed(0)}%)`
  );
}

async function main(): Promise<void> {
  for (const trainer of TRAINERS) {
    console.log(`${trainer.displayName} (${trainer.username})`);
    const userId = await ensureNpcUser(trainer);
    for (const natures of trainer.natureRuns) {
      await runOneBattle(trainer, userId, natures);
    }
  }
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
