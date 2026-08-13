import { useEffect, useState } from 'react';
import './styles/base.css';
import { IntroScreen } from './screens/IntroScreen';
import { TeamBuilder } from './screens/TeamBuilder';
import { BattleScreen } from './screens/BattleScreen';
import { AuthScreen } from './screens/AuthScreen';
import type { PlayerPokemonSelection } from './api/types';
import { useAuth } from './auth/AuthContext';
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
  const { user, loading, logout } = useAuth();
  const [screen, setScreen] = useState<Screen>('intro');
  const [selections, setSelections] = useState<PlayerPokemonSelection[] | null>(null);

  // Losing the trainer has to reset the flow, not just hide it. Screen state
  // outlives the session otherwise, so signing back in would remount
  // BattleScreen on the previous team — running and *persisting* a second
  // battle nobody played. Keyed on `user` rather than the logout click so an
  // expired session or a different trainer resets it too.
  useEffect(() => {
    if (!user) {
      setScreen('intro');
      setSelections(null);
    }
  }, [user]);

  return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="title-bar-text">
          <h1>{t('app.title')}</h1>
          <span>{t('app.subtitle')}</span>
        </div>
        <div className="title-bar-actions">
          {user && (
            <>
              <span className="trainer-name">{user.displayName}</span>
              <button type="button" className="logout-button" onClick={() => void logout()}>
                {t('app.logout')}
              </button>
            </>
          )}
          <LanguageSelector />
        </div>
      </div>

      {/* Battles are attributed to a trainer, so nothing past this point is
          reachable without one. */}
      {loading && <div className="panel">{t('auth.checkingSession')}</div>}

      {!loading && !user && <AuthScreen />}

      {!loading && user && screen === 'intro' && <IntroScreen onContinue={() => setScreen('build')} />}

      {!loading && user && screen === 'build' && (
        <TeamBuilder
          onReady={(picked) => {
            setSelections(picked);
            setScreen('battle');
          }}
        />
      )}

      {!loading && user && screen === 'battle' && selections && (
        <BattleScreen selections={selections} onRebuild={() => setScreen('build')} />
      )}
    </div>
  );
}

export default App;
