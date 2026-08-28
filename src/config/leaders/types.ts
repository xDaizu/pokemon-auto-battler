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
  /** Species obtainable only by an in-game trade for another species already
   * in this leader's pool — not a wild encounter, so not in `baseSpecies`.
   * `roster.ts` adds each as an extra line and mutually excludes it with the
   * species it costs, the same way `exclusiveGroup: 'starter'` limits a team
   * to one starter (e.g. Misty's Mr. Mime, gotten by trading a Clefairy). */
  tradeSpecies?: readonly TradeSpecies[];
}

export interface TradeSpecies {
  /** The species gained through the trade. */
  species: string;
  /** The species given up to get it — must already be in `baseSpecies`. */
  tradedFor: string;
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
  /** A fully built leader not yet open to players. `'hidden'` reports and
   * gates identically to `available: false` (see `LeaderEntry` below) — the
   * config just stays intact for a later flip. `'teaser'` stays visible and
   * selectable (intro screen, real roster art) but every endpoint that would
   * let someone actually draft/import/battle as them still rejects it, and
   * the intro screen's own CTA and Pokémon-detail modal go inert. Undefined
   * means released. */
  unreleased?: 'hidden' | 'teaser';
}

/**
 * One row of the registry (`src/config/leaders/index.ts`) - either a fully
 * specified, playable leader, or a placeholder that carries nothing but its
 * id. Keeping the unavailable case to just `{ id, available: false }` (no
 * label, no team) means nothing about an unshipped leader can leak into the
 * UI before the milestone that ships them.
 */
export type LeaderEntry = (LeaderConfig & { available: true }) | { id: string; available: false };
