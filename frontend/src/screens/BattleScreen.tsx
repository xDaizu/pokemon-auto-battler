import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/battle.css';
import { fetchMoveDetail, runBattle, spriteUrl, submitMoveSuggestion } from '../api/client';
import type { BattleResult, MoveDetail, MoveTargetCategory, PlayerPokemonSelection } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  buildFlatMoveIndex,
  classifyLine,
  DEFAULT_SPEED,
  FALLBACK_TURN_MS,
  nextMoveEndBoundary,
  turnProgressForFlatIndex,
} from '../battle/replayLog';
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

const IDENT = /^(p1|p2)[ab]: (.+)$/;

/** What the playback clock is doing. Playback runs at one fixed speed
 * (`DEFAULT_SPEED`), so this doesn't have to carry a pace with it.
 *
 * `'stepping'` is a single move being played out and stopped at - brief, but
 * a state of its own, because it's asynchronous: it disables every control
 * until it lands, which is what stops a second step from being started over
 * an unfinished one. */
type PlaybackMode = 'paused' | 'playing' | 'stepping';

const STATUS_VERB_KEY: Record<string, TranslationKey> = {
  par: 'battle.status.par',
  brn: 'battle.status.brn',
  psn: 'battle.status.psn',
  tox: 'battle.status.tox',
  slp: 'battle.status.slp',
  frz: 'battle.status.frz',
};

/** Which translation key names a leader, keyed by `BattleApiResponse.leaderId`
 * rather than the label text itself - a label is display text, not a stable
 * key (see invariant 8). Doubles as the `{{leader}}` value for the generic
 * `battle.loading`/`battle.outcome.*` copy below. */
const LEADER_NAME_KEY: Record<string, TranslationKey> = {
  brock: 'leader.brock.name',
  misty: 'leader.misty.name',
};

/** Resolves a leader id to its short display name, falling back to the id
 * itself for a leader with no translation entry yet. */
function leaderDisplayName(leaderId: string, t: (key: TranslationKey) => string): string {
  const key = LEADER_NAME_KEY[leaderId];
  return key ? t(key) : leaderId;
}

/** Translated form of the fixed team labels the server assigns
 * (buildTeam.ts's playerTeam.label is 'Red', a leader's team label is its
 * own display name), used to localize the raw `|win|<label>` protocol line.
 * The player's side is shown as the logged-in trainer's display name rather
 * than 'Red' - that's the API-assigned team label, not anything the player
 * picked. */
function translateTeamLabel(
  label: string,
  leaderId: string,
  t: (key: TranslationKey) => string,
  playerDisplayName: string,
): string {
  if (label === 'Red') return playerDisplayName;
  return leaderDisplayName(leaderId, t);
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
  // Stable id of the leader fought (`BattleApiResponse.leaderId`), used to
  // localize the rival's name on the `|win|` line without matching on its
  // display label text (see `translateTeamLabel`).
  leaderId: string;
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
        node: `${winner ? translateTeamLabel(winner, i18n.leaderId, t, i18n.playerDisplayName) : ''}${t('battle.winsSuffix')}`,
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

export function BattleScreen({
  leaderId,
  selections,
  onRebuild,
}: {
  leaderId: string;
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

    runBattle(selections, leaderId)
      .then(setResult)
      .catch((err) => setError({ message: err instanceof Error ? err.message : null }));
  }, [selections, leaderId]);

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
    runBattle(selections, leaderId)
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

  // Scrolls *within* the log panel to its newest line, rather than
  // scrollIntoView-ing the panel within the page - the panel has its own
  // fixed-height scrollbar (see .log-panel in battle.css) precisely so the
  // page itself never has to move as more turns are revealed.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [revealedLine]);

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
    // `result.leaderId` doesn't exist yet at this point - the `leaderId` prop
    // (App.tsx's own state, threaded through since it's what the pending
    // `runBattle` call above was actually sent) is what's available instead.
    return (
      <div className="panel loading-msg">
        {t('battle.loading', { leader: leaderDisplayName(leaderId, t) })}
      </div>
    );
  }

  const visibleTurns = result.turns.slice(0, lastVisibleTurnIndex + 1);

  return (
    <div className="panel">
      <div className="battle-stage">
        {/* Both trainers' rosters used to get a header row here (TeamRow x2,
            then just the player's after the rival's moved out) - now neither
            does. Both are shown on the battler itself instead: the widget's
            own .leftbar/.rightbar team-icon strips, one per side (see
            FRAME_STYLE in replayLog.ts), so the panel goes straight from the
            app's top bar into the battle viewer with nothing in between. */}
        <ShowdownReplayEmbed
          turns={result.turns}
          leaderId={result.leaderId}
          ref={replayRef}
          onReady={() => setEmbedReady(true)}
          // Clamped rather than assigned outright: if the fallback timer has
          // already revealed turns before the widget finishes loading, its
          // own currentStep starts near 0 and would otherwise snap
          // `revealedLine` backward, making already-seen log lines briefly
          // disappear.
          onLineChange={(line) => setRevealedLine((r) => Math.max(r, line))}
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
                if (!flatIndex) return;
                const target = nextMoveEndBoundary(flatIndex, revealedLine);
                if (embedReady) {
                  // The widget plays the move out and reports its own position
                  // back through the ordinary 'paused' event when it stops, so
                  // there's nothing to set here beyond the in-flight state.
                  setMode('stepping');
                  replayRef.current?.stepMove(target, () => setMode('paused'));
                } else {
                  // No widget, so no animation to wait on - the log just moves
                  // to where the move ends. Degraded, not broken.
                  setRevealedLine(target);
                }
              }}
            >
              ⏭
            </button>
            <button
              type="button"
              className={`btn-icon${mode === 'playing' ? ' active' : ''}`}
              disabled={battleOver || mode === 'stepping'}
              title={t('battle.play')}
              aria-label={t('battle.play')}
              aria-pressed={mode === 'playing'}
              onClick={() => applyMode(mode === 'playing' ? 'paused' : 'playing')}
            >
              ▶
            </button>
            {/* Also locked out mid-step: `seekTurn` drives itself through the
                same `nextStep` the step shadow is sitting on, so a seek
                started under one could trip its stop condition part-way and
                pause the seek early. */}
            <button
              type="button"
              className="btn-icon"
              disabled={battleOver || mode === 'stepping'}
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
            { t, lang, moveTargets: result.moveTargets, playerDisplayName, leaderId: result.leaderId },
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
              ? t('battle.outcome.win', { leader: leaderDisplayName(result.leaderId, t) })
              : t('battle.outcome.lose', { leader: leaderDisplayName(result.leaderId, t) })}
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
