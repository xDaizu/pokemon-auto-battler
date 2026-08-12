import { useState } from 'react';
import './App.css';
import { IntroScreen } from './screens/IntroScreen';
import { TeamBuilder } from './screens/TeamBuilder';
import { BattleScreen } from './screens/BattleScreen';
import type { PlayerPokemonSelection } from './api/types';
import { useLanguage } from './i18n/LanguageContext';
import type { Lang } from './i18n/dexNames';

type Screen = 'intro' | 'build' | 'battle';

function LanguageSelector() {
  const { lang, setLang } = useLanguage();
  return (
    <select
      className="language-select"
      aria-label="Language"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
    >
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  );
}

function App() {
  const { t } = useLanguage();
  const [screen, setScreen] = useState<Screen>('intro');
  const [selections, setSelections] = useState<PlayerPokemonSelection[] | null>(null);

  return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="title-bar-text">
          <h1>{t('app.title')}</h1>
          <span>{t('app.subtitle')}</span>
        </div>
        <LanguageSelector />
      </div>

      {screen === 'intro' && <IntroScreen onContinue={() => setScreen('build')} />}

      {screen === 'build' && (
        <TeamBuilder
          onReady={(picked) => {
            setSelections(picked);
            setScreen('battle');
          }}
        />
      )}

      {screen === 'battle' && selections && (
        <BattleScreen selections={selections} onRebuild={() => setScreen('build')} />
      )}
    </div>
  );
}

export default App;
