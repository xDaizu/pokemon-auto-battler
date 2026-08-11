import express from 'express';
import { getMoveDetail, getRoster, LEVEL_CAP } from '../roster/roster.js';
import { buildPlayerTeamConfig, parseImportedTeam, TeamSelectionError } from '../roster/buildTeam.js';
import { describeTeam } from '../roster/describeTeam.js';
import { runBattle } from '../battle/runBattle.js';
import { rivalTeam } from '../config/teams/fireRed/brock.js';
import type {
  BattleApiResponse,
  ImportTeamResponse,
  MoveDetail,
  PlayerPokemonSelection,
  RosterResponse,
  TeamSummary,
} from '../../shared/apiTypes.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json());

app.get('/api/roster', (_req, res) => {
  const response: RosterResponse = { levelCap: LEVEL_CAP, roster: getRoster() };
  res.json(response);
});

app.get('/api/rival', (_req, res) => {
  const response: TeamSummary = describeTeam(rivalTeam);
  res.json(response);
});

app.get('/api/moves/:name', (req, res) => {
  const detail: MoveDetail | undefined = getMoveDetail(req.params.name);
  if (!detail) {
    res.status(404).json({ error: `Unknown move "${req.params.name}".` });
    return;
  }
  res.json(detail);
});

app.post('/api/import-team', (req, res) => {
  const exportText = req.body?.exportText as string | undefined;
  if (typeof exportText !== 'string' || !exportText.trim()) {
    res.status(400).json({ error: 'Body must include an "exportText" string.' });
    return;
  }

  try {
    const selections = parseImportedTeam(exportText);
    const response: ImportTeamResponse = { selections };
    res.json(response);
  } catch (err) {
    if (err instanceof TeamSelectionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

app.post('/api/battle', async (req, res) => {
  const pokemon = req.body?.pokemon as PlayerPokemonSelection[] | undefined;
  if (!Array.isArray(pokemon)) {
    res.status(400).json({ error: 'Body must include a "pokemon" array.' });
    return;
  }

  let team;
  try {
    team = buildPlayerTeamConfig(pokemon);
  } catch (err) {
    if (err instanceof TeamSelectionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  try {
    const result = await runBattle(team, rivalTeam);
    const outcome: BattleApiResponse['outcome'] = result.tie
      ? 'tie'
      : result.winner === team.label
        ? 'player'
        : 'rival';
    const response: BattleApiResponse = {
      ...result,
      outcome,
      player: describeTeam(team),
      rival: describeTeam(rivalTeam),
    };
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Battle failed to run.' });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
