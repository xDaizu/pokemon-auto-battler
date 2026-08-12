import { useEffect, useState } from 'react';
import { fetchRival, spriteUrl } from '../api/client';
import type { TeamSummary } from '../api/types';
import { RichText, useLanguage } from '../i18n/LanguageContext';
import { translateSpeciesName } from '../i18n/dexNames';

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

  return (
    <div className="panel intro">
      <h2>{t('intro.heading')}</h2>
      <p>
        <RichText text={t('intro.description')} />
      </p>
      <p>{t('intro.rulesIntro')}</p>

      <ul className="rules-list">
        <li>{t('intro.rule.noItems')}</li>
        <li>{t('intro.rule.noUsableItems')}</li>
        <li>{t('intro.rule.twoPokemon')}</li>
        <li>{t('intro.rule.exclusiveStarter')}</li>
        <li>{t('intro.rule.levelCap', { cap: LEVEL_CAP_DISPLAY })}</li>
        <li>{t('intro.rule.evoStage', { cap: LEVEL_CAP_DISPLAY })}</li>
        <li>{t('intro.rule.moves', { max: MAX_MOVES_DISPLAY, cap: LEVEL_CAP_DISPLAY })}</li>
      </ul>

      <div className="rival-preview">
        <span className="rival-label">{t('intro.rivalLabel')}</span>
        <div className="rival-mons">
          {(rival?.pokemon ?? []).map((mon) => (
            <div className="mon-chip" key={mon.species}>
              <img src={spriteUrl(mon.num)} alt={mon.name} />
              <span>
                {translateSpeciesName(mon.name, lang)} · {t('common.levelAbbrev')}
                {mon.level}
              </span>
            </div>
          ))}
          {!rival && <span className="mon-chip">...</span>}
        </div>
      </div>

      <div className="cta-row">
        <button type="button" className="btn-primary" onClick={onContinue}>
          {t('intro.cta')}
        </button>
      </div>
    </div>
  );
}
