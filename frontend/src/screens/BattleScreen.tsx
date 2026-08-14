import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/battle.css';
import { fetchMoveDetail, runBattle, spriteUrl } from '../api/client';
import type { BattleResult, MoveDetail, MoveTargetCategory, PlayerPokemonSelection, TeamMemberSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PokemonDetailCard, usePokemonDetailCard } from '../components/PokemonDetailCard';
import { useLanguage } from '../i18n/LanguageContext';
import {
  slug,
  statFull,
  translateAbilityName,
  translateCategory,
  translateMoveDesc,
  translateMoveName,
  translateSpeciesName,
  translateType,
  translateWeatherName,
  type ExtendedStatId,
  type Lang,
} from '../i18n/dexNames';
import { type TranslationKey } from '../i18n/translations';

const FAINT_LINE = /^faint\|(p1|p2)[ab]: (.+)$/;
const IDENT = /^(p1|p2)[ab]: (.+)$/;
const AUTO_PLAY_MS = 900;

const STATUS_VERB_KEY: Record<string, TranslationKey> = {
  par: 'battle.status.par',
  brn: 'battle.status.brn',
  psn: 'battle.status.psn',
  tox: 'battle.status.tox',
  slp: 'battle.status.slp',
  frz: 'battle.status.frz',
};

/** Translated form of the fixed team labels the server assigns
 * (buildTeam.ts's playerTeam.label is 'Red', rivalTeam.label is 'Brock'),
 * used to localize the raw `|win|<label>` protocol line. The player's side
 * is shown as the logged-in trainer's display name rather than 'Red' -
 * that's the API-assigned team label, not anything the player picked. */
function translateTeamLabel(label: string, t: (key: TranslationKey) => string, playerDisplayName: string): string {
  if (label === 'Red') return playerDisplayName;
  if (label === 'Brock') return t('battle.rivalLabel');
  return label;
}

// Commands that are pure protocol setup/noise with nothing worth showing a
// player - preamble (gen/tier/poke/...), timestamps, and upkeep markers.
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

/**
 * `-damage`/`-heal` protocol lines only carry the resulting HP fraction (e.g.
 * "34/38"), not the amount that changed. Replays the whole battle in order,
 * tracking each Pokémon's last-seen HP (assumed full on first sighting) to
 * derive that delta, so the log can show "took damage (4)" instead of just
 * the post-hit fraction. Returned array mirrors `turns[].lines` shape, with
 * NaN standing in for lines the amount doesn't apply to.
 */
function computeDamageAmounts(turns: { lines: string[] }[]): number[][] {
  const lastHp = new Map<string, number>();
  return turns.map((turn) =>
    turn.lines.map((line) => {
      const parts = line.split('|');
      const cmd = parts[0];
      if (cmd !== '-damage' && cmd !== '-heal') return NaN;
      const target = parts[1];
      const condition = parts[2];
      if (!target || !condition) return NaN;
      const m = HP_FRACTION.exec(condition);
      if (!m) return NaN;
      const cur = Number(m[1]);
      const max = Number(m[2]);
      const prev = lastHp.has(target) ? lastHp.get(target)! : max;
      lastHp.set(target, cur);
      return Math.abs(prev - cur);
    }),
  );
}

interface I18n {
  lang: Lang;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  // Keyed by @pkmn/sim move id (see `slug`), from `BattleResult.moveTargets` -
  // who a move's targeting rules actually reach, so the log can spell out
  // "on Charmander" vs "on all enemies" vs "on itself" for the same `move`
  // protocol line. Absent entries (a move id the server didn't see) just
  // fall back to the single nominal target the protocol line names.
  moveTargets: Record<string, MoveTargetCategory>;
  // The logged-in trainer's display name, shown in place of the fixed
  // 'Red' team label on the `|win|` line (see `translateTeamLabel`).
  playerDisplayName: string;
}

// Categories whose description doesn't depend on the specific Pokémon
// involved - the opposite of 'normal'/'any'/etc, where the nominal target
// named on the `|move|` protocol line (parts[3]) is the right thing to show.
const TARGET_PHRASE_KEY: Partial<Record<MoveTargetCategory, TranslationKey>> = {
  self: 'battle.targetSelf',
  allies: 'battle.targetSelf',
  adjacentAlly: 'battle.targetAlly',
  allAdjacentFoes: 'battle.targetAllFoes',
  allAdjacent: 'battle.targetAllAdjacent',
  all: 'battle.targetField',
  foeSide: 'battle.targetFoeSide',
  allySide: 'battle.targetOwnSide',
  allyTeam: 'battle.targetTeam',
};

function Mon({ raw, sprites, lang }: { raw: string; sprites: Record<string, number>; lang: Lang }) {
  const m = IDENT.exec(raw);
  if (!m) return <span className="mon-name">{raw}</span>;
  const [, side, name] = m;
  const num = sprites[name];
  return (
    <span className={`mon-name mon-${side}`}>
      {num !== undefined && <img className="log-icon" src={spriteUrl(num)} alt="" loading="lazy" />}
      {translateSpeciesName(name, lang)}
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
  i18n: I18n,
  amount: number,
): HumanizedLine | null {
  const { t, lang } = i18n;
  const parts = line.split('|');
  const cmd = parts[0] ?? '';

  if (SKIP_CMDS.has(cmd)) return null;

  switch (cmd) {
    // This format has no bench - both team members start active and are
    // never swapped - so "switch" only ever fires at battle start (turn 0),
    // once per Pokemon, as each trainer sends out their pair.
    case 'switch': {
      const target = parts[1];
      if (!target) return null;
      return {
        root: true,
        className: 'log-line move',
        node: (
          <>
            <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.entersBattleSuffix')}
          </>
        ),
      };
    }
    case 'move': {
      const [, attacker, move, nominalTarget] = parts;
      if (!attacker || !move) return null;
      const category = i18n.moveTargets[slug(move)];
      const phraseKey = category && TARGET_PHRASE_KEY[category];
      const targetNode = phraseKey ? (
        t(phraseKey)
      ) : nominalTarget ? (
        <Mon raw={nominalTarget} sprites={sprites} lang={lang} />
      ) : null;
      return {
        root: true,
        className: 'log-line move',
        node: (
          <>
            <Mon raw={attacker} sprites={sprites} lang={lang} /> {t('battle.used')}{' '}
            <button type="button" className="move-link" onClick={() => onMoveClick(move)}>
              {translateMoveName(move, lang)}
            </button>
            {targetNode && (
              <>
                {' '}
                {t('battle.on')} {targetNode}
              </>
            )}
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
            {t('battle.resistedPrefix')} <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.resistedSuffix')}
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
            {t('battle.superEffectivePrefix')} <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.superEffectiveSuffix')}
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
            <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.immuneSuffix')}
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
            {t('battle.critPrefix')} <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.critSuffix')}
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
            {t('battle.missPrefix')} <Mon raw={attacker} sprites={sprites} lang={lang} />
            {t('battle.missSuffix')}
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
            {t('battle.failTargetPrefix')} <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.failTargetSuffix')}
          </>
        ) : (
          t('battle.failGeneric')
        ),
      };
    }
    case '-damage':
    case '-heal': {
      const [, target, condition] = parts;
      if (!target || !condition) return null;
      if (condition.includes('fnt')) return null; // the faint line covers this
      const suffix = cmd === '-heal'
        ? t('battle.restoredHpSuffix', { amount: Number.isNaN(amount) ? '' : amount })
        : t('battle.tookDamageSuffix', { amount: Number.isNaN(amount) ? '' : amount });
      return {
        className: cmd === '-damage' ? 'log-line damage' : 'log-line',
        node: (
          <>
            <Mon raw={target} sprites={sprites} lang={lang} />
            {suffix} (
            <span className={hpClass(condition)}>
              {condition} {t('battle.hpUnit')}
            </span>
            )
          </>
        ),
      };
    }
    case '-boost':
    case '-unboost': {
      const [, target, stat] = parts;
      if (!target || !stat) return null;
      const statName = statFull(stat as ExtendedStatId, lang);
      const verb = cmd === '-boost' ? t('battle.boostRose') : t('battle.boostFell');
      return {
        className: 'log-line',
        node:
          lang === 'es' ? (
            <>
              La {statName} de <Mon raw={target} sprites={sprites} lang={lang} /> {verb}!
            </>
          ) : (
            <>
              <Mon raw={target} sprites={sprites} lang={lang} />'s {statName} {verb}!
            </>
          ),
      };
    }
    case '-ability': {
      const [, target, ability] = parts;
      if (!target || !ability) return null;
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.abilityActivatedSuffix', { ability: translateAbilityName(ability, lang) })}
          </>
        ),
      };
    }
    case '-weather': {
      const weather = parts[1];
      // No weather name, "none", or an "[upkeep]" tag all mean this isn't a
      // fresh weather starting - just skip it rather than repeat the
      // announcement every turn the weather is still active.
      if (!weather || weather === 'none' || parts.includes('[upkeep]')) return null;
      return {
        className: 'log-line',
        node: t('battle.weatherBegins', { weather: translateWeatherName(weather, lang) }),
      };
    }
    case '-status': {
      const [, target, status] = parts;
      if (!target) return null;
      const verbKey = status && STATUS_VERB_KEY[status];
      const verb = verbKey ? t(verbKey) : t('battle.status.generic');
      return {
        className: 'log-line',
        node: (
          <>
            <Mon raw={target} sprites={sprites} lang={lang} /> {t('battle.statusWas')} {verb}!
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
            <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.curedSuffix')}
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
            <Mon raw={target} sprites={sprites} lang={lang} />
            {t('battle.faintedSuffix')}
          </>
        ),
      };
    }
    case 'win': {
      const winner = parts[1];
      return {
        root: true,
        className: 'log-line faint',
        node: `${winner ? translateTeamLabel(winner, t, i18n.playerDisplayName) : ''}${t('battle.winsSuffix')}`,
      };
    }
    case 'tie':
      return { root: true, className: 'log-line faint', node: t('battle.tieLine') };
    default:
      return { className: 'log-line', node: line };
  }
}

function buildTurnLines(
  lines: string[],
  amounts: number[],
  sprites: Record<string, number>,
  onMoveClick: (name: string) => void,
  i18n: I18n,
): { node: ReactNode; className: string }[] {
  const out: { node: ReactNode; className: string }[] = [];
  let sawRoot = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const humanized = humanizeLine(line, sprites, onMoveClick, i18n, amounts[i] ?? NaN);
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
  lang,
  t,
  onSelect,
}: {
  label: string;
  pokemon: TeamMemberSummary[];
  side: 'p1' | 'p2';
  faintedKeys: Set<string>;
  lang: Lang;
  t: I18n['t'];
  onSelect: (mon: TeamMemberSummary) => void;
}) {
  return (
    <div className="team-row">
      <span className="team-label">{label}</span>
      <div className="team-mons">
        {pokemon.map((mon) => {
          const name = translateSpeciesName(mon.name, lang);
          return (
            <button
              type="button"
              key={mon.species}
              className={`battle-mon${faintedKeys.has(`${side}:${mon.name}`) ? ' fainted' : ''}`}
              title={`${name} · ${t('common.levelAbbrev')}${mon.level}`}
              aria-label={t('pokemonCard.viewDetails', { name })}
              onClick={() => onSelect(mon)}
            >
              <img src={spriteUrl(mon.num)} alt={name} />
              <span className={`mon-${side}`}>{name}</span>
            </button>
          );
        })}
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
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  // BattleScreen only ever mounts once `user` is set (see App.tsx), so this
  // fallback is just defensive - it keeps the label sane if that invariant
  // ever slips rather than rendering 'undefined'.
  const playerDisplayName = user?.displayName ?? t('battle.playerLabel');
  const [result, setResult] = useState<BattleResult | null>(null);
  // `message: null` means "failed with nothing quotable" — the generic text is
  // resolved at render so `t` never has to be an effect dependency.
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [selectedMove, setSelectedMove] = useState<string | null>(null);
  const [moveCache, setMoveCache] = useState<Record<string, MoveDetail>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const card = usePokemonDetailCard();

  useEffect(() => {
    if (!selectedMove || moveCache[selectedMove]) return;
    setMoveError(null);
    fetchMoveDetail(selectedMove)
      .then((detail) => setMoveCache((cache) => ({ ...cache, [selectedMove]: detail })))
      .catch((err) => setMoveError(err instanceof Error ? err.message : t('battle.moveDetail.error')));
  }, [selectedMove, moveCache, t]);

  // One battle per team, exactly once. Running a battle now persists a row, so
  // a re-run doesn't just waste work — it records a second, differently-decided
  // battle for a team the trainer only played once, skewing the stats.
  // The ref covers StrictMode's double-invoke in dev; keeping `t` out of the
  // deps covers switching language mid-battle, which changes `t`'s identity.
  const battleRequested = useRef<PlayerPokemonSelection[] | null>(null);

  useEffect(() => {
    if (battleRequested.current === selections) return;
    battleRequested.current = selections;

    runBattle(selections)
      .then(setResult)
      .catch((err) => setError({ message: err instanceof Error ? err.message : null }));
  }, [selections]);

  // Deliberate re-run of the same team, triggered only by the player
  // clicking "Fight Again" - unlike the effect above (which guards against
  // accidentally re-running the same battle), this is meant to record a
  // second, freshly-decided battle for the same team.
  function rematch() {
    setResult(null);
    setError(null);
    setRevealed(0);
    setAutoPlay(true);
    setSelectedMove(null);
    runBattle(selections)
      .then(setResult)
      .catch((err) => setError({ message: err instanceof Error ? err.message : null }));
  }

  const maxTurn = result ? result.turns.length - 1 : 0;

  useEffect(() => {
    if (!autoPlay || !result || revealed >= maxTurn) return;
    const id = setTimeout(() => setRevealed((r) => Math.min(r + 1, maxTurn)), AUTO_PLAY_MS);
    return () => clearTimeout(id);
  }, [autoPlay, revealed, maxTurn, result]);

  useEffect(() => {
    logRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
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

  // Per-turn, per-line damage/heal amounts, derived once for the whole
  // battle so the running HP tracker inside computeDamageAmounts sees every
  // turn in order regardless of how many are currently revealed.
  const damageAmounts = useMemo(() => (result ? computeDamageAmounts(result.turns) : []), [result]);

  const battleOver = !!result && revealed >= maxTurn;

  if (error) {
    return (
      <div className="panel">
        <p className="error-msg">{error.message ?? t('battle.runFailed')}</p>
        <div className="cta-row">
          <button type="button" className="btn-secondary" onClick={rematch}>
            {t('battle.rematch')}
          </button>
          <button type="button" className="btn-secondary" onClick={onRebuild}>
            {t('battle.backToBuilder')}
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    return <div className="panel loading-msg">{t('battle.loading')}</div>;
  }

  const visibleTurns = result.turns.slice(0, revealed + 1);

  return (
    <div className="panel">
      <div className="battle-header">
        <TeamRow
          label={playerDisplayName}
          pokemon={result.player.pokemon}
          side="p1"
          faintedKeys={faintedKeys}
          lang={lang}
          t={t}
          onSelect={card.open}
        />
        <span className="vs-mark">VS</span>
        <TeamRow
          label={t('battle.rivalLabel')}
          pokemon={result.rival.pokemon}
          side="p2"
          faintedKeys={faintedKeys}
          lang={lang}
          t={t}
          onSelect={card.open}
        />
      </div>

      <div className="log-panel" ref={logRef}>
        {visibleTurns.map((turn, turnIndex) => {
          const lines = buildTurnLines(
            turn.lines,
            damageAmounts[turnIndex] ?? [],
            spriteByName,
            setSelectedMove,
            { t, lang, moveTargets: result.moveTargets, playerDisplayName },
          );
          if (lines.length === 0) return null;
          return (
            <div className="log-turn" key={turn.turn}>
              <div className="log-turn-heading">
                {turn.turn > 0 ? t('battle.turnHeading', { n: turn.turn }) : t('battle.turnHeading0')}
              </div>
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
            {t('battle.nextTurn')}
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
            {t('battle.skipToEnd')}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={battleOver}
            onClick={() => setAutoPlay((v) => !v)}
          >
            {autoPlay ? t('battle.pause') : t('battle.play')}
          </button>
        </div>
        <button type="button" className="btn-secondary" disabled={!battleOver} onClick={rematch}>
          {t('battle.rematch')}
        </button>
        <button type="button" className="btn-secondary" onClick={onRebuild}>
          {t('battle.newTeam')}
        </button>
      </div>

      {battleOver && (
        <div
          className={`result-banner ${
            result.outcome === 'tie' ? 'tie' : result.outcome === 'player' ? 'win' : 'lose'
          }`}
        >
          {result.outcome === 'tie'
            ? t('battle.outcome.tie')
            : result.outcome === 'player'
              ? t('battle.outcome.win')
              : t('battle.outcome.lose')}
        </div>
      )}

      {selectedMove && (
        <MoveDetailModal
          name={selectedMove}
          detail={moveCache[selectedMove]}
          error={moveError}
          onClose={() => setSelectedMove(null)}
          t={t}
          lang={lang}
        />
      )}

      {card.mon && <PokemonDetailCard mon={card.mon} onClose={card.close} t={t} lang={lang} />}
    </div>
  );
}

function MoveDetailModal({
  name,
  detail,
  error,
  onClose,
  t,
  lang,
}: {
  name: string;
  detail: MoveDetail | undefined;
  error: string | null;
  onClose: () => void;
  t: I18n['t'];
  lang: Lang;
}) {
  return (
    <div className="move-detail-backdrop" onClick={onClose}>
      <div className="move-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="move-detail-header">
          <h3>{translateMoveName(detail?.name ?? name, lang)}</h3>
          <button
            type="button"
            className="move-detail-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        {detail ? (
          <>
            <div className="move-detail-meta">
              <span className={`type-badge type-${detail.type.toLowerCase()}`}>
                {translateType(detail.type, lang)}
              </span>
              <span>{translateCategory(detail.category, lang)}</span>
            </div>
            <div className="move-detail-stats">
              <span>{t('battle.moveDetail.power')}</span>
              <span>{detail.basePower > 0 ? detail.basePower : '—'}</span>
              <span>{t('battle.moveDetail.accuracy')}</span>
              <span>{detail.accuracy === true ? '—' : `${detail.accuracy}%`}</span>
              <span>{t('battle.moveDetail.pp')}</span>
              <span>{detail.pp}</span>
              <span>{t('battle.moveDetail.priority')}</span>
              <span>{detail.priority}</span>
            </div>
            <p className="move-detail-desc">{translateMoveDesc(detail.name, detail.shortDesc, lang)}</p>
          </>
        ) : error ? (
          <p className="error-msg">{error}</p>
        ) : (
          <p className="loading-msg">{t('common.loading')}</p>
        )}
      </div>
    </div>
  );
}
