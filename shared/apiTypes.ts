// Single source of truth for the /api/* HTTP contract between the Express
// backend (src/server) and the Vite frontend (frontend/src/api). Both sides
// import these as type-only, so this file has no runtime footprint and is
// fully erased at build/transpile time.

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface AbilityOption {
  id: string;
  name: string;
  shortDesc: string;
}

export interface NatureOption {
  id: string;
  name: string;
  plus?: StatId;
  minus?: StatId;
}

export interface MoveOption {
  id: string;
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  learnedAt: number;
}

export interface MoveDetail {
  id: string;
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  pp: number;
  priority: number;
  shortDesc: string;
}

export interface StageOption {
  id: string;
  name: string;
  num: number;
  types: string[];
  baseStats: BaseStats;
  abilities: AbilityOption[];
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
  natures: NatureOption[];
}

export interface TeamMemberSummary {
  species: string;
  name: string;
  num: number;
  level: number;
  types: string[];
  ability: string;
  /** Absent for a set whose export text has no `Nature` line (e.g. `rivalTeam`), which the importer treats as neutral. */
  nature?: string;
  /** Never populated today — the format bans held items — but `describeTeam` fills it in whenever a set does carry one. */
  item?: string;
  baseStats: BaseStats;
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

/** Mirrors `@pkmn/sim`'s `MoveTarget` union — who a move's targeting rules
 * actually reach, as opposed to the single nominal Pokémon the raw `|move|`
 * protocol line names (see `src/battle/moveTargets.ts`). */
export type MoveTargetCategory =
  | 'adjacentAlly'
  | 'adjacentAllyOrSelf'
  | 'adjacentFoe'
  | 'all'
  | 'allAdjacent'
  | 'allAdjacentFoes'
  | 'allies'
  | 'allySide'
  | 'allyTeam'
  | 'any'
  | 'foeSide'
  | 'normal'
  | 'randomNormal'
  | 'scripted'
  | 'self';

export interface BattleApiResponse {
  turns: BattleTurnLog[];
  winner?: string;
  tie: boolean;
  outcome: BattleOutcome;
  player: TeamSummary;
  rival: TeamSummary;
  /** Every move used this battle, keyed by `@pkmn/sim` move id, mapped to
   * its targeting category — lets the frontend describe who a move hit
   * without a second Pokémon dex client-side (see CLAUDE.md). */
  moveTargets: Record<string, MoveTargetCategory>;
  /** The persisted `battles.id`, needed to submit a move-suggestion report
   * against this battle. Null when persistence failed (swallowed server-side,
   * see src/server/index.ts) - the frontend should hide the report action
   * rather than submit against a battle that doesn't exist. */
  battleId: number | null;
}

/** One player report on an AI move decision, submitted from the battle log.
 * `turn`/`lineIndex`/`rawLine` identify the exact `|move|...` protocol line
 * being reported (index into that turn's `BattleTurnLog.lines`); `rawLine` is
 * carried along mainly so a report is still legible without re-joining it
 * back to the battle's stored turns. */
export interface MoveSuggestionRequest {
  turn: number;
  lineIndex: number;
  rawLine: string;
  suggestion: string;
  reason: string;
}

export interface MoveSuggestionResponse {
  id: number;
}

export interface PlayerPokemonSelection {
  stageId: string;
  ability: string;
  nature: string;
  moves: string[];
}

export interface ImportTeamResponse {
  selections: PlayerPokemonSelection[];
}

/** One entry in the national-dex list backing the login screen's combo picker.
 * Unrelated to RosterLine/StageOption, which describe the far smaller pool of
 * species that are actually legal to battle with. */
export interface SpeciesOption {
  id: string;
  name: string;
  num: number;
}

export interface SpeciesListResponse {
  species: SpeciesOption[];
}

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  /** Dex ids, positional — the combo is order-sensitive. */
  pokemon: [string, string, string];
}

export interface LoginRequest {
  username: string;
  displayName: string;
  pokemon: [string, string, string];
}

export interface AuthResponse {
  user: AuthUser;
}

export interface SessionResponse {
  user: AuthUser | null;
}
