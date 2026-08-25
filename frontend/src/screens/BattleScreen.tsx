import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/battle.css';
import { fetchMoveDetail, runBattle, spriteUrl, submitMoveSuggestion } from '../api/client';
import type { BattleResult, MoveDetail, MoveTargetCategory, PlayerPokemonSelection, TeamMemberSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  buildFlatMoveIndex,
  classifyLine,
  DEFAULT_SPEED,
  FALLBACK_TURN_MS,
  turnProgressForFlatIndex,
} from '../battle/replayLog';
import { PokemonDetailCard, usePokemonDetailCard } from '../components/PokemonDetailCard';
import { ShowdownReplayEmbed, type ReplayHandle } from '../components/ShowdownReplayEmbed';
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

/** What the playback clock is doing. Playback runs at one fixed speed
 * (`DEFAULT_SPEED`), so this no longer has to carry a pace with it. */
type PlaybackMode = 'paused' | 'playing';

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
}

// Identifies the exact `|move|...` protocol line a "report" click was made
// on, so the suggestion can be attributed to it server-side. `description` is
// a plain-text, already-translated rendering of the line, shown as read-only
// context in the report modal - never sent to the server (only `rawLine`,
// which is canonical English/dex-id text, is persisted; see
// docs/ARCHITECTURE.md §12 invariant 8).
interface MoveReportContext {
  turn: number;
  lineIndex: number;
  rawLine: string;
  description: string;
}

/** Plain-text (no icon) translated Pokémon name for a `p1a: Name`-style
 * identifier, for contexts that can't render the `<Mon>` JSX component. */
function plainMonName(raw: string, lang: Lang): string {
  const m = IDENT.exec(raw);
  return m ? translateSpeciesName(m[2]!, lang) : raw;
}

/** Plain-text equivalent of the `move` case's JSX below, for the report
 * modal's read-only context line. */
function describeMoveLine(
  attacker: string,
  move: string,
  nominalTarget: string | undefined,
  category: MoveTargetCategory | undefined,
  i18n: I18n,
): string {
  const { t, lang } = i18n;
  const attackerName = plainMonName(attacker, lang);
  const moveName = translateMoveName(move, lang);
  const phraseKey = category && TARGET_PHRASE_KEY[category];
  const targetText = phraseKey ? t(phraseKey) : nominalTarget ? plainMonName(nominalTarget, lang) : null;
  return targetText
    ? `${attackerName} ${t('battle.used')} ${moveName} ${t('battle.on')} ${targetText}!`
    : `${attackerName} ${t('battle.used')} ${moveName}!`;
}

function humanizeLine(
  line: string,
  sprites: Record<string, number>,
  onMoveClick: (name: string) => void,
  i18n: I18n,
  amount: number,
  turnNumber: number,
  lineIndex: number,
  // Absent when the battle wasn't persisted (see `BattleApiResponse.battleId`)
  // - there's no `battles` row for a suggestion to reference, so the report
  // action is hidden rather than opening a modal that can only fail to submit.
  onReportMove: ((context: MoveReportContext) => void) | undefined,
): HumanizedLine | null {
  const { t, lang } = i18n;
  const parts = line.split('|');
  const cmd = parts[0] ?? '';

  if (classifyLine(line) === 'skip') return null;

  switch (cmd) {
    // This format has no bench - both team members start active and are
    // never swapped - so "switch" only ever fires at battle start (turn 0),
    // once per Pokemon, as each trainer sends out their pair.
    case 'switch': {
      const target = parts[1];
      if (!target) return null;
      return {
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
            {onReportMove && (
              <button
                type="button"
                className="report-move-btn"
                title={t('battle.reportMove.button')}
                aria-label={t('battle.reportMove.button')}
                onClick={() =>
                  onReportMove({
                    turn: turnNumber,
                    lineIndex,
                    rawLine: line,
                    description: describeMoveLine(attacker, move, nominalTarget, category, i18n),
                  })
                }
              >
                🚩
              </button>
            )}
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
        className: 'log-line faint',
        node: `${winner ? translateTeamLabel(winner, t, i18n.playerDisplayName) : ''}${t('battle.winsSuffix')}`,
      };
    }
    case 'tie':
      return { className: 'log-line faint', node: t('battle.tieLine') };
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
  turnNumber: number,
  onReportMove: ((context: MoveReportContext) => void) | undefined,
): { node: ReactNode; className: string }[] {
  const out: { node: ReactNode; className: string }[] = [];
  let sawRoot = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const humanized = humanizeLine(line, sprites, onMoveClick, i18n, amounts[i] ?? NaN, turnNumber, i, onReportMove);
    if (!humanized) continue;
    // Which commands open a block is decided once, in replayLog's ROOT_CMDS,
    // so the log's indentation and the step controls' move boundaries can't
    // disagree. The "nothing has opened a block yet" fallback stays here
    // rather than in `rootLineIndices` because it has to count *rendered*
    // lines: humanizeLine drops some lines entirely (a `-damage` that the
    // following faint line already covers, say), and one of those must not
    // consume the promotion the first visible line is owed.
    const isRoot = classifyLine(line) === 'root' || !sawRoot;
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
  // How many raw protocol lines have resolved - a flat cursor into the exact
  // sequence `buildRawLog` emits, which is the same sequence (and the same
  // indexing) as the widget's own `battle.currentStep`. Line-granular rather
  // than turn-granular because a move ends wherever the battle put it, which
  // is usually mid-turn; see `buildFlatMoveIndex`.
  const [revealedLine, setRevealedLine] = useState(0);
  const [mode, setMode] = useState<PlaybackMode>('playing');
  // Once the embedded scene reports itself ready, it becomes the playback
  // clock (see `onLineChange` below) and the fallback timer further down
  // stands down. Stays false - and the fallback keeps driving the log
  // on its own - if the widget's CDN is ever unreachable.
  const [embedReady, setEmbedReady] = useState(false);
  const replayRef = useRef<ReplayHandle>(null);
  const [selectedMove, setSelectedMove] = useState<string | null>(null);
  const [moveCache, setMoveCache] = useState<Record<string, MoveDetail>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const [reportContext, setReportContext] = useState<MoveReportContext | null>(null);
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
    setRevealedLine(0);
    setMode('playing');
    // A fresh <ShowdownReplayEmbed> mounts for the new result and reports
    // ready on its own timeline - if this weren't reset, the fallback timer
    // below would stay wrongly disabled for the gap until it does.
    setEmbedReady(false);
    setSelectedMove(null);
    setReportContext(null);
    runBattle(selections)
      .then(setResult)
      .catch((err) => setError({ message: err instanceof Error ? err.message : null }));
  }

  // Drives both playback clocks (the widget, once ready, and the fallback
  // timer below) from a single call, so no control has to remember the two
  // paths separately. Setting `mode` alone is enough for the fallback path -
  // the timer effect re-reads it on every tick - but the widget needs to be
  // told explicitly, since it's driven imperatively rather than by a render.
  function applyMode(next: PlaybackMode) {
    setMode(next);
    if (!embedReady) return;
    if (next === 'paused') replayRef.current?.pause();
    else replayRef.current?.play();
  }

  const flatIndex = useMemo(() => (result ? buildFlatMoveIndex(result.turns) : null), [result]);
  const totalLines = flatIndex?.totalLines ?? 0;
  const battleOver = !!result && revealedLine >= totalLines;

  // How much of the log is on screen: whole turns up to `lastVisibleTurnIndex`,
  // and the first `visibleLinesInLastTurn` lines of that one. The last turn is
  // routinely partial now - a step stops where its move ended, not where the
  // turn did.
  const { lastVisibleTurnIndex, visibleLinesInLastTurn } = useMemo(
    () =>
      result && flatIndex
        ? turnProgressForFlatIndex(flatIndex, result.turns, revealedLine)
        : { lastVisibleTurnIndex: -1, visibleLinesInLastTurn: 0 },
    [result, flatIndex, revealedLine],
  );

  // The send-out bucket is shown in full the moment the battle loads, rather
  // than waiting on whichever clock takes over - the widget's ready-poll is
  // ~150ms away at best, and the fallback timer a full tick, either of which
  // would leave the log visibly blank under an already-drawn battlefield.
  useEffect(() => {
    if (!flatIndex) return;
    setRevealedLine((r) => Math.max(r, flatIndex.turnLinesStart[1] ?? flatIndex.totalLines));
  }, [flatIndex]);

  // Fallback only: once the embedded scene is ready, `onLineChange` below
  // drives `revealedLine` instead, in lockstep with the scene's own pace
  // rather than a fixed interval. This keeps working unchanged if the scene
  // never becomes ready (CDN unreachable) - a degraded feature, not a broken
  // one. Paced per *turn*, not per line: there's no animation to keep step
  // with here, and ticking every line would race through the log.
  useEffect(() => {
    if (embedReady || mode === 'paused' || !result || !flatIndex || revealedLine >= totalLines) return;
    const id = setTimeout(() => {
      setRevealedLine((r) => {
        const { lastVisibleTurnIndex: current } = turnProgressForFlatIndex(flatIndex, result.turns, r);
        return flatIndex.turnLinesStart[current + 2] ?? totalLines;
      });
    }, FALLBACK_TURN_MS[DEFAULT_SPEED]);
    return () => clearTimeout(id);
  }, [embedReady, mode, revealedLine, totalLines, result, flatIndex]);

  // Belt-and-braces for both clocks: the widget path already pauses itself
  // via `onEnded` below, but this catches the fallback path too (which has
  // no such event) and reads as correct either way - once there's nothing
  // left to reveal, the clock is stopped, not left silently "running".
  useEffect(() => {
    if (battleOver) setMode('paused');
  }, [battleOver]);

  useEffect(() => {
    logRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [revealedLine]);

  // Only counts faints among lines actually revealed - otherwise a Pokémon
  // greys out in the header before the animation that faints it has played.
  const faintedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!result) return keys;
    for (let t = 0; t <= lastVisibleTurnIndex; t++) {
      const turn = result.turns[t]!;
      const lines = t === lastVisibleTurnIndex ? turn.lines.slice(0, visibleLinesInLastTurn) : turn.lines;
      for (const line of lines) {
        const m = FAINT_LINE.exec(line);
        if (m) keys.add(`${m[1]}:${m[2]}`);
      }
    }
    return keys;
  }, [result, lastVisibleTurnIndex, visibleLinesInLastTurn]);

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

  const visibleTurns = result.turns.slice(0, lastVisibleTurnIndex + 1);

  return (
    <div className="panel">
      <div className="battle-stage">
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

        <ShowdownReplayEmbed
          turns={result.turns}
          ref={replayRef}
          onReady={() => setEmbedReady(true)}
          onLineChange={setRevealedLine}
          // Belt-and-braces alongside ShowdownReplayEmbed's own onLineChange
          // catch-up: forces the cursor to the very end rather than trusting
          // the widget's own count to land on exactly `totalLines` - this is
          // the one moment (the battle is over) where a discrepancy would
          // otherwise strand `battleOver` permanently false.
          onEnded={() => {
            setRevealedLine(totalLines);
            setMode('paused');
          }}
        />

        <div className="battle-controls">
          <div className="buttons">
            {/* One-directional, unlike Play - it stops the battle and then
                stays lit and un-clickable until something else starts it
                again, which is what "is on if the battle is not playing"
                asks for. */}
            <button
              type="button"
              className={`btn-icon${mode !== 'playing' ? ' active' : ''}`}
              disabled={mode !== 'playing'}
              title={t('battle.pause')}
              aria-label={t('battle.pause')}
              aria-pressed={mode !== 'playing'}
              onClick={() => applyMode('paused')}
            >
              ⏸
            </button>
            <button
              type="button"
              className="btn-icon"
              disabled={battleOver || mode !== 'paused'}
              title={t('battle.step')}
              aria-label={t('battle.step')}
              onClick={() => {
                applyMode('paused');
                if (embedReady) replayRef.current?.seekBy(1);
                else setRevealedLine(flatIndex?.turnLinesStart[lastVisibleTurnIndex + 2] ?? totalLines);
              }}
            >
              ⏭
            </button>
            <button
              type="button"
              className={`btn-icon${mode === 'playing' ? ' active' : ''}`}
              disabled={battleOver}
              title={t('battle.play')}
              aria-label={t('battle.play')}
              aria-pressed={mode === 'playing'}
              onClick={() => applyMode(mode === 'playing' ? 'paused' : 'playing')}
            >
              ▶
            </button>
            <button
              type="button"
              className="btn-icon"
              disabled={battleOver}
              title={t('battle.skipToEnd')}
              aria-label={t('battle.skipToEnd')}
              onClick={() => {
                applyMode('paused');
                if (embedReady) replayRef.current?.seekTurn(Infinity);
                else setRevealedLine(totalLines);
              }}
            >
              ⏭⏭
            </button>
          </div>
          <button
            type="button"
            className="btn-icon"
            disabled={!battleOver}
            title={t('battle.rematch')}
            aria-label={t('battle.rematch')}
            onClick={rematch}
          >
            🔁
          </button>
          <button
            type="button"
            className="btn-icon"
            title={t('battle.newTeam')}
            aria-label={t('battle.newTeam')}
            onClick={onRebuild}
          >
            🆕
          </button>
        </div>
      </div>

      <div className="log-panel" ref={logRef}>
        {visibleTurns.map((turn, turnIndex) => {
          // Only the newest turn is ever partial - a step stops where its move
          // ended, which is usually part-way through a turn. Slicing the
          // amounts alongside the lines keeps the two index-aligned; the
          // amounts themselves are still derived from the whole battle, so the
          // HP figures don't change as more is revealed.
          const isPartial = turnIndex === lastVisibleTurnIndex;
          const rawLines = isPartial ? turn.lines.slice(0, visibleLinesInLastTurn) : turn.lines;
          const amounts = damageAmounts[turnIndex] ?? [];
          const lines = buildTurnLines(
            rawLines,
            isPartial ? amounts.slice(0, visibleLinesInLastTurn) : amounts,
            spriteByName,
            setSelectedMove,
            { t, lang, moveTargets: result.moveTargets, playerDisplayName },
            turn.turn,
            result.battleId != null ? setReportContext : undefined,
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

      {reportContext && result.battleId != null && (
        <MoveSuggestionModal
          battleId={result.battleId}
          context={reportContext}
          onClose={() => setReportContext(null)}
          t={t}
        />
      )}
    </div>
  );
}

function MoveSuggestionModal({
  battleId,
  context,
  onClose,
  t,
}: {
  battleId: number;
  context: MoveReportContext;
  onClose: () => void;
  t: I18n['t'];
}) {
  const [suggestion, setSuggestion] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  function submit() {
    if (!suggestion.trim() || !reason.trim()) return;
    setStatus('submitting');
    submitMoveSuggestion(battleId, {
      turn: context.turn,
      lineIndex: context.lineIndex,
      rawLine: context.rawLine,
      suggestion: suggestion.trim(),
      reason: reason.trim(),
    })
      .then(() => setStatus('done'))
      .catch(() => setStatus('error'));
  }

  return (
    <div className="move-detail-backdrop" onClick={onClose}>
      <div className="move-detail-card suggestion-card" onClick={(e) => e.stopPropagation()}>
        <div className="move-detail-header">
          <h3>{t('battle.reportMove.title')}</h3>
          <button type="button" className="move-detail-close" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <p className="suggestion-context">{context.description}</p>
        {status === 'done' ? (
          <p className="suggestion-thanks">{t('battle.reportMove.thanks')}</p>
        ) : (
          <>
            <label className="suggestion-field">
              {t('battle.reportMove.suggestionLabel')}
              <textarea
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                rows={2}
                placeholder={t('battle.reportMove.suggestionPlaceholder')}
              />
            </label>
            <label className="suggestion-field">
              {t('battle.reportMove.reasonLabel')}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder={t('battle.reportMove.reasonPlaceholder')}
              />
            </label>
            {status === 'error' && <p className="error-msg">{t('battle.reportMove.error')}</p>}
            <div className="cta-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={status === 'submitting' || !suggestion.trim() || !reason.trim()}
                onClick={submit}
              >
                {status === 'submitting' ? t('common.loading') : t('battle.reportMove.submit')}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
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
