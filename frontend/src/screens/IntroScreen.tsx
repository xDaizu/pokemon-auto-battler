import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import '../styles/intro.css';
import brockPortrait from '../assets/leaders/brock.png';
import boulderBadge from '../assets/badges/boulder.png';
import { fetchLeaders, fetchRival, spriteUrl } from '../api/client';
import type { LeaderSummary, RivalResponse } from '../api/types';
import { PokemonDetailCard, usePokemonDetailCard } from '../components/PokemonDetailCard';
import { RichText, useLanguage } from '../i18n/LanguageContext';
import { translateSpeciesName, type Lang } from '../i18n/dexNames';
import { ThemeScope } from '../theme/ThemeScope';
import { typeColors } from '../theme/typeColors';

// The fixed cap on moves per Pokémon - same value TeamBuilder.tsx enforces.
// Unlike the level cap and team size below, this isn't a per-leader rule
// (LeaderRules carries no such field), so there's nothing to fetch it from.
const MAX_MOVES = 4;

/** Spells out the small, finite set of team sizes a leader can have, so
 * `intro.rule.pokemonCount` reads as a full sentence ("Two Pokémon only")
 * rather than a bare digit. */
const POKEMON_COUNT_WORDS: Record<Lang, Record<number, string>> = {
  en: { 1: 'One', 2: 'Two', 3: 'Three' },
  es: { 1: 'un', 2: 'dos', 3: 'tres' },
};

function pokemonCountWord(n: number, lang: Lang): string {
  return POKEMON_COUNT_WORDS[lang][n] ?? String(n);
}

/** Ace-first display order for the splash's circle stack: the leader's
 * signature Pokémon (by `aceIndex`) leads, everything else follows in the
 * roster's own (battle-slot) order, which stays untouched everywhere else. */
function orderForSplash<T>(pokemon: T[], aceIndex: number): T[] {
  const ace = pokemon[aceIndex];
  if (!ace) return pokemon;
  return [ace, ...pokemon.filter((mon) => mon !== ace)];
}

export function IntroScreen({ onContinue }: { onContinue: () => void }) {
  const { t, lang } = useLanguage();
  const [rival, setRival] = useState<RivalResponse | null>(null);
  const [leader, setLeader] = useState<LeaderSummary | null>(null);
  const card = usePokemonDetailCard();

  useEffect(() => {
    fetchRival().then(setRival).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchLeaders()
      .then((res) => setLeader(res.leaders.find((l) => l.id === 'brock') ?? null))
      .catch(() => undefined);
  }, []);

  const splashMons = rival ? orderForSplash(rival.pokemon, rival.aceIndex) : [];
  const teamSize = leader?.teamSize;
  const levelCap = leader?.levelCap;

  // Rock-type "dark" swatch (see theme/typeColors.ts) fills the Persona-3-style
  // shadow silhouette below — Brock's type, not the Dark type.
  const shadowStyle: CSSProperties = {
    backgroundColor: typeColors.Rock?.dark,
    WebkitMaskImage: `url(${brockPortrait})`,
    maskImage: `url(${brockPortrait})`,
  };

  // Same Rock-type swatch, this time for the heading's comic-panel box.
  const rockBoxStyle: CSSProperties = {
    backgroundColor: typeColors.Rock?.regular,
    borderColor: typeColors.Rock?.dark,
  };

  return (
    <div className="panel intro">
      <ThemeScope leaderId="brock">
        <div className="brock-splash">
          <h1 className="brock-splash-title">{t('intro.splashTitle')}</h1>
          <div className="brock-splash-portrait">
            <div className="brock-splash-shadow" style={shadowStyle} aria-hidden="true" />
            <img className="brock-splash-sprite" src={brockPortrait} alt={t('intro.rivalLabel')} />
          </div>
          <div className="brock-splash-mons">
            {/* Ace-first for the splash only (signature mon leads the circle
             * stack) — the roster's own order is battle team-slot order and
             * stays untouched. */}
            {splashMons.map((mon, i) => (
              <button
                type="button"
                className={`mon-circle${i === 0 ? ' mon-circle--ace' : ''}`}
                key={mon.species}
                title={`${translateSpeciesName(mon.name, lang)} · ${t('common.levelAbbrev')}${mon.level}`}
                aria-label={t('pokemonCard.viewDetails', { name: translateSpeciesName(mon.name, lang) })}
                onClick={() => card.open(mon)}
              >
                <img src={spriteUrl(mon.num)} alt={mon.name} />
              </button>
            ))}
          </div>
        </div>
      </ThemeScope>

      <div className="intro-heading">
        <div className="intro-heading-box" style={rockBoxStyle}>
          <img className="intro-heading-badge" src={boulderBadge} alt="" aria-hidden="true" />
          <h2>{t('intro.heading')}</h2>
        </div>
      </div>
      <div className="intro-body-box">
        <p>
          <RichText text={t('intro.description')} />
        </p>
      </div>
      <div className="cta-row">
        <button type="button" className="btn-primary" onClick={onContinue}>
          {t('intro.cta')}
        </button>
      </div>
      <details className="rules-accordion">
        <summary>{t('intro.rulesIntro')}</summary>
        <ul className="rules-list">
          <li>{t('intro.rule.noItems')}</li>
          <li>{t('intro.rule.noUsableItems')}</li>
          {teamSize != null && (
            <li>{t('intro.rule.pokemonCount', { count: pokemonCountWord(teamSize, lang) })}</li>
          )}
          <li>{t('intro.rule.exclusiveStarter')}</li>
          {levelCap != null && <li>{t('intro.rule.levelCap', { cap: levelCap })}</li>}
          {levelCap != null && <li>{t('intro.rule.evoStage', { cap: levelCap })}</li>}
          {levelCap != null && <li>{t('intro.rule.moves', { max: MAX_MOVES, cap: levelCap })}</li>}
        </ul>
      </details>

      {card.mon && <PokemonDetailCard mon={card.mon} onClose={card.close} t={t} lang={lang} />}
    </div>
  );
}
