import { Dex, toID } from '@pkmn/sim';
import type {
  AbilityOption,
  MatchupCategory,
  MoveDetail,
  MoveOption,
  NatureOption,
  StageOption,
  RosterLine,
  StatId,
} from '../../shared/apiTypes.js';
import { getLeader } from '../config/leaders/index.js';

export const FORMAT_ID = 'gen9doublescustomgame';

const dex = Dex.forFormat(FORMAT_ID);

// In-game, only one starter can ever be owned at a time, regardless of which
// leader's pool it was drawn from, so a team can never contain more than one
// member of this group. This is global (every leader), unlike the
// leader-specific trade groups built in getRoster from LeaderRules.tradeSpecies.
const STARTER_GROUP = 'starter';
const STARTER_SPECIES = new Set(['bulbasaur', 'charmander', 'squirtle']);

/** A plain level-up evolution is reachable once `levelCap` covers its level;
 * an item-gated (`useItem`) evolution is reachable only if its item is in
 * `evolutionItems` — a leader-specific allowlist of evolution items confirmed
 * obtainable before that leader (e.g. the Moon Stone found in Mt. Moon,
 * before Misty). Trades and friendship stay out of scope: no leader lists an
 * item for those, and nothing here checks for them. */
function isReachableEvo(evoSpeciesId: string, levelCap: number, evolutionItems: readonly string[]): boolean {
  const next = dex.species.get(evoSpeciesId);
  if (!next.evoType && typeof next.evoLevel === 'number' && next.evoLevel <= levelCap) return true;
  if (next.evoType === 'useItem' && next.evoItem && evolutionItems.includes(next.evoItem)) return true;
  return false;
}

/** Walks a species' evolution tree, branching whenever more than one of its
 * evolutions is reachable (e.g. Eevee with both Water Stone and Thunder
 * Stone unlocked yields a Vaporeon branch and a Jolteon branch). A species
 * with zero reachable evolutions is a one-stage branch ending at itself;
 * exactly one reachable evolution continues that same branch, matching a
 * plain (non-branching) chain. Returns every branch as its own base-to-tip
 * array of stage ids. */
export function evoBranches(baseId: string, levelCap: number, evolutionItems: readonly string[]): string[][] {
  const species = dex.species.get(baseId);
  const reachable = species.evos.filter((evoName) => isReachableEvo(evoName, levelCap, evolutionItems));
  if (reachable.length === 0) return [[baseId]];
  return reachable.flatMap((evoName) => {
    const nextId = dex.species.get(evoName).id;
    return evoBranches(nextId, levelCap, evolutionItems).map((branch) => [baseId, ...branch]);
  });
}

/** A stage's evolution ancestry, root-first and inclusive of the stage
 * itself, walked via the dex's `prevo` link rather than any one roster
 * line's stage list — so it's correct even for a stage that sits at a branch
 * point shared by several lines (e.g. Gloom, ancestor of both the Vileplume
 * and Bellossom lines). See `StageOption.lineage` in shared/apiTypes.ts. */
export function speciesLineage(speciesId: string): string[] {
  const chain = [dex.species.get(speciesId).id];
  let current = dex.species.get(speciesId);
  while (current.prevo) {
    current = dex.species.get(current.prevo);
    chain.unshift(current.id);
  }
  return chain;
}

// Gen 9 (Scarlet/Violet) is the target reference generation for which moves
// count as "naturally learnt," but several species in this pool — Pidgey,
// Rattata, Spearow, Weedle's line, Caterpie's line — aren't in Paldea's
// regional dex, so the games never assigned them a gen 9 level-up learnset
// (confirmed against both @pkmn/sim's data and PokeAPI, independently: for
// these species the newest entry in either source is gen 8, and the two
// datasets agree move-for-move on it). So each line is read from the newest
// generation, capped at 9, that actually has level-up data for it — gen 9
// where the games provide it, gen 8 for the species the games never gave a
// gen 9 moveset. Only 'L' (level-up) sources count — no egg moves, no
// TM/HM, no tutor moves.
function referenceGenForLine(stageIds: string[]): number {
  let best = 0;
  for (const speciesId of stageIds) {
    const learnset = dex.species.getLearnsetData(toID(speciesId)).learnset ?? {};
    for (const sources of Object.values(learnset)) {
      for (const source of sources as string[]) {
        const gen = /^(\d)L\d+$/.exec(source)?.[1];
        if (gen) best = Math.max(best, Number(gen));
      }
    }
  }
  return best;
}

/** Level-up movepool legal at `levelCap` for a stage, including moves
 * learned earlier in its evolution line (evolving never forgets moves). */
function legalMovesForStage(
  stageIds: string[],
  uptoIndex: number,
  referenceGen: number,
  levelCap: number
): MoveOption[] {
  const byId = new Map<string, MoveOption>();
  const levelSourcePattern = new RegExp(`^${referenceGen}L(\\d+)$`);

  for (let i = 0; i <= uptoIndex; i++) {
    const speciesId = stageIds[i];
    if (!speciesId) continue;
    const learnset = dex.species.getLearnsetData(toID(speciesId)).learnset ?? {};

    for (const [moveId, sources] of Object.entries(learnset)) {
      const bestLevel = (sources as string[])
        .map((source) => levelSourcePattern.exec(source)?.[1])
        .filter((lvl): lvl is string => lvl !== undefined)
        .map(Number)
        .filter((lvl) => lvl <= levelCap)
        .sort((a, b) => a - b)[0];
      if (bestLevel === undefined) continue;

      const existing = byId.get(moveId);
      if (existing && existing.learnedAt <= bestLevel) continue;

      const move = dex.moves.get(moveId);
      byId.set(moveId, {
        id: move.id,
        name: move.name,
        type: move.type,
        category: move.category,
        basePower: move.basePower,
        accuracy: move.accuracy,
        learnedAt: bestLevel,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.learnedAt - b.learnedAt || a.name.localeCompare(b.name));
}

/** A species' full ability pool (regular slots + hidden), deduped by id. */
function abilitiesForSpecies(speciesId: string): AbilityOption[] {
  const byId = new Map<string, AbilityOption>();
  for (const name of Object.values(dex.species.get(speciesId).abilities)) {
    const ability = dex.abilities.get(name);
    byId.set(ability.id, { id: ability.id, name: ability.name, shortDesc: ability.shortDesc });
  }
  return Array.from(byId.values());
}

/** Classifies a stage against a leader's `primaryType`: 'weak' if that type's
 * attacks hit the stage's typing super effectively, 'strong' if the stage's
 * typing resists it or the stage carries a STAB type super effective
 * against it, 'coverage' if neither holds but it learns a damaging move of
 * a type super effective against it without that being STAB, else
 * 'neutral'. Generalizes what `frontend/src/dex/rockMatchup.ts` hardcoded
 * for Rock, using the real dex type chart instead of a copied-out table -
 * see M4 in the leaders plan. */
function computeMatchup(types: readonly string[], moves: readonly MoveOption[], leaderType: string): MatchupCategory {
  const defenseExponent = dex.getEffectiveness(leaderType, [...types]);
  if (defenseExponent > 0) return 'weak';
  if (defenseExponent < 0) return 'strong';

  if (types.some((t) => dex.getEffectiveness(t, [leaderType]) > 0)) return 'strong';

  const hasNonStabCoverage = moves.some(
    (m) =>
      m.basePower > 0 &&
      dex.getEffectiveness(m.type, [leaderType]) > 0 &&
      !types.some((t) => t.toLowerCase() === m.type.toLowerCase())
  );
  return hasNonStabCoverage ? 'coverage' : 'neutral';
}

function buildLine(
  groupId: string,
  stageIds: string[],
  levelCap: number,
  leaderType: string,
  exclusiveGroup: string | undefined,
  exclusiveGroupKind: 'starter' | 'trade' | undefined
): RosterLine {
  const referenceGen = referenceGenForLine(stageIds);
  const stages: StageOption[] = stageIds.map((id, idx) => {
    const species = dex.species.get(id);
    const types = [...species.types];
    const moves = legalMovesForStage(stageIds, idx, referenceGen, levelCap);
    return {
      id: species.id,
      name: species.name,
      num: species.num,
      types,
      baseStats: { ...species.baseStats },
      abilities: abilitiesForSpecies(species.id),
      moves,
      matchup: computeMatchup(types, moves, leaderType),
      lineage: speciesLineage(species.id),
    };
  });

  return {
    groupId,
    exclusiveGroup,
    exclusiveGroupKind,
    stages,
  };
}

/** A branch's groupId: just the base species id when it's the only branch
 * (keeps groupId stable for every non-branching line, as before), else
 * suffixed with the branch's own final stage so sibling branches (e.g.
 * Eevee's) never collide. */
function branchGroupId(baseId: string, branches: string[][], branch: string[]): string {
  if (branches.length === 1) return baseId;
  return `${baseId}:${branch[branch.length - 1]}`;
}

const cachedRoster = new Map<string, RosterLine[]>();

export function getRoster(leaderId: string): RosterLine[] {
  let roster = cachedRoster.get(leaderId);
  if (!roster) {
    const leader = getLeader(leaderId);
    const tradeSpecies = leader.rules.tradeSpecies ?? [];

    // Every base species this leader's roster builds a line from: the
    // wild-encounter pool, plus any trade-only species it unlocks (not in
    // the wild pool, so absent from baseSpecies itself).
    const allBaseSpecies = [...leader.rules.baseSpecies, ...tradeSpecies.map((t) => t.species)];

    const exclusiveGroup = new Map<string, string>();
    const exclusiveGroupKind = new Map<string, 'starter' | 'trade'>();
    for (const speciesId of STARTER_SPECIES) {
      exclusiveGroup.set(speciesId, STARTER_GROUP);
      exclusiveGroupKind.set(speciesId, 'starter');
    }
    for (const trade of tradeSpecies) {
      // Keyed on both species so two different trades never collide.
      const groupId = `trade:${trade.species}:${trade.tradedFor}`;
      exclusiveGroup.set(trade.species, groupId);
      exclusiveGroup.set(trade.tradedFor, groupId);
      exclusiveGroupKind.set(trade.species, 'trade');
      exclusiveGroupKind.set(trade.tradedFor, 'trade');
    }

    roster = allBaseSpecies.flatMap((baseId) => {
      const branches = evoBranches(baseId, leader.rules.levelCap, leader.rules.evolutionItems);
      return branches.map((branch) =>
        buildLine(
          branchGroupId(baseId, branches, branch),
          branch,
          leader.rules.levelCap,
          leader.primaryType,
          exclusiveGroup.get(baseId),
          exclusiveGroupKind.get(baseId)
        )
      );
    });
    cachedRoster.set(leaderId, roster);
  }
  return roster;
}

let cachedNatures: NatureOption[] | undefined;

export function getNatures(): NatureOption[] {
  if (!cachedNatures) {
    cachedNatures = dex.natures.all().map((nature) => ({
      id: nature.id,
      name: nature.name,
      plus: nature.plus as StatId | undefined,
      minus: nature.minus as StatId | undefined,
    }));
  }
  return cachedNatures;
}

export function findStage(leaderId: string, stageId: string): { line: RosterLine; stage: StageOption } | undefined {
  for (const line of getRoster(leaderId)) {
    const stage = line.stages.find((s) => s.id === stageId);
    if (stage) return { line, stage };
  }
  return undefined;
}

/** Looks up a move by name or id, for showing its full stats (e.g. from the
 * battle log, where any move either team knows may come up). */
export function getMoveDetail(name: string): MoveDetail | undefined {
  const move = dex.moves.get(name);
  if (!move.exists) return undefined;
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    basePower: move.basePower,
    accuracy: move.accuracy,
    pp: move.pp,
    priority: move.priority,
    shortDesc: move.shortDesc,
  };
}
