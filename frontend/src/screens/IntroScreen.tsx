import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import '../styles/intro.css';
import brockPortrait from '../assets/leaders/brock.png';
import { fetchRival, spriteUrl } from '../api/client';
import type { TeamSummary } from '../api/types';
import { RichText, useLanguage } from '../i18n/LanguageContext';
import { translateSpeciesName } from '../i18n/dexNames';
import { ThemeScope } from '../theme/ThemeScope';
import { typeColors } from '../theme/typeColors';

// Mirrors src/roster/roster.ts's LEVEL_CAP and TeamBuilder's MAX_MOVES; this
// screen renders before the roster is fetched, so it can't read them from
// the API response the way TeamBuilder does.
const LEVEL_CAP_DISPLAY = 13;
const MAX_MOVES_DISPLAY = 4;

export function IntroScreen({ onContinue }: { onContinue: () => void }) {
  const { t, lang } = useLanguage();
  const [rival, setRival] = useState<TeamSummary | null>(null);

  useEffect(() => {
    fetchRival().then(setRival).catch(() => undefined);
  }, []);

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
            {/* Reversed for the splash only (signature mon leads the circle
             * stack) — the roster's own order is battle team-slot order and
             * stays untouched. */}
            {[...(rival?.pokemon ?? [])].reverse().map((mon) => (
              <div
                className="mon-circle"
                key={mon.species}
                title={`${translateSpeciesName(mon.name, lang)} · ${t('common.levelAbbrev')}${mon.level}`}
              >
                <img src={spriteUrl(mon.num)} alt={mon.name} />
              </div>
            ))}
          </div>
        </div>
      </ThemeScope>

      <div className="intro-heading">
        <div className="intro-heading-box" style={rockBoxStyle}>
          <h2>{t('intro.heading')}</h2>
        </div>
      </div>
      <div className="intro-body-box">
        <p>
          <RichText text={t('intro.description')} />
        </p>
      </div>
      <details className="rules-accordion">
        <summary>{t('intro.rulesIntro')}</summary>
        <ul className="rules-list">
          <li>{t('intro.rule.noItems')}</li>
          <li>{t('intro.rule.noUsableItems')}</li>
          <li>{t('intro.rule.twoPokemon')}</li>
          <li>{t('intro.rule.exclusiveStarter')}</li>
          <li>{t('intro.rule.levelCap', { cap: LEVEL_CAP_DISPLAY })}</li>
          <li>{t('intro.rule.evoStage', { cap: LEVEL_CAP_DISPLAY })}</li>
          <li>{t('intro.rule.moves', { max: MAX_MOVES_DISPLAY, cap: LEVEL_CAP_DISPLAY })}</li>
        </ul>
      </details>

      <div className="cta-row">
        <button type="button" className="btn-primary" onClick={onContinue}>
          {t('intro.cta')}
        </button>
      </div>
    </div>
  );
}
