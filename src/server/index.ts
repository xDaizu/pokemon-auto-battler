import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { getMoveDetail, getNatures, getRoster } from '../roster/roster.js';
import { getSpeciesList } from '../roster/nationalDex.js';
import { buildPlayerTeamConfig, parseImportedTeam, TeamSelectionError } from '../roster/buildTeam.js';
import { describeTeam } from '../roster/describeTeam.js';
import { runBattle } from '../battle/runBattle.js';
import { detectFaints } from '../battle/faints.js';
import { computeHpRemaining } from '../battle/hpRemaining.js';
import { collectMoveTargets } from '../battle/moveTargets.js';
import { DEFAULT_LEADER_ID, getLeader, listLeaders } from '../config/leaders/index.js';
import { LibsqlSessionStore } from '../auth/LibsqlSessionStore.js';
import { requireAuth } from '../auth/middleware.js';
import { createUser, findUserById, findUserByUsername } from '../auth/users.js';
import { persistBattle } from '../db/persistBattle.js';
import { persistMoveSuggestion } from '../db/persistMoveSuggestion.js';
import { persistFeedback } from '../db/persistFeedback.js';
import { db } from '../db/pool.js';
import type {
  ApiErrorResponse,
  AuthResponse,
  BattleApiResponse,
  FeedbackRequest,
  FeedbackResponse,
  ImportTeamResponse,
  LeaderSummary,
  LeadersResponse,
  MoveDetail,
  MoveSuggestionRequest,
  MoveSuggestionResponse,
  PlayerPokemonSelection,
  RivalResponse,
  RosterResponse,
  SessionResponse,
  SpeciesListResponse,
} from '../../shared/apiTypes.js';

const PORT = Number(process.env.PORT ?? 3001);

/** Empty in dev, `/battler` in production: the Firebase Hosting rewrite forwards
 * the *full* original path to Cloud Run rather than stripping the matched
 * prefix, so the API has to answer on `/battler/api/*` there. Every route lives
 * on the `api` router below precisely so this is one mount point, not 11 edits.
 * Kept an env var rather than a hardcoded literal so a wrong guess about that
 * forwarding behaviour is a redeploy, not a code change
 * (docs/ARCHITECTURE.md §7). */
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

/** See the note on `name` below: Firebase Hosting only forwards a cookie called
 * `__session` to Cloud Run, so this name is load-bearing, not cosmetic. */
const SESSION_COOKIE_NAME = '__session';

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
    // MUST be `__session`. Firebase Hosting strips every incoming cookie except
    // one with exactly this name before forwarding a rewrite to Cloud Run -- it
    // is what lets the CDN cache responses. Any other name breaks in a way that
    // looks like it works: the Set-Cookie on login passes through fine, the
    // browser stores it and sends it back, and Firebase drops it on the way in,
    // so every later request arrives with no session and 401s. Kept identical in
    // dev so the two environments cannot diverge (see docs/ARCHITECTURE.md §12).
    name: SESSION_COOKIE_NAME,
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

/** Shared by register and login: both need "exactly three valid dex ids",
 * they just disagree on what happens once that's confirmed. */
function validateCombo(raw: unknown): { pokemon: [string, string, string] } | ApiErrorResponse {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some((id) => typeof id !== 'string' || !id)) {
    return { error: 'Pick all three Pokemon.', code: 'incomplete_combo' };
  }
  const pokemon = raw as [string, string, string];
  const validIds = new Set(getSpeciesList().map((species) => species.id));
  if (pokemon.some((id) => !validIds.has(id))) {
    return { error: 'One of the selected Pokemon is not valid.', code: 'invalid_pokemon' };
  }
  return { pokemon };
}

/** Registration claims a brand-new username outright; an already-claimed one
 * is rejected rather than falling through to a login check, so picking
 * "register" never silently signs you into someone else's account. */
api.post('/api/auth/register', async (req, res) => {
  const username = (req.body?.username as string | undefined)?.trim().toLowerCase();
  const displayName = (req.body?.displayName as string | undefined)?.trim();

  if (!username || !displayName) {
    res.status(400).json({ error: 'Username and display name are required.', code: 'missing_fields' } satisfies ApiErrorResponse);
    return;
  }
  const combo = validateCombo(req.body?.pokemon);
  if ('error' in combo) {
    res.status(400).json(combo);
    return;
  }
  const { pokemon } = combo;

  if (await findUserByUsername(username)) {
    res.status(409).json({ error: 'That username is already taken.', code: 'username_taken' } satisfies ApiErrorResponse);
    return;
  }

  const userId = (await createUser(username, displayName, pokemon)).id;
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: 'Could not start session.', code: 'session_start_failed' } satisfies ApiErrorResponse);
      return;
    }
    req.session.userId = userId;
    const response: AuthResponse = { user: { id: userId, username, displayName, pokemon } };
    res.json(response);
  });
});

/** Login never creates anything: an unknown username and a wrong combo get
 * the exact same error, so a typo'd username can't be told apart from one
 * that was never registered — and, unlike the old combined endpoint, it can
 * no longer be mistaken for a fresh registration. */
api.post('/api/auth/login', async (req, res) => {
  const username = (req.body?.username as string | undefined)?.trim().toLowerCase();

  if (!username) {
    res.status(400).json({ error: 'Username is required.', code: 'missing_fields' } satisfies ApiErrorResponse);
    return;
  }
  const combo = validateCombo(req.body?.pokemon);
  if ('error' in combo) {
    res.status(400).json(combo);
    return;
  }
  const { pokemon } = combo;

  const existing = await findUserByUsername(username);
  // Order-sensitive: the combo is three ordered slots, never a set.
  const matches = existing?.pokemon.every((id, i) => id === pokemon[i]) ?? false;
  if (!existing || !matches) {
    res.status(401).json({ error: 'Wrong username or Pokemon combination.', code: 'invalid_credentials' } satisfies ApiErrorResponse);
    return;
  }

  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: 'Could not start session.', code: 'session_start_failed' } satisfies ApiErrorResponse);
      return;
    }
    req.session.userId = existing.id;
    const response: AuthResponse = { user: { id: existing.id, username, displayName: existing.displayName, pokemon } };
    res.json(response);
  });
});

api.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE_NAME);
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

/** All eight gym-leader slots, `available` driven purely by whether the
 * registry entry carries a full `LeaderConfig` - unavailable ones report
 * nothing beyond id/available, so an unshipped leader's identity can't leak
 * into the UI early. A `hidden` unreleased leader is folded into that same
 * unavailable shape even though it has a full config server-side; a
 * `teaser` one reports normally plus its `unreleased` marker. */
api.get('/api/leaders', (_req, res) => {
  const leaders: LeaderSummary[] = listLeaders().map((entry) =>
    entry.available && entry.unreleased !== 'hidden'
      ? {
          id: entry.id,
          available: true,
          label: entry.label,
          primaryType: entry.primaryType,
          teamSize: entry.rules.teamSize,
          levelCap: entry.rules.levelCap,
          ...(entry.unreleased === 'teaser' ? { unreleased: 'teaser' as const } : {}),
        }
      : { id: entry.id, available: false }
  );
  const response: LeadersResponse = { leaders };
  res.json(response);
});

/** Every leader-scoped endpoint below resolves its leader id through here,
 * so an unknown or not-yet-playable id (e.g. `?leader=misty` today) 400s
 * cleanly instead of half-running against a leader with no team. Defaults to
 * `DEFAULT_LEADER_ID` so the untouched pre-M4 frontend, which never sends a
 * leader id at all, keeps hitting Brock exactly as before.
 *
 * A `hidden` unreleased leader always 400s here, same as an unknown id. A
 * `teaser` one 400s too unless the caller opts in with `allowTeaser` - only
 * `GET /api/rival` does, since that's the read-only roster preview the intro
 * screen needs; drafting, importing, and battling stay blocked either way. */
function resolveLeaderId(
  raw: unknown,
  opts: { allowTeaser?: boolean } = {}
): { leaderId: string } | { error: ApiErrorResponse } {
  const leaderId = typeof raw === 'string' && raw ? raw : DEFAULT_LEADER_ID;
  const entry = listLeaders().find((l) => l.id === leaderId);
  if (!entry?.available || entry.unreleased === 'hidden') {
    return { error: { error: `Unknown or unavailable leader "${leaderId}".` } };
  }
  if (entry.unreleased === 'teaser' && !opts.allowTeaser) {
    return { error: { error: `Leader "${leaderId}" isn't open for challenges yet.` } };
  }
  return { leaderId };
}

api.get('/api/roster', (req, res) => {
  const resolved = resolveLeaderId(req.query.leader);
  if ('error' in resolved) {
    res.status(400).json(resolved.error);
    return;
  }
  const leader = getLeader(resolved.leaderId);
  const response: RosterResponse = {
    levelCap: leader.rules.levelCap,
    teamSize: leader.rules.teamSize,
    roster: getRoster(resolved.leaderId),
    natures: getNatures(),
  };
  res.json(response);
});

api.get('/api/rival', (req, res) => {
  const resolved = resolveLeaderId(req.query.leader, { allowTeaser: true });
  if ('error' in resolved) {
    res.status(400).json(resolved.error);
    return;
  }
  const leader = getLeader(resolved.leaderId);
  const response: RivalResponse = {
    ...describeTeam(leader.team),
    leaderId: leader.id,
    aceIndex: leader.aceIndex,
  };
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
  const resolved = resolveLeaderId(req.body?.leaderId);
  if ('error' in resolved) {
    res.status(400).json(resolved.error);
    return;
  }

  try {
    const selections = parseImportedTeam(resolved.leaderId, exportText);
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
  const resolved = resolveLeaderId(req.body?.leaderId);
  if ('error' in resolved) {
    res.status(400).json(resolved.error);
    return;
  }

  const rivalTeam = getLeader(resolved.leaderId).team;

  let team;
  try {
    team = buildPlayerTeamConfig(resolved.leaderId, pokemon);
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
      leaderId: resolved.leaderId,
      player: describeTeam(team),
      rival: describeTeam(rivalTeam),
      moveTargets: collectMoveTargets(result.turns),
      battleId: null,
    };

    try {
      const { p1Pct: playerHpPct, p2Pct: rivalHpPct } = computeHpRemaining(result.turns);
      response.battleId = await persistBattle({
        userId: req.session.userId!, // guaranteed by requireAuth
        leaderId: resolved.leaderId,
        playerSelections: pokemon,
        playerSummary: response.player,
        rivalTeam,
        rivalSummary: response.rival,
        outcome,
        faints: detectFaints(result.turns),
        // Buckets are pushed in order, one per turn plus a synthetic turn-0
        // setup bucket, so the last bucket's number is turns taken.
        turns: result.turns[result.turns.length - 1]!.turn,
        playerHpPct,
        rivalHpPct,
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

// General feedback from the footer's "leave feedback" CTA, not scoped to any
// battle. The client caps input at 180 chars too, but that's not load-bearing
// - this is the defense-in-depth check for a direct API call.
api.post('/api/feedback', async (req, res) => {
  const body = req.body as Partial<FeedbackRequest> | undefined;
  const text = body?.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Body must include non-empty feedback text.' });
    return;
  }
  if (text.trim().length > 180) {
    res.status(400).json({ error: 'Feedback must be 180 characters or fewer.' });
    return;
  }

  const userId = req.session.userId!; // guaranteed by requireAuth
  const id = await persistFeedback({ userId, body: text.trim() });
  const response: FeedbackResponse = { id };
  res.status(201).json(response);
});

// Mounted after every route is registered, so the public/`requireAuth`/gated
// ordering inside the router is what governs access. `|| '/'` because Express 5
// rejects an empty mount path.
app.use(BASE_PATH || '/', api);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
