import { useEffect, useMemo, useRef, useState } from 'react';
import { runBattle, spriteUrl } from '../api/client';
import type { BattleResult, PlayerPokemonSelection, TeamMemberSummary } from '../api/types';

const FAINT_LINE = /^faint\|(p1|p2)[ab]: (.+)$/;
const AUTO_PLAY_MS = 900;

function lineClass(line: string): string {
  if (/^faint\|/.test(line)) return 'log-line faint';
  if (/^-damage\|/.test(line)) return 'log-line damage';
  if (/^move\|/.test(line)) return 'log-line move';
  return 'log-line';
}

function TeamRow({
  label,
  pokemon,
  side,
  faintedKeys,
}: {
  label: string;
  pokemon: TeamMemberSummary[];
  side: 'p1' | 'p2';
  faintedKeys: Set<string>;
}) {
  return (
    <div className="team-row">
      <span className="team-label">{label}</span>
      <div className="team-mons">
        {pokemon.map((mon) => (
          <div
            key={mon.species}
            className={`battle-mon${faintedKeys.has(`${side}:${mon.name}`) ? ' fainted' : ''}`}
          >
            <img src={spriteUrl(mon.num)} alt={mon.name} />
            <span>{mon.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BattleScreen({
  selections,
  onRebuild,
}: {
  selections: PlayerPokemonSelection[];
  onRebuild: () => void;
}) {
  const [result, setResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    runBattle(selections)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Battle failed to run.'));
  }, [selections]);

  const maxTurn = result ? result.turns.length - 1 : 0;

  useEffect(() => {
    if (!autoPlay || !result || revealed >= maxTurn) return;
    const id = setTimeout(() => setRevealed((r) => Math.min(r + 1, maxTurn)), AUTO_PLAY_MS);
    return () => clearTimeout(id);
  }, [autoPlay, revealed, maxTurn, result]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [revealed]);

  const faintedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!result) return keys;
    for (const turn of result.turns.slice(0, revealed + 1)) {
      for (const line of turn.lines) {
        const m = FAINT_LINE.exec(line);
        if (m) keys.add(`${m[1]}:${m[2]}`);
      }
    }
    return keys;
  }, [result, revealed]);

  const battleOver = !!result && revealed >= maxTurn;

  if (error) {
    return (
      <div className="panel">
        <p className="error-msg">{error}</p>
        <div className="cta-row">
          <button type="button" className="btn-secondary" onClick={onRebuild}>
            Back to Team Builder
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    return <div className="panel loading-msg">Brock is sending out his team…</div>;
  }

  const visibleTurns = result.turns.slice(0, revealed + 1);

  return (
    <div className="panel">
      <div className="battle-header">
        <TeamRow label="Red" pokemon={result.player.pokemon} side="p1" faintedKeys={faintedKeys} />
        <span className="vs-mark">VS</span>
        <TeamRow label="Brock" pokemon={result.rival.pokemon} side="p2" faintedKeys={faintedKeys} />
      </div>

      <div className="log-panel" ref={logRef}>
        {visibleTurns.map((turn) => (
          <div key={turn.turn}>
            {turn.turn > 0 && <div className="log-turn-heading">— Turn {turn.turn} —</div>}
            {turn.lines.map((line, i) => (
              <div className={lineClass(line)} key={i}>
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="battle-controls">
        <div className="buttons">
          <button
            type="button"
            className="btn-secondary"
            disabled={revealed >= maxTurn}
            onClick={() => {
              setAutoPlay(false);
              setRevealed((r) => Math.min(r + 1, maxTurn));
            }}
          >
            Next Turn
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={battleOver}
            onClick={() => {
              setAutoPlay(false);
              setRevealed(maxTurn);
            }}
          >
            Skip to End
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={battleOver}
            onClick={() => setAutoPlay((v) => !v)}
          >
            {autoPlay ? 'Pause' : 'Play'}
          </button>
        </div>
        <button type="button" className="btn-secondary" onClick={onRebuild}>
          Build a New Team
        </button>
      </div>

      {battleOver && (
        <div
          className={`result-banner ${
            result.tie ? 'tie' : result.winner === result.player.label ? 'win' : 'lose'
          }`}
        >
          {result.tie
            ? 'The battle ended in a tie.'
            : result.winner === result.player.label
              ? 'You defeated Brock!'
              : 'Brock defeated your team.'}
        </div>
      )}
    </div>
  );
}
