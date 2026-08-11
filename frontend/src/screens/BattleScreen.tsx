import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { runBattle, spriteUrl } from '../api/client';
import type { BattleResult, PlayerPokemonSelection, TeamMemberSummary } from '../api/types';

const FAINT_LINE = /^faint\|(p1|p2)[ab]: (.+)$/;
const IDENT = /^(p1|p2)[ab]: (.+)$/;
const AUTO_PLAY_MS = 900;

const STAT_NAMES: Record<string, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
};

const STATUS_VERBS: Record<string, string> = {
  par: 'paralyzed',
  brn: 'burned',
  psn: 'poisoned',
  tox: 'badly poisoned',
  slp: 'put to sleep',
  frz: 'frozen solid',
};

// Commands that are pure protocol setup/noise with nothing worth showing a
// player - preamble (gen/tier/poke/...), timestamps, and upkeep markers.
// "switch" is included because this format has no bench: both team members
// start active and are never swapped, so it only ever fires once per side
// at battle start, which the team header above the log already conveys.
const SKIP_CMDS = new Set([
  't:',
  'gametype',
  'player',
  'gen',
  'tier',
  'clearpoke',
  'poke',
  'teampreview',
  'teamsize',
  'start',
  'rule',
  'upkeep',
  'switch',
]);

function Mon({ raw }: { raw: string }) {
  const m = IDENT.exec(raw);
  if (!m) return <span className="mon-name">{raw}</span>;
  const [, side, name] = m;
  return <span className={`mon-name mon-${side}`}>{name}</span>;
}

function humanizeLine(line: string): { node: ReactNode; className: string } | null {
  const parts = line.split('|');
  const cmd = parts[0] ?? '';

  if (SKIP_CMDS.has(cmd)) return null;

  switch (cmd) {
    case 'move': {
      const [, attacker, move] = parts;
      if (!attacker || !move) return null;
      return {
        className: 'log-line move',
        node: (
          <>
            <Mon raw={attacker} /> used <strong>{move}</strong>!
          </>
        ),
      };
    }
    case '-resisted': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line',
        node: (
          <>
            It's not very effective on <Mon raw={target} />...
          </>
        ),
      };
    }
    case '-supereffective': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line',
        node: (
          <>
            It's super effective on <Mon raw={target} />!
          </>
        ),
      };
    }
    case '-immune': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} /> is immune to that move.
          </>
        ),
      };
    }
    case '-crit': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line',
        node: (
          <>
            A critical hit on <Mon raw={target} />!
          </>
        ),
      };
    }
    case '-miss': {
      const attacker = parts[1];
      if (!attacker) return null;
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={attacker} />'s attack missed!
          </>
        ),
      };
    }
    case '-fail': {
      const target = parts[1];
      return {
        className: 'log-line',
        node: target ? (
          <>
            <Mon raw={target} />'s move failed!
          </>
        ) : (
          'But it failed!'
        ),
      };
    }
    case '-damage':
    case '-heal': {
      const [, target, condition] = parts;
      if (!target || !condition) return null;
      if (condition.includes('fnt')) return null; // the faint line covers this
      const verb = cmd === '-heal' ? 'restored HP' : 'took damage';
      return {
        className: cmd === '-damage' ? 'log-line damage' : 'log-line',
        node: (
          <>
            <Mon raw={target} /> {verb}. ({condition} HP)
          </>
        ),
      };
    }
    case '-boost':
    case '-unboost': {
      const [, target, stat] = parts;
      if (!target || !stat) return null;
      const statName = STAT_NAMES[stat] ?? stat;
      const verb = cmd === '-boost' ? 'rose' : 'fell';
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} />'s {statName} {verb}!
          </>
        ),
      };
    }
    case '-status': {
      const [, target, status] = parts;
      if (!target) return null;
      const verb = (status && STATUS_VERBS[status]) ?? 'afflicted with a status condition';
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} /> was {verb}!
          </>
        ),
      };
    }
    case '-curestatus': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} /> recovered from its status!
          </>
        ),
      };
    }
    case 'faint': {
      const target = parts[1];
      if (!target) return null;
      return {
        className: 'log-line faint',
        node: (
          <>
            <Mon raw={target} /> fainted!
          </>
        ),
      };
    }
    case 'win': {
      const winner = parts[1];
      return { className: 'log-line faint', node: `${winner} wins the battle!` };
    }
    case 'tie':
      return { className: 'log-line faint', node: 'The battle ended in a tie!' };
    default:
      return { className: 'log-line', node: line };
  }
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
            <span className={`mon-${side}`}>{mon.name}</span>
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
            {turn.lines.map((line, i) => {
              const humanized = humanizeLine(line);
              if (!humanized) return null;
              return (
                <div className={humanized.className} key={i}>
                  {humanized.node}
                </div>
              );
            })}
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
            result.outcome === 'tie' ? 'tie' : result.outcome === 'player' ? 'win' : 'lose'
          }`}
        >
          {result.outcome === 'tie'
            ? 'The battle ended in a tie.'
            : result.outcome === 'player'
              ? 'You defeated Brock!'
              : 'Brock defeated your team.'}
        </div>
      )}
    </div>
  );
}
