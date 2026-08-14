import esDex from './data/esDex.json';

export type Lang = 'en' | 'es';

/** Matches @pkmn/sim's toID (lowercase, punctuation/spaces stripped), so any
 * display name coming back from the API or the battle log can be used as a
 * lookup key into data/esDex.json without needing the id separately. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function translateSpeciesName(name: string, lang: Lang): string {
  if (lang === 'en') return name;
  return (esDex.species as Record<string, string>)[slug(name)] ?? name;
}

export function translateMoveName(name: string, lang: Lang): string {
  if (lang === 'en') return name;
  return (esDex.moves as Record<string, { name: string }>)[slug(name)]?.name ?? name;
}

export function translateMoveDesc(name: string, desc: string, lang: Lang): string {
  if (lang === 'en') return desc;
  return (esDex.moves as Record<string, { shortDesc?: string }>)[slug(name)]?.shortDesc ?? desc;
}

export function translateAbilityName(name: string, lang: Lang): string {
  if (lang === 'en') return name;
  return (esDex.abilities as Record<string, { name: string }>)[slug(name)]?.name ?? name;
}

export function translateAbilityDesc(name: string, desc: string, lang: Lang): string {
  if (lang === 'en') return desc;
  return (esDex.abilities as Record<string, { shortDesc?: string }>)[slug(name)]?.shortDesc ?? desc;
}

export function translateNatureName(name: string, lang: Lang): string {
  if (lang === 'en') return name;
  return (esDex.natures as Record<string, string>)[slug(name)] ?? name;
}

// Weather conditions aren't in esDex.json (that file only covers dex-listed
// species/moves/abilities/natures), so this is a small hand-maintained map
// for the ids @pkmn/sim's `-weather` protocol line can send. None of the
// current roster's abilities set weather, but a move like Rain Dance can.
const WEATHER_ES: Record<string, string> = {
  SunnyDay: 'Día Soleado',
  DesolateLand: 'Sol Extremo',
  RainDance: 'Lluvia',
  PrimordialSea: 'Lluvia Torrencial',
  Sandstorm: 'Tormenta de Arena',
  Hail: 'Granizo',
  Snowscape: 'Nieve',
  DeltaStream: 'Corriente Extraña',
};

/** "SunnyDay" -> "Sunny Day": @pkmn/sim's weather names are PascalCase with
 * no spaces, so English just needs word-splitting rather than a dictionary. */
function spaceOutPascalCase(id: string): string {
  return id.replace(/(?!^)(?=[A-Z])/g, ' ');
}

export function translateWeatherName(name: string, lang: Lang): string {
  if (lang === 'en') return spaceOutPascalCase(name);
  return WEATHER_ES[name] ?? spaceOutPascalCase(name);
}

const TYPE_ES: Record<string, string> = {
  Normal: 'Normal',
  Fire: 'Fuego',
  Water: 'Agua',
  Electric: 'Eléctrico',
  Grass: 'Planta',
  Ice: 'Hielo',
  Fighting: 'Lucha',
  Poison: 'Veneno',
  Ground: 'Tierra',
  Flying: 'Volador',
  Psychic: 'Psíquico',
  Bug: 'Bicho',
  Rock: 'Roca',
  Ghost: 'Fantasma',
  Dragon: 'Dragón',
  Dark: 'Siniestro',
  Steel: 'Acero',
  Fairy: 'Hada',
  Stellar: 'Astral',
};

export function translateType(type: string, lang: Lang): string {
  if (lang === 'en') return type;
  return TYPE_ES[type] ?? type;
}

const CATEGORY_ES: Record<string, string> = { Physical: 'Físico', Special: 'Especial', Status: 'Estado' };

export function translateCategory(category: string, lang: Lang): string {
  if (lang === 'en') return category;
  return CATEGORY_ES[category] ?? category;
}

export type ExtendedStatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion';

const STAT_ABBR_ES: Record<ExtendedStatId, string> = {
  hp: 'PS',
  atk: 'Atq',
  def: 'Def',
  spa: 'At. Esp.',
  spd: 'Def. Esp.',
  spe: 'Vel.',
  accuracy: 'Prec.',
  evasion: 'Eva.',
};

const STAT_ABBR_EN: Record<ExtendedStatId, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
};

export function statAbbr(statId: ExtendedStatId, lang: Lang): string {
  return (lang === 'en' ? STAT_ABBR_EN : STAT_ABBR_ES)[statId];
}

const STAT_FULL_ES: Record<ExtendedStatId, string> = {
  hp: 'PS',
  atk: 'Ataque',
  def: 'Defensa',
  spa: 'Ataque Especial',
  spd: 'Defensa Especial',
  spe: 'Velocidad',
  accuracy: 'Precisión',
  evasion: 'Evasión',
};

const STAT_FULL_EN: Record<ExtendedStatId, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
};

export function statFull(statId: ExtendedStatId, lang: Lang): string {
  return (lang === 'en' ? STAT_FULL_EN : STAT_FULL_ES)[statId];
}
