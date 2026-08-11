import { Dex, toID } from '@pkmn/sim';

export const LEVEL_CAP = 13;
export const FORMAT_ID = 'gen9doublescustomgame';

const dex = Dex.forFormat(FORMAT_ID);

// Every Pokemon legitimately obtainable in FireRed/LeafGreen before beating
// Brock (starters + wild encounters on Route 1/2/22 and Viridian Forest —
// see scripts/pokemon-before-brock.ts), grouped into mutually-exclusive
// "lines" the player can build an evolution stage and moveset from.
const BASE_SPECIES = [
  'bulbasaur',
  'charmander',
  'squirtle',
  'caterpie',
  'weedle',
  'pidgey',
  'rattata',
  'spearow',
  'mankey',
  'pikachu',
] as const;

// In-game, only one starter can ever be owned at a time, so a team can
// never contain more than one member of this group.
const STARTER_GROUP = 'starter';
const STARTER_SPECIES = new Set(['bulbasaur', 'charmander', 'squirtle']);

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

/** Walks a species' evolution line, stopping once the next stage's natural
 * level requirement exceeds the level cap. Only plain level-up evolutions
 * are considered — no items, trades, or friendship are usable here. */
function evoChainStageIds(baseId: string): string[] {
  const stages = [baseId];
  let current = dex.species.get(baseId);
  for (;;) {
    const nextId = current.evos.find((evoName) => {
      const next = dex.species.get(evoName);
      return !next.evoType && typeof next.evoLevel === 'number' && next.evoLevel <= LEVEL_CAP;
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

/** Level-up movepool legal at the level cap for a stage, including moves
 * learned earlier in its evolution line (evolving never forgets moves). */
function legalMovesForStage(stageIds: string[], uptoIndex: number, referenceGen: number): MoveOption[] {
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
        .filter((lvl) => lvl <= LEVEL_CAP)
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

function buildLine(baseId: string): RosterLine {
  const stageIds = evoChainStageIds(baseId);
  const referenceGen = referenceGenForLine(stageIds);
  const stages: StageOption[] = stageIds.map((id, idx) => {
    const species = dex.species.get(id);
    return {
      id: species.id,
      name: species.name,
      num: species.num,
      types: [...species.types],
      moves: legalMovesForStage(stageIds, idx, referenceGen),
    };
  });

  return {
    groupId: baseId,
    exclusiveGroup: STARTER_SPECIES.has(baseId) ? STARTER_GROUP : undefined,
    stages,
  };
}

let cachedRoster: RosterLine[] | undefined;

export function getRoster(): RosterLine[] {
  if (!cachedRoster) cachedRoster = BASE_SPECIES.map(buildLine);
  return cachedRoster;
}

export function findStage(stageId: string): { line: RosterLine; stage: StageOption } | undefined {
  for (const line of getRoster()) {
    const stage = line.stages.find((s) => s.id === stageId);
    if (stage) return { line, stage };
  }
  return undefined;
}
