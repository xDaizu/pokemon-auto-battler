// Single source of truth for the /api/* HTTP contract between the Express
// backend (src/server) and the Vite frontend (frontend/src/api). Both sides
// import these as type-only, so this file has no runtime footprint and is
// fully erased at build/transpile time.

export interface MoveOption {
  id: string;
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  learnedAt: number;
}

export interface StageOption {
  id: string;
  name: string;
  num: number;
  types: string[];
  moves: MoveOption[];
}

export interface RosterLine {
  groupId: string;
  exclusiveGroup?: string;
  stages: StageOption[];
}

export interface RosterResponse {
  levelCap: number;
  roster: RosterLine[];
}

export interface TeamMemberSummary {
  species: string;
  name: string;
  num: number;
  level: number;
  types: string[];
}

export interface TeamSummary {
  label: string;
  pokemon: TeamMemberSummary[];
}

export interface BattleTurnLog {
  turn: number;
  lines: string[];
}

export type BattleOutcome = 'player' | 'rival' | 'tie';

export interface BattleApiResponse {
  turns: BattleTurnLog[];
  winner?: string;
  tie: boolean;
  outcome: BattleOutcome;
  player: TeamSummary;
  rival: TeamSummary;
}

export interface PlayerPokemonSelection {
  stageId: string;
  moves: string[];
}

export interface ImportTeamResponse {
  selections: PlayerPokemonSelection[];
}
