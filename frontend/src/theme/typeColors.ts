// Pokémon-type color triplets for design elements (type badges, move chips,
// species cards, ...). Separate from leaderThemes.ts — type and gym-leader
// are unrelated categories that happen to both be "a color for an id".
//
// Sourced verbatim from Bulbapedia's per-type color templates
// (https://bulbapedia.bulbagarden.net/wiki/Category:Type_color_templates),
// the de facto community-standard palette — there's no official Nintendo/
// Game Freak spec. Note these read as muted/wiki-styled rather than the
// "bold, vibrant, high-contrast" direction in docs/design/DESIGN.md; treat
// as a starting reference to push saturation/contrast on, not a final say.
//
// Keyed by the capitalized type name as returned by @pkmn/sim and already
// used throughout the app (see PlayerPokemonSelection['types'] in
// shared/apiTypes.ts, e.g. types: ['Rock']), so lookups need no case
// conversion: typeColors[pokemon.types[0]].

export interface TypeColor {
  /** Bulbapedia's "<Type> color". */
  regular: string;
  /** Bulbapedia's "<Type> color light". */
  light: string;
  /** Bulbapedia's "<Type> color dark". */
  dark: string;
}

export const typeColors: Partial<Record<string, TypeColor>> = {
  Normal: { regular: '#9FA19F', light: '#C1C2C1', dark: '#676967' },
  Fire: { regular: '#E62829', light: '#EF7374', dark: '#961A1B' },
  Water: { regular: '#2980EF', light: '#74ACF5', dark: '#1B539B' },
  Electric: { regular: '#FAC000', light: '#FCD659', dark: '#A37D00' },
  Grass: { regular: '#3FA129', light: '#82C274', dark: '#29691B' },
  Ice: { regular: '#3DCEF3', light: '#81DFF7', dark: '#28869E' },
  Fighting: { regular: '#FF8000', light: '#FFAC59', dark: '#A65300' },
  Poison: { regular: '#9141CB', light: '#B884DD', dark: '#5E2A84' },
  Ground: { regular: '#915121', light: '#B88E6F', dark: '#5E3515' },
  Flying: { regular: '#81B9EF', light: '#ADD2F5', dark: '#54789B' },
  Psychic: { regular: '#EF4179', light: '#F584A8', dark: '#9B2A4F' },
  Bug: { regular: '#91A119', light: '#B8C26A', dark: '#5E6910' },
  Rock: { regular: '#AFA981', light: '#CBC7AD', dark: '#726E54' },
  Ghost: { regular: '#704170', light: '#A284A2', dark: '#492A49' },
  Dragon: { regular: '#5060E1', light: '#8D98EC', dark: '#343E92' },
  Dark: { regular: '#624D4E', light: '#998B8C', dark: '#403233' },
  Steel: { regular: '#60A1B8', light: '#98C2D1', dark: '#3E6978' },
  Fairy: { regular: '#EF70EF', light: '#F5A2F5', dark: '#9B499B' },
};
