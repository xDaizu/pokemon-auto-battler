import type { TeamConfig } from '../teams/types.js';

export interface LeaderRules {
  teamSize: number;
  levelCap: number;
  /** Base species ids the player may draw from, in dex order. */
  baseSpecies: readonly string[];
  allowItems: boolean; // false for both leaders today; the hook for later ones
  /** Evolution items (dex `evoItem` names, e.g. 'Moon Stone') legitimately
   * obtainable before this leader. A species whose next evolution is
   * item-gated (`evoType: 'useItem'`) becomes reachable in the roster only
   * if its item is listed here — every other item-gated, traded, or
   * friendship-gated evolution stays out of scope regardless. */
  evolutionItems: readonly string[];
}

export interface LeaderConfig {
  id: string;
  /** English, DB-bound (invariant 8) — becomes `battles.rival_label`. */
  label: string;
  rules: LeaderRules;
  team: TeamConfig;
  /** Index into the team's sets of the signature mon shown big on the intro. */
  aceIndex: number;
  /** Thematic type — drives matchup hints and the frontend's palette. */
  primaryType: string;
}

/**
 * One row of the registry (`src/config/leaders/index.ts`) - either a fully
 * specified, playable leader, or a placeholder that carries nothing but its
 * id. Keeping the unavailable case to just `{ id, available: false }` (no
 * label, no team) means nothing about an unshipped leader can leak into the
 * UI before the milestone that ships them.
 */
export type LeaderEntry = (LeaderConfig & { available: true }) | { id: string; available: false };
