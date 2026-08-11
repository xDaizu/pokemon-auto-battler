import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMoveDetail, runBattle, spriteUrl } from '../api/client';
import type { BattleResult, MoveDetail, PlayerPokemonSelection, TeamMemberSummary } from '../api/types';

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

const HP_FRACTION = /^(\d+)\/(\d+)/;

function hpClass(condition: string): string {
  const m = HP_FRACTION.exec(condition);
  if (!m) return 'hp-high';
  const cur = Number(m[1]);
  const max = Number(m[2]);
  const pct = max > 0 ? cur / max : 1;
  if (pct <= 0.2) return 'hp-low';
  if (pct <= 0.5) return 'hp-mid';
  return 'hp-high';
}

function Mon({ raw, sprites }: { raw: string; sprites: Record<string, number> }) {
  const m = IDENT.exec(raw);
  if (!m) return <span className="mon-name">{raw}</span>;
  const [, side, name] = m;
  const num = sprites[name];
  return (
    <span className={`mon-name mon-${side}`}>
      {num !== undefined && <img className="log-icon" src={spriteUrl(num)} alt="" loading="lazy" />}
      {name}
    </span>
  );
}

interface HumanizedLine {
  node: ReactNode;
  className: string;
  // Root events (a Pokémon using a move, or the battle ending) start a new
  // block; everything else is a consequence of the most recent root event
  // and is rendered indented under it.
  root?: boolean;
}

function humanizeLine(
  line: string,
  sprites: Record<string, number>,
  onMoveClick: (name: string) => void,
): HumanizedLine | null {
  const parts = line.split('|');
  const cmd = parts[0] ?? '';

  if (SKIP_CMDS.has(cmd)) return null;

  switch (cmd) {
    case 'move': {
      const [, attacker, move] = parts;
      if (!attacker || !move) return null;
      return {
        root: true,
        className: 'log-line move',
        node: (
          <>
            <Mon raw={attacker} sprites={sprites} /> used{' '}
            <button type="button" className="move-link" onClick={() => onMoveClick(move)}>
              {move}
            </button>
            !
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
            It's not very effective on <Mon raw={target} sprites={sprites} />...
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
            It's super effective on <Mon raw={target} sprites={sprites} />!
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
            <Mon raw={target} sprites={sprites} /> is immune to that move.
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
            A critical hit on <Mon raw={target} sprites={sprites} />!
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
            <Mon raw={attacker} sprites={sprites} />'s attack missed!
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
            <Mon raw={target} sprites={sprites} />'s move failed!
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
            <Mon raw={target} sprites={sprites} /> {verb}. (
            <span className={hpClass(condition)}>{condition} HP</span>)
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
            <Mon raw={target} sprites={sprites} />'s {statName} {verb}!
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
            <Mon raw={target} sprites={sprites} /> was {verb}!
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
            <Mon raw={target} sprites={sprites} /> recovered from its status!
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
            <Mon raw={target} sprites={sprites} /> fainted!
          </>
        ),
      };
    }
    case 'win': {
      const winner = parts[1];
      return { root: true, className: 'log-line faint', node: `${winner} wins the battle!` };
    }
    case 'tie':
      return { root: true, className: 'log-line faint', node: 'The battle ended in a tie!' };
    default:
      return { className: 'log-line', node: line };
  }
}

function buildTurnLines(
  lines: string[],
  sprites: Record<string, number>,
  onMoveClick: (name: string) => void,
): { node: ReactNode; className: string }[] {
  const out: { node: ReactNode; className: string }[] = [];
  let sawRoot = false;
  for (const line of lines) {
    const humanized = humanizeLine(line, sprites, onMoveClick);
    if (!humanized) continue;
    // Nothing has opened a block yet in this turn, so this line becomes the
    // root even if it's normally a consequence line (e.g. weather ticking
    // before either side has moved).
    const isRoot = humanized.root === true || !sawRoot;
    sawRoot = true;
    out.push({
      node: humanized.node,
      className: isRoot ? humanized.className : `${humanized.className} log-line-sub`,
    });
  }
  return out;
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
  const [selectedMove, setSelectedMove] = useState<string | null>(null);
  const [moveCache, setMoveCache] = useState<Record<string, MoveDetail>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedMove || moveCache[selectedMove]) return;
    setMoveError(null);
    fetchMoveDetail(selectedMove)
      .then((detail) => setMoveCache((cache) => ({ ...cache, [selectedMove]: detail })))
      .catch((err) => setMoveError(err instanceof Error ? err.message : 'Failed to load move.'));
  }, [selectedMove, moveCache]);

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

  const spriteByName = useMemo(() => {
    const map: Record<string, number> = {};
    if (!result) return map;
    for (const mon of [...result.player.pokemon, ...result.rival.pokemon]) {
      map[mon.name] = mon.num;
    }
    return map;
  }, [result]);

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
        {visibleTurns.map((turn) => {
          const lines = buildTurnLines(turn.lines, spriteByName, setSelectedMove);
          return (
            <div key={turn.turn}>
              {turn.turn > 0 && <div className="log-turn-heading">— Turn {turn.turn} —</div>}
              {lines.map((l, i) => (
                <div className={l.className} key={i}>
                  {l.node}
                </div>
              ))}
            </div>
          );
        })}
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

      {selectedMove && (
        <MoveDetailModal
          name={selectedMove}
          detail={moveCache[selectedMove]}
          error={moveError}
          onClose={() => setSelectedMove(null)}
        />
      )}
    </div>
  );
}

function MoveDetailModal({
  name,
  detail,
  error,
  onClose,
}: {
  name: string;
  detail: MoveDetail | undefined;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="move-detail-backdrop" onClick={onClose}>
      <div className="move-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="move-detail-header">
          <h3>{name}</h3>
          <button type="button" className="move-detail-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {detail ? (
          <>
            <div className="move-detail-meta">
              <span className={`type-badge type-${detail.type.toLowerCase()}`}>{detail.type}</span>
              <span>{detail.category}</span>
            </div>
            <div className="move-detail-stats">
              <span>Power</span>
              <span>{detail.basePower > 0 ? detail.basePower : '—'}</span>
              <span>Accuracy</span>
              <span>{detail.accuracy === true ? '—' : `${detail.accuracy}%`}</span>
              <span>PP</span>
              <span>{detail.pp}</span>
              <span>Priority</span>
              <span>{detail.priority}</span>
            </div>
            <p className="move-detail-desc">{detail.shortDesc}</p>
          </>
        ) : error ? (
          <p className="error-msg">{error}</p>
        ) : (
          <p className="loading-msg">Loading…</p>
        )}
      </div>
    </div>
  );
}
