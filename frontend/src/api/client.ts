import type {
  BattleResult,
  ImportTeamResponse,
  MoveDetail,
  PlayerPokemonSelection,
  RosterResponse,
  TeamSummary,
} from './types';

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function fetchRoster(): Promise<RosterResponse> {
  return fetch('/api/roster').then((res) => asJson<RosterResponse>(res));
}

export function fetchRival(): Promise<TeamSummary> {
  return fetch('/api/rival').then((res) => asJson<TeamSummary>(res));
}

export function runBattle(pokemon: PlayerPokemonSelection[]): Promise<BattleResult> {
  return fetch('/api/battle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokemon }),
  }).then((res) => asJson<BattleResult>(res));
}

export function importTeam(exportText: string): Promise<ImportTeamResponse> {
  return fetch('/api/import-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exportText }),
  }).then((res) => asJson<ImportTeamResponse>(res));
}

export function fetchMoveDetail(name: string): Promise<MoveDetail> {
  return fetch(`/api/moves/${encodeURIComponent(name)}`).then((res) => asJson<MoveDetail>(res));
}

export function spriteUrl(num: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${num}.png`;
}
