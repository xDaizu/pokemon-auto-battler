import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { getMoveDetail, getNatures, getRoster, LEVEL_CAP } from '../roster/roster.js';
import { getSpeciesList } from '../roster/nationalDex.js';
import { buildPlayerTeamConfig, parseImportedTeam, TeamSelectionError } from '../roster/buildTeam.js';
import { describeTeam } from '../roster/describeTeam.js';
import { runBattle } from '../battle/runBattle.js';
import { detectFaints } from '../battle/faints.js';
import { collectMoveTargets } from '../battle/moveTargets.js';
import { rivalTeam } from '../config/teams/fireRed/brock.js';
import { LibsqlSessionStore } from '../auth/LibsqlSessionStore.js';
import { requireAuth } from '../auth/middleware.js';
import { createUser, findUserById, findUserByUsername, updateDisplayName } from '../auth/users.js';
import { persistBattle } from '../db/persistBattle.js';
import { persistMoveSuggestion } from '../db/persistMoveSuggestion.js';
import { db } from '../db/pool.js';
import type {
  AuthResponse,
  BattleApiResponse,
  ImportTeamResponse,
  MoveDetail,
  MoveSuggestionRequest,
  MoveSuggestionResponse,
  PlayerPokemonSelection,
  RosterResponse,
  SessionResponse,
  SpeciesListResponse,
  TeamSummary,
} from '../../shared/apiTypes.js';

const PORT = Number(process.env.PORT ?? 3001);

/** Empty in dev, `/battler` in production: the Firebase Hosting rewrite forwards
 * the *full* original path to Cloud Run rather than stripping the matched
 * prefix, so the API has to answer on `/battler/api/*` there. Every route lives
 * on the `api` router below precisely so this is one mount point, not 11 edits.
 * Kept an env var rather than a hardcoded literal so a wrong guess about that
 * forwarding behaviour is a redeploy, not a code change (DEPLOYMENT.md §8). */
const BASE_PATH = process.env.BASE_PATH ?? '';

/** The dev fallback is published in this repo, so it must never sign a real
 * session cookie. Failing at boot beats a deploy that silently accepts forged
 * sessions. */
function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
  }
  return 'insecure-development-secret';
}

/** 400 days is the ceiling browsers enforce on cookie expiry. Paired with
 * `rolling: true` below, a trainer who plays even once a year never gets
 * logged out — only an explicit logout ends a session. */
const SESSION_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const app = express();
app.use(express.json());

// Lets Express see the original protocol behind a TLS-terminating proxy, so
// the `secure` cookie flag resolves correctly once deployed.
app.set('trust proxy', 1);

app.use(
  session({
    store: new LibsqlSessionStore(),
    name: 'pab.sid',
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true, // every authenticated request slides the expiry forward
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
);

// Every route hangs off this router, not off `app`, so `BASE_PATH` relocates
// the whole API at once. `express.json()`, `trust proxy` and `session(...)`
// stay global on `app` above: the session cookie keeps path `/` so it is sent
// to the static origin and the API alike.
const api = express.Router();

// --- Public routes. Everything below `api.use(requireAuth)` needs a session. ---

api.get('/api/species', (_req, res) => {
  const response: SpeciesListResponse = { species: getSpeciesList() };
  res.json(response);
});

/** Signup and login are the same act: an unclaimed username takes the combo it
 * was submitted with, a claimed one has to match what it already stored. */
api.post('/api/auth/login', async (req, res) => {
  const username = (req.body?.username as string | undefined)?.trim().toLowerCase();
  const displayName = (req.body?.displayName as string | undefined)?.trim();
  const submitted = req.body?.pokemon as unknown;

  if (!username || !displayName) {
    res.status(400).json({ error: 'Username and display name are required.' });
    return;
  }
  if (!Array.isArray(submitted) || submitted.length !== 3 || submitted.some((id) => typeof id !== 'string' || !id)) {
    res.status(400).json({ error: 'Pick all three Pokemon.' });
    return;
  }

  const pokemon = submitted as [string, string, string];
  const validIds = new Set(getSpeciesList().map((species) => species.id));
  if (pokemon.some((id) => !validIds.has(id))) {
    res.status(400).json({ error: 'One of the selected Pokemon is not valid.' });
    return;
  }

  const existing = await findUserByUsername(username);
  let userId: number;

  if (!existing) {
    userId = (await createUser(username, displayName, pokemon)).id;
  } else {
    // Order-sensitive: the combo is three ordered slots, never a set.
    const matches = existing.pokemon.every((id, i) => id === pokemon[i]);
    if (!matches) {
      res.status(401).json({ error: 'Wrong username or Pokemon combination.' });
      return;
    }
    // Resubmitted on every login, so treat the latest value as authoritative.
    if (existing.displayName !== displayName) await updateDisplayName(existing.id, displayName);
    userId = existing.id;
  }

  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: 'Could not start session.' });
      return;
    }
    req.session.userId = userId;
    const response: AuthResponse = { user: { id: userId, username, displayName, pokemon } };
    res.json(response);
  });
});

api.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pab.sid');
    res.status(204).end();
  });
});

// Must stay reachable while logged out — it's how the client discovers whether
// it still has a session.
api.get('/api/auth/me', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : undefined;
  const response: SessionResponse = {
    user: user ? { id: user.id, username: user.username, displayName: user.displayName, pokemon: user.pokemon } : null,
  };
  res.json(response);
});

api.use(requireAuth);

api.get('/api/roster', (_req, res) => {
  const response: RosterResponse = { levelCap: LEVEL_CAP, roster: getRoster(), natures: getNatures() };
  res.json(response);
});

api.get('/api/rival', (_req, res) => {
  const response: TeamSummary = describeTeam(rivalTeam);
  res.json(response);
});

api.get('/api/moves/:name', (req, res) => {
  const detail: MoveDetail | undefined = getMoveDetail(req.params.name);
  if (!detail) {
    res.status(404).json({ error: `Unknown move "${req.params.name}".` });
    return;
  }
  res.json(detail);
});

api.post('/api/import-team', (req, res) => {
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

api.post('/api/battle', async (req, res) => {
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
    const { decisions, ...result } = await runBattle(team, rivalTeam);
    const outcome: BattleApiResponse['outcome'] = result.tie
      ? 'tie'
      : result.winner === team.label
        ? 'player'
        : 'rival';
    // `decisions` (the AI's internal telemetry - see runBattle.ts) is
    // deliberately excluded here: it's for persistBattle below, not for the
    // client. Destructuring it off `result` above keeps it from being
    // silently spread into the JSON response.
    const response: BattleApiResponse = {
      ...result,
      outcome,
      player: describeTeam(team),
      rival: describeTeam(rivalTeam),
      moveTargets: collectMoveTargets(result.turns),
      battleId: null,
    };

    try {
      response.battleId = await persistBattle({
        userId: req.session.userId!, // guaranteed by requireAuth
        playerSelections: pokemon,
        playerSummary: response.player,
        rivalTeam,
        rivalSummary: response.rival,
        outcome,
        faints: detectFaints(result.turns),
        decisions,
      });
    } catch (err) {
      // Swallowed on purpose: the battle already ran and the player is waiting
      // on it. Losing a row from the stats corpus is not worth turning a
      // finished battle into an error screen. battleId stays null, which
      // tells the frontend to hide the move-suggestion report action - there
      // is no `battles` row for it to reference.
      console.error('Failed to persist battle:', err);
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Battle failed to run.' });
  }
});

api.post('/api/battles/:battleId/suggestions', async (req, res) => {
  const battleId = Number(req.params.battleId);
  if (!Number.isInteger(battleId)) {
    res.status(400).json({ error: 'Invalid battle id.' });
    return;
  }

  const body = req.body as Partial<MoveSuggestionRequest> | undefined;
  const { turn, lineIndex, rawLine, suggestion, reason } = body ?? {};
  if (
    typeof turn !== 'number' ||
    typeof lineIndex !== 'number' ||
    typeof rawLine !== 'string' ||
    !rawLine.trim() ||
    typeof suggestion !== 'string' ||
    !suggestion.trim() ||
    typeof reason !== 'string' ||
    !reason.trim()
  ) {
    res.status(400).json({ error: 'Body must include turn, lineIndex, rawLine, suggestion, and reason.' });
    return;
  }

  const userId = req.session.userId!; // guaranteed by requireAuth
  // Only the trainer who played this battle may report on it - also doubles
  // as existence check, so a bogus battleId 404s instead of writing an
  // orphaned suggestion row.
  const owns = await db.execute({ sql: 'SELECT id FROM battles WHERE id = ? AND user_id = ?', args: [battleId, userId] });
  if (owns.rows.length === 0) {
    res.status(404).json({ error: 'Battle not found.' });
    return;
  }

  const id = await persistMoveSuggestion({ battleId, userId, turn, lineIndex, rawLine, suggestion, reason });
  const response: MoveSuggestionResponse = { id };
  res.status(201).json(response);
});

// Mounted after every route is registered, so the public/`requireAuth`/gated
// ordering inside the router is what governs access. `|| '/'` because Express 5
// rejects an empty mount path.
app.use(BASE_PATH || '/', api);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
