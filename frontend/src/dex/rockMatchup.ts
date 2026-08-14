/** Rock-type attack multiplier against each defending type (entries at 1x
 * are omitted). Used to flag species that are risky picks against a
 * Rock-type gym leader (e.g. Brock). */
const ROCK_ATTACK_MULTIPLIER: Record<string, number> = {
  bug: 2,
  fire: 2,
  flying: 2,
  ice: 2,
  fighting: 0.5,
  ground: 0.5,
  steel: 0.5,
};

/** Attacking types that are super effective against pure Rock - i.e. a move
 * of this type threatens a Rock-type gym leader even if the leader's own
 * dual typing (Onix's Rock/Ground, say) would blunt it. */
const TYPES_SUPER_EFFECTIVE_VS_ROCK = new Set(['water', 'grass', 'fighting', 'ground', 'steel']);

export type RockMatchup = 'weak' | 'strong' | 'coverage' | 'neutral';

interface RockMatchupMove {
  type: string;
  basePower: number;
}

interface RockMatchupStage {
  types: string[];
  moves: RockMatchupMove[];
}

/** Classifies a species against a Rock-type gym: 'weak' if Rock moves hit
 * its combined typing super effectively, 'strong' if its typing resists
 * Rock or it carries a STAB type that's super effective against Rock,
 * 'coverage' if neither of those hold but it learns a damaging move of a
 * type that's super effective against Rock without that being STAB, else
 * 'neutral'. */
export function rockMatchup(stage: RockMatchupStage): RockMatchup {
  const types = stage.types;
  const defenseMultiplier = types.reduce(
    (mult, t) => mult * (ROCK_ATTACK_MULTIPLIER[t.toLowerCase()] ?? 1),
    1
  );
  if (defenseMultiplier > 1) return 'weak';
  if (defenseMultiplier < 1) return 'strong';
  if (types.some((t) => TYPES_SUPER_EFFECTIVE_VS_ROCK.has(t.toLowerCase()))) return 'strong';
  const hasNonStabCoverage = stage.moves.some(
    (m) =>
      m.basePower > 0 &&
      TYPES_SUPER_EFFECTIVE_VS_ROCK.has(m.type.toLowerCase()) &&
      !types.some((t) => t.toLowerCase() === m.type.toLowerCase())
  );
  if (hasNonStabCoverage) return 'coverage';
  return 'neutral';
}
