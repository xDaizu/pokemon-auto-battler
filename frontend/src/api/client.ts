import type {
  BattleResult,
  ImportTeamResponse,
  LoginResponse,
  MoveDetail,
  MoveSuggestionRequest,
  MoveSuggestionResponse,
  PlayerPokemonSelection,
  RosterResponse,
  SessionResponse,
  SpeciesListResponse,
  TeamSummary,
} from './types';

/** Vite's BASE_URL is '/' in dev and '/battler/' in the deployed build, and
 * always ends in a slash — so this is '/api' locally (hitting the dev proxy
 * unchanged) and '/battler/api' behind the Firebase Hosting rewrite. */
const API = `${import.meta.env.BASE_URL}api`;

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function fetchRoster(): Promise<RosterResponse> {
  return fetch(`${API}/roster`).then((res) => asJson<RosterResponse>(res));
}

export function fetchRival(): Promise<TeamSummary> {
  return fetch(`${API}/rival`).then((res) => asJson<TeamSummary>(res));
}

export function runBattle(pokemon: PlayerPokemonSelection[]): Promise<BattleResult> {
  return fetch(`${API}/battle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokemon }),
  }).then((res) => asJson<BattleResult>(res));
}

export function importTeam(exportText: string): Promise<ImportTeamResponse> {
  return fetch(`${API}/import-team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exportText }),
  }).then((res) => asJson<ImportTeamResponse>(res));
}

export function fetchMoveDetail(name: string): Promise<MoveDetail> {
  return fetch(`${API}/moves/${encodeURIComponent(name)}`).then((res) => asJson<MoveDetail>(res));
}

export function submitMoveSuggestion(
  battleId: number,
  suggestion: MoveSuggestionRequest
): Promise<MoveSuggestionResponse> {
  return fetch(`${API}/battles/${battleId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(suggestion),
  }).then((res) => asJson<MoveSuggestionResponse>(res));
}

export function fetchSpecies(): Promise<SpeciesListResponse> {
  return fetch(`${API}/species`).then((res) => asJson<SpeciesListResponse>(res));
}

/** Signup and login in one call: an unclaimed username submitted without a
 * displayName gets `needsDisplayName` back instead of being created; the
 * caller resubmits with one to actually register. A claimed username just
 * has to match the combo it already stored. */
export function login(
  username: string,
  pokemon: [string, string, string],
  displayName?: string
): Promise<LoginResponse> {
  return fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pokemon, displayName }),
  }).then((res) => asJson<LoginResponse>(res));
}

export function logout(): Promise<void> {
  return fetch(`${API}/auth/logout`, { method: 'POST' }).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  });
}

export function fetchSession(): Promise<SessionResponse> {
  return fetch(`${API}/auth/me`).then((res) => asJson<SessionResponse>(res));
}

export function spriteUrl(num: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${num}.png`;
}
