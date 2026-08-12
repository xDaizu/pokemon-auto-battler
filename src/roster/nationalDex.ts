import { Dex } from '@pkmn/sim';
import { FORMAT_ID } from './roster.js';
import type { SpeciesOption } from '../../shared/apiTypes.js';

const dex = Dex.forFormat(FORMAT_ID);

let cached: SpeciesOption[] | undefined;

/**
 * Every species, for the login screen's 3-Pokemon combo picker.
 *
 * Deliberately NOT the roster from roster.ts: that one answers "what may the
 * player battle with" (pre-Brock, level-13 legal) and is intentionally tiny.
 * This one only has to be a large, stable set of names to pick a credential
 * from, so the two must not be coupled — changing the battle roster must never
 * invalidate anyone's login.
 *
 * `baseSpecies === name` keeps one entry per line, dropping every alternate
 * forme (mega, gmax, regional, cosmetic).
 *
 * `isNonstandard: 'Past'` is kept deliberately. The dex is scoped to FORMAT_ID
 * (gen 9), where every species outside Paldea's dex — Pidgey and most of Kanto
 * included — is marked 'Past'; excluding it would leave a Pokemon picker that
 * can't pick Pidgey. Keeping null + 'Past' yields the full national dex (1025)
 * while still dropping CAP/Future/Custom entries.
 */
export function getSpeciesList(): SpeciesOption[] {
  if (!cached) {
    cached = dex.species
      .all()
      .filter(
        (species) =>
          species.exists &&
          species.num > 0 &&
          species.baseSpecies === species.name &&
          (!species.isNonstandard || species.isNonstandard === 'Past')
      )
      .map((species) => ({ id: species.id, name: species.name, num: species.num }))
      .sort((a, b) => a.num - b.num);
  }
  return cached;
}
