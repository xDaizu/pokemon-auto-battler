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

// Gen 7 (Sun/Moon/Ultra Sun/Ultra Moon) is the reference generation for
// which moves count as "naturally learnt": it's the newest generation whose
// dex still covers every species in this pool with level-up learnset data
// (several — Pidgey, Rattata, Spearow, Weedle's line, ... — dropped out of
// later regional dexes, e.g. Scarlet/Violet's). Fixing on one generation,
// rather than picking per-species "whichever gen has data," keeps what
// counts as a legal move consistent across the whole roster. Only 'L'
// (level-up) sources count — no egg moves, no TM/HM, no tutor moves.
const REFERENCE_GEN = 7;

/** Level-up movepool legal at the level cap for a stage, including moves
 * learned earlier in its evolution line (evolving never forgets moves). */
function legalMovesForStage(stageIds: string[], uptoIndex: number): MoveOption[] {
  const byId = new Map<string, MoveOption>();
  const levelSourcePattern = new RegExp(`^${REFERENCE_GEN}L(\\d+)$`);

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
  const stages: StageOption[] = stageIds.map((id, idx) => {
    const species = dex.species.get(id);
    return {
      id: species.id,
      name: species.name,
      num: species.num,
      types: [...species.types],
      moves: legalMovesForStage(stageIds, idx),
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
