import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import '../styles/intro.css';
import { fetchLeaders, fetchRival, spriteUrl } from '../api/client';
import type { LeaderSummary, RivalResponse } from '../api/types';
import { PokemonDetailCard, usePokemonDetailCard } from '../components/PokemonDetailCard';
import { RichText, useLanguage } from '../i18n/LanguageContext';
import { translateSpeciesName, type Lang } from '../i18n/dexNames';
import { leaderThemes } from '../theme/leaderThemes';
import { ThemeScope } from '../theme/ThemeScope';
import { typeColors } from '../theme/typeColors';

// Hardcoded until M7 threads the picked leader in as a prop - the intro
// screen only ever shows Brock until then.
const LEADER_ID = 'brock';

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
      .then((res) => setLeader(res.leaders.find((l) => l.id === LEADER_ID) ?? null))
      .catch(() => undefined);
  }, []);

  const splashMons = rival ? orderForSplash(rival.pokemon, rival.aceIndex) : [];
  const teamSize = leader?.teamSize;
  const levelCap = leader?.levelCap;

  const theme = leaderThemes[LEADER_ID];

  // Leader's thematic type swatch (see theme/typeColors.ts) fills the
  // Persona-3-style shadow silhouette below — Brock's type, not the Dark type.
  const shadowStyle: CSSProperties = {
    backgroundColor: typeColors[theme.typeKey]?.dark,
    WebkitMaskImage: `url(${theme.portrait})`,
    maskImage: `url(${theme.portrait})`,
  };

  // Same thematic swatch, this time for the heading's comic-panel box.
  const typeBoxStyle: CSSProperties = {
    backgroundColor: typeColors[theme.typeKey]?.regular,
    borderColor: typeColors[theme.typeKey]?.dark,
  };

  // Feeds `theme.portraitMetrics` to intro.css as CSS custom properties,
  // replacing the numbers it used to hardcode for Brock's art alone.
  const splashStyle = {
    '--leader-portrait-width': `${theme.portraitMetrics.width}px`,
    '--leader-portrait-reserved-height': `${theme.portraitMetrics.reservedHeight}px`,
    '--leader-portrait-offset-top': `${theme.portraitMetrics.offsetTop}px`,
  } as CSSProperties;

  return (
    <div className="panel intro">
      <ThemeScope leaderId={LEADER_ID}>
        <div className="leader-splash" style={splashStyle}>
          <h1 className="leader-splash-title">{t('leader.brock.splashTitle')}</h1>
          <div className="leader-splash-portrait">
            <div className="leader-splash-shadow" style={shadowStyle} aria-hidden="true" />
            <img className="leader-splash-sprite" src={theme.portrait} alt={t('leader.brock.rivalLabel')} />
          </div>
          <div className="leader-splash-mons">
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
        <div className="intro-heading-box" style={typeBoxStyle}>
          <img className="intro-heading-badge" src={theme.badge} alt="" aria-hidden="true" />
          <h2>{t('leader.brock.heading')}</h2>
        </div>
      </div>
      <div className="intro-body-box">
        <p>
          <RichText text={t('leader.brock.description')} />
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
