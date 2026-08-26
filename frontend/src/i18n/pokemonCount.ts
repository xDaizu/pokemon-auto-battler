import type { Lang } from './dexNames';

/** Spells out the small, finite set of team sizes a leader can have, so a
 * count-parameterized rule sentence ("Two Pokémon only") reads as a full
 * sentence rather than a bare digit. Shared by IntroScreen (`intro.rule.
 * pokemonCount`) and TeamBuilder (`teamBuilder.rules`) - both surface the
 * same per-leader `teamSize` as prose. */
const POKEMON_COUNT_WORDS: Record<Lang, Record<number, string>> = {
  en: { 1: 'One', 2: 'Two', 3: 'Three' },
  es: { 1: 'un', 2: 'dos', 3: 'tres' },
};

export function pokemonCountWord(n: number, lang: Lang): string {
  return POKEMON_COUNT_WORDS[lang][n] ?? String(n);
}
