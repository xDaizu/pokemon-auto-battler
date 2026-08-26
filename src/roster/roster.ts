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
// member of this group.
const STARTER_GROUP = 'starter';
const STARTER_SPECIES = new Set(['bulbasaur', 'charmander', 'squirtle']);

/** Walks a species' evolution line, stopping once the next stage's natural
 * level requirement exceeds `levelCap`. Only plain level-up evolutions
 * are considered — no items, trades, or friendship are usable here. */
function evoChainStageIds(baseId: string, levelCap: number): string[] {
  const stages = [baseId];
  let current = dex.species.get(baseId);
  for (;;) {
    const nextId = current.evos.find((evoName) => {
      const next = dex.species.get(evoName);
      return !next.evoType && typeof next.evoLevel === 'number' && next.evoLevel <= levelCap;
    });
    if (!nextId) break;
    current = dex.species.get(nextId);
    stages.push(current.id);
  }
  return stages;
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

function buildLine(baseId: string, levelCap: number, leaderType: string): RosterLine {
  const stageIds = evoChainStageIds(baseId, levelCap);
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
    };
  });

  return {
    groupId: baseId,
    exclusiveGroup: STARTER_SPECIES.has(baseId) ? STARTER_GROUP : undefined,
    stages,
  };
}

const cachedRoster = new Map<string, RosterLine[]>();

export function getRoster(leaderId: string): RosterLine[] {
  let roster = cachedRoster.get(leaderId);
  if (!roster) {
    const leader = getLeader(leaderId);
    roster = leader.rules.baseSpecies.map((baseId) => buildLine(baseId, leader.rules.levelCap, leader.primaryType));
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
