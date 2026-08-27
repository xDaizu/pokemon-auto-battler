import { useEffect, useState } from 'react';
import './styles/base.css';
import { IntroScreen } from './screens/IntroScreen';
import { TeamBuilder } from './screens/TeamBuilder';
import { BattleScreen } from './screens/BattleScreen';
import { AuthScreen } from './screens/AuthScreen';
import { LeaderBar } from './components/LeaderBar';
import { TrainerMenu } from './components/TrainerMenu';
import type { PlayerPokemonSelection } from './api/types';
import { useAuth } from './auth/AuthContext';
import { useLanguage } from './i18n/LanguageContext';
import type { Lang } from './i18n/dexNames';

type Screen = 'intro' | 'build' | 'battle';

const DEFAULT_LEADER_ID = 'brock';

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
  const [leaderId, setLeaderId] = useState(DEFAULT_LEADER_ID);

  // Losing the trainer has to reset the flow, not just hide it. Screen state
  // outlives the session otherwise, so signing back in would remount
  // BattleScreen on the previous team — running and *persisting* a second
  // battle nobody played. Keyed on `user` rather than the logout click so an
  // expired session or a different trainer resets it too.
  useEffect(() => {
    if (!user) {
      setScreen('intro');
      setSelections(null);
      setLeaderId(DEFAULT_LEADER_ID);
    }
  }, [user]);

  // A team legal for one leader isn't legal for another (different level
  // cap, team size, species pool), so a leader switch has to invalidate
  // whatever was picked under the old one - a stale `selections` reaching
  // BattleScreen would otherwise persist a battle nobody actually built (see
  // invariant 10). Bails out on a same-leader click (LeaderBar calls this
  // for the already-active leader too) so it's a true no-op, not just a
  // same-value setState.
  function selectLeader(id: string) {
    if (id === leaderId) return;
    setLeaderId(id);
    setSelections(null);
    // `selections` is what gates the 'battle' screen from rendering at all
    // (see below) - without this, a leader switch mid-battle would leave
    // the screen state stuck on 'battle' with nothing left to show.
    setScreen((s) => (s === 'battle' ? 'build' : s));
  }

  // Leaving a battle part-way is safe: the battle is a server-side write
  // that already happened when BattleScreen ran it, and the only route back
  // to that screen is a fresh `onReady` from TeamBuilder, whose selections
  // are a new array every time — so this can't re-run a recorded battle
  // (invariant 10). `selections` is left alone; `screen` is what gates the
  // battle screen from rendering, and a leader switch is what invalidates a
  // team (see `selectLeader`), not going home.
  function goHome() {
    setScreen('intro');
  }

  return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="title-bar-text">
          {/* The title doubles as the way back to the start, the way a site's
              logo does — but only once signed in: the auth screen is the only
              screen there is otherwise, so there'd be nowhere to go. Inside
              the <h1> rather than around it, since a heading isn't phrasing
              content and can't legally sit inside a button. */}
          <h1>
            {user ? (
              <button type="button" className="title-home" onClick={goHome}>
                {t('app.title')}
              </button>
            ) : (
              t('app.title')
            )}
          </h1>
        </div>
        <div className="title-bar-actions">
          {user && <TrainerMenu displayName={user.displayName} onLogout={() => void logout()} />}
          <LanguageSelector />
        </div>
      </div>

      {/* Battles are attributed to a trainer, so nothing past this point is
          reachable without one. */}
      {loading && <div className="panel">{t('auth.checkingSession')}</div>}

      {!loading && !user && <AuthScreen />}

      {!loading && user && (
        <LeaderBar activeLeaderId={leaderId} onSelect={selectLeader} disabled={screen !== 'intro'} />
      )}

      {!loading && user && screen === 'intro' && (
        <IntroScreen leaderId={leaderId} onContinue={() => setScreen('build')} />
      )}

      {!loading && user && screen === 'build' && (
        <TeamBuilder
          leaderId={leaderId}
          onBack={() => setScreen('intro')}
          onReady={(picked) => {
            setSelections(picked);
            setScreen('battle');
          }}
        />
      )}

      {!loading && user && screen === 'battle' && selections && (
        <BattleScreen leaderId={leaderId} selections={selections} onRebuild={() => setScreen('build')} />
      )}
    </div>
  );
}

export default App;
