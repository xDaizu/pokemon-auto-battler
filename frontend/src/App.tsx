import { useState } from 'react';
import './App.css';
import { IntroScreen } from './screens/IntroScreen';
import { TeamBuilder } from './screens/TeamBuilder';
import { BattleScreen } from './screens/BattleScreen';
import type { PlayerPokemonSelection } from './api/types';

type Screen = 'intro' | 'build' | 'battle';

function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [selections, setSelections] = useState<PlayerPokemonSelection[] | null>(null);

  return (
    <div className="app-shell">
      <div className="title-bar">
        <h1>Pewter Gym Challenge</h1>
        <span>Red vs. Brock</span>
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
