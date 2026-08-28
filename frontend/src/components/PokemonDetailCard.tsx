import { useState, type CSSProperties } from 'react';
import '../styles/pokemonCard.css';
import { spriteUrl } from '../api/client';
import type { StatId, TeamMemberSummary } from '../api/types';
import {
  statAbbr,
  translateAbilityName,
  translateNatureName,
  translateSpeciesName,
  translateType,
  type Lang,
} from '../i18n/dexNames';
import { type TranslationKey } from '../i18n/translations';

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const STAT_ORDER: StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
// Base-stat bars are scaled against 255 - Blissey's HP, the highest base stat
// in the dex - so a bar's length is comparable across any two Pokemon shown,
// not just relative to each other's own stats.
const STAT_MAX = 255;

/** Tracks which Pokemon's detail card is open, if any. One instance per
 * screen: IntroScreen and BattleScreen each hold their own, since a card
 * opened on one screen has no bearing on the other. */
export function usePokemonDetailCard() {
  const [mon, setMon] = useState<TeamMemberSummary | null>(null);
  return { mon, open: setMon, close: () => setMon(null) };
}

export function PokemonDetailCard({
  mon,
  onClose,
  t,
  lang,
}: {
  mon: TeamMemberSummary;
  onClose: () => void;
  t: T;
  lang: Lang;
}) {
  const name = translateSpeciesName(mon.name, lang);
  return (
    <div className="pokemon-card-backdrop" onClick={onClose}>
      <div className="pokemon-card" onClick={(e) => e.stopPropagation()}>
        <div className="pokemon-card-header">
          <img className="pokemon-card-sprite img-pixelated" src={spriteUrl(mon.num)} alt="" />
          <div className="pokemon-card-title">
            <h3>{name}</h3>
            <span className="pokemon-card-level">
              {t('common.levelAbbrev')}
              {mon.level}
            </span>
          </div>
          <button
            type="button"
            className="pokemon-card-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="pokemon-card-types">
          {mon.types.map((type) => (
            <span key={type} className={`type-badge type-${type.toLowerCase()}`}>
              {translateType(type, lang)}
            </span>
          ))}
        </div>

        <div className="pokemon-card-meta">
          <span>{t('teamBuilder.abilityHeading')}</span>
          <span>{translateAbilityName(mon.ability, lang)}</span>
          <span>{t('teamBuilder.natureHeading')}</span>
          <span>{mon.nature ? translateNatureName(mon.nature, lang) : t('pokemonCard.natureNeutral')}</span>
          <span>{t('pokemonCard.itemHeading')}</span>
          <span>{mon.item ?? t('pokemonCard.itemNone')}</span>
        </div>

        <div className="pokemon-card-stats">
          <div className="pokemon-card-stats-heading">{t('pokemonCard.statsHeading')}</div>
          {STAT_ORDER.map((stat) => {
            const value = mon.baseStats[stat];
            const pct = Math.min(100, Math.round((value / STAT_MAX) * 100));
            return (
              <div className="stat-row" key={stat}>
                <span className="stat-label">{statAbbr(stat, lang)}</span>
                <div className="stat-bar-track">
                  <div className="stat-bar-fill" style={{ '--stat-pct': `${pct}%` } as CSSProperties} />
                </div>
                <span className="stat-value">{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
