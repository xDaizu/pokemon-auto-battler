import { useEffect, useState } from 'react';
import { fetchRival, spriteUrl } from '../api/client';
import type { TeamSummary } from '../api/types';

export function IntroScreen({ onContinue }: { onContinue: () => void }) {
  const [rival, setRival] = useState<TeamSummary | null>(null);

  useEffect(() => {
    fetchRival().then(setRival).catch(() => undefined);
  }, []);

  return (
    <div className="panel intro">
      <h2>You are Red.</h2>
      <p>
        You've made it to the Pewter Gym. Waiting inside is <strong>Brock</strong>, the Rock-type
        Gym Leader — tough, patient, and about to test whether your team can actually take a hit.
      </p>
      <p>Build your team before you walk in. The rules are strict:</p>

      <ul className="rules-list">
        <li>No held items</li>
        <li>No usable items during battle</li>
        <li>Two Pokémon only</li>
        <li>Some Pokémon are mutually exclusive — you can only ever have one starter</li>
        <li>Level cap: 13</li>
        <li>Pick any evolution stage legal at level 13</li>
        <li>Pick any 4 moves legal at level 13</li>
      </ul>

      <div className="rival-preview">
        <span className="rival-label">Gym Leader Brock</span>
        <div className="rival-mons">
          {(rival?.pokemon ?? []).map((mon) => (
            <div className="mon-chip" key={mon.species}>
              <img src={spriteUrl(mon.num)} alt={mon.name} />
              <span>
                {mon.name} · L{mon.level}
              </span>
            </div>
          ))}
          {!rival && <span className="mon-chip">...</span>}
        </div>
      </div>

      <div className="cta-row">
        <button type="button" className="btn-primary" onClick={onContinue}>
          Build Your Team
        </button>
      </div>
    </div>
  );
}
