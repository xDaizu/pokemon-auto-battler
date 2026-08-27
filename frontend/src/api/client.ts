import type {
  AuthErrorCode,
  AuthResponse,
  BattleResult,
  ImportTeamResponse,
  LeadersResponse,
  MoveDetail,
  MoveSuggestionRequest,
  MoveSuggestionResponse,
  PlayerPokemonSelection,
  RivalResponse,
  RosterResponse,
  SessionResponse,
  SpeciesListResponse,
} from './types';

/** Vite's BASE_URL is '/' in dev and '/battler/' in the deployed build, and
 * always ends in a slash — so this is '/api' locally (hitting the dev proxy
 * unchanged) and '/battler/api' behind the Firebase Hosting rewrite. */
const API = `${import.meta.env.BASE_URL}api`;

/** Thrown for any non-2xx API response. `code`, when the server sent one, is
 * a stable machine-readable reason (currently only `/api/auth/*` does) —
 * screens map it to a localized message instead of showing `message`
 * (English, meant for logs/devtools) to the user. */
export class ApiError extends Error {
  code?: AuthErrorCode;
  constructor(message: string, code?: AuthErrorCode) {
    super(message);
    this.code = code;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, body?.code);
  }
  return res.json() as Promise<T>;
}

export function fetchRoster(leaderId: string): Promise<RosterResponse> {
  return fetch(`${API}/roster?leader=${encodeURIComponent(leaderId)}`).then((res) => asJson<RosterResponse>(res));
}

export function fetchRival(leaderId: string): Promise<RivalResponse> {
  return fetch(`${API}/rival?leader=${encodeURIComponent(leaderId)}`).then((res) => asJson<RivalResponse>(res));
}

export function fetchLeaders(): Promise<LeadersResponse> {
  return fetch(`${API}/leaders`).then((res) => asJson<LeadersResponse>(res));
}

export function runBattle(pokemon: PlayerPokemonSelection[], leaderId: string): Promise<BattleResult> {
  return fetch(`${API}/battle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokemon, leaderId }),
  }).then((res) => asJson<BattleResult>(res));
}

export function importTeam(exportText: string, leaderId: string): Promise<ImportTeamResponse> {
  return fetch(`${API}/import-team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exportText, leaderId }),
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

/** Claims a brand-new username; a username already taken is rejected rather
 * than falling back to a login check. */
export function register(
  username: string,
  displayName: string,
  pokemon: [string, string, string]
): Promise<AuthResponse> {
  return fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, pokemon }),
  }).then((res) => asJson<AuthResponse>(res));
}

/** Never creates an account: an unknown username and a wrong combo produce
 * the same error. */
export function login(username: string, pokemon: [string, string, string]): Promise<AuthResponse> {
  return fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pokemon }),
  }).then((res) => asJson<AuthResponse>(res));
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
