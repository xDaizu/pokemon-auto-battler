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

/** Same four categories `frontend/src/dex/rockMatchup.ts` hardcoded for
 * Rock, now computed server-side against whichever leader's `primaryType`
 * the roster was requested for (see `src/roster/roster.ts`). */
export type MatchupCategory = 'weak' | 'strong' | 'coverage' | 'neutral';

export interface StageOption {
  id: string;
  name: string;
  num: number;
  types: string[];
  baseStats: BaseStats;
  abilities: AbilityOption[];
  moves: MoveOption[];
  matchup: MatchupCategory;
  /** This stage's evolution ancestry, root-first and inclusive of the stage
   * itself (e.g. Vileplume: `['oddish', 'gloom', 'vileplume']`). Lets a
   * client detect an evolution-family conflict between two picks without
   * re-deriving the dex's evolution tree itself: two stages are the same
   * family iff one id appears in the other's lineage (self included) - true
   * for Gloom+Vileplume, false for Vileplume+Bellossom, which only share an
   * unpicked common ancestor. See `speciesLineage` in `src/roster/roster.ts`. */
  lineage: string[];
}

export interface RosterLine {
  /** Unique per line. For a species whose reachable evolutions never branch,
   * this is just the base species id. A branching family (e.g. Eevee) yields
   * one line per reachable branch, `${baseId}:${finalStageId}` - see
   * `getRoster` in `src/roster/roster.ts`. */
  groupId: string;
  exclusiveGroup?: string;
  /** Why `exclusiveGroup` exists for this line, so the frontend can show the
   * right message when it collides with another line sharing the group:
   * 'starter' for the three FRLG starters (global, every leader), 'trade'
   * for a leader-specific in-game-trade pair (e.g. Misty's Mr. Mime, gotten
   * by trading away a Clefairy). Always set together with `exclusiveGroup`. */
  exclusiveGroupKind?: 'starter' | 'trade';
  stages: StageOption[];
}

export interface RosterResponse {
  levelCap: number;
  teamSize: number;
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

/** One row of `GET /api/leaders`. The optional fields are absent for a
 * leader that isn't playable yet, so nothing about an unshipped leader's
 * identity leaks into the response before it ships. `unreleased: 'teaser'`
 * marks a leader that's fully built and visible but not yet challengeable —
 * a *hidden* unreleased leader is indistinguishable from `available: false`
 * and never reports this field at all. */
export interface LeaderSummary {
  id: string;
  available: boolean;
  label?: string;
  primaryType?: string;
  teamSize?: number;
  levelCap?: number;
  unreleased?: 'teaser';
}

export interface LeadersResponse {
  leaders: LeaderSummary[];
}

/** `GET /api/rival`'s response. Structurally a superset of `TeamSummary`, so
 * code still typed against `TeamSummary` (the pre-M4 frontend) keeps
 * compiling untouched against it. */
export interface RivalResponse extends TeamSummary {
  leaderId: string;
  /** Index into `pokemon` of the signature mon shown big on the intro. */
  aceIndex: number;
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
  /** Stable id of the leader fought - `rival.label` is display text, not a key. */
  leaderId: string;
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

/** One piece of free-text general feedback from the footer's "leave feedback"
 * CTA — unlike MoveSuggestionRequest, not scoped to any battle or AI decision. */
export interface FeedbackRequest {
  body: string;
}

export interface FeedbackResponse {
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

/** Registration and login are separate acts now — the client already knows
 * which one it wants from the welcome screen, so there's no ambiguity for the
 * server to resolve. A login never carries a displayName; a register always
 * does. */
export interface RegisterRequest {
  username: string;
  displayName: string;
  pokemon: [string, string, string];
}

export interface LoginRequest {
  username: string;
  pokemon: [string, string, string];
}

export interface AuthResponse {
  user: AuthUser;
}

export interface SessionResponse {
  user: AuthUser | null;
}

/** Stable, language-independent reasons a `/api/auth/*` request can fail —
 * the frontend maps each to a localized message rather than displaying
 * `ApiErrorResponse.error` (English, meant for logs/devtools) directly. */
export type AuthErrorCode =
  | 'missing_fields'
  | 'incomplete_combo'
  | 'invalid_pokemon'
  | 'username_taken'
  | 'invalid_credentials'
  | 'session_start_failed';

export interface ApiErrorResponse {
  error: string;
  code?: AuthErrorCode;
}

/** One finished battle row on `GET /api/leaders/:leaderId/leaderboard`. Only
 * battles fought after the `turns`/`*_hp_pct` columns shipped are included -
 * see the leaderboard plan for why older rows are filtered server-side
 * instead of showing up as null/0. */
export interface LeaderboardEntry {
  battleId: number;
  displayName: string;
  outcome: BattleOutcome;
  turns: number;
  playerAlive: number;
  rivalAlive: number;
  playerHpPct: number;
  rivalHpPct: number;
  createdAt: string;
}

export interface LeaderboardResponse {
  leaderId: string;
  entries: LeaderboardEntry[];
}
