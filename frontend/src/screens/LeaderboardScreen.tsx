import { useEffect, useMemo, useState } from 'react';
import '../styles/leaderboard.css';
import { fetchLeaderboard } from '../api/client';
import type { LeaderboardEntry } from '../api/types';
import { useLanguage } from '../i18n/LanguageContext';
import { type TranslationKey } from '../i18n/translations';

/** Which translation key names a leader, keyed by id - same shape BattleScreen
 * keeps for its own header (`LEADER_NAME_KEY` there). Duplicated rather than
 * imported since neither screen owns the other, but kept complete here (all
 * three current leaders) rather than copying BattleScreen's own list verbatim. */
const LEADER_NAME_KEY: Record<string, TranslationKey> = {
  brock: 'leader.brock.name',
  misty: 'leader.misty.name',
  'lt-surge': 'leader.lt-surge.name',
};

function leaderDisplayName(leaderId: string, t: (key: TranslationKey) => string): string {
  const key = LEADER_NAME_KEY[leaderId];
  return key ? t(key) : leaderId;
}

type SortKey =
  | 'displayName'
  | 'outcome'
  | 'createdAt'
  | 'turns'
  | 'playerAlive'
  | 'rivalAlive'
  | 'playerHpPct'
  | 'rivalHpPct';

type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; labelKey: TranslationKey }[] = [
  { key: 'displayName', labelKey: 'leaderboard.col.trainer' },
  { key: 'outcome', labelKey: 'leaderboard.col.outcome' },
  { key: 'createdAt', labelKey: 'leaderboard.col.date' },
  { key: 'turns', labelKey: 'leaderboard.col.turns' },
  { key: 'playerAlive', labelKey: 'leaderboard.col.playerAlive' },
  { key: 'rivalAlive', labelKey: 'leaderboard.col.rivalAlive' },
  { key: 'playerHpPct', labelKey: 'leaderboard.col.playerHp' },
  { key: 'rivalHpPct', labelKey: 'leaderboard.col.rivalHp' },
];

// Win > tie > loss, from the player's side - what "ascending"/"descending"
// means for a column that isn't naturally numeric.
const OUTCOME_RANK: Record<LeaderboardEntry['outcome'], number> = { player: 2, tie: 1, rival: 0 };

function outcomeModifier(outcome: LeaderboardEntry['outcome']): 'win' | 'lose' | 'tie' {
  if (outcome === 'tie') return 'tie';
  return outcome === 'player' ? 'win' : 'lose';
}

function outcomeLabelKey(outcome: LeaderboardEntry['outcome']): TranslationKey {
  if (outcome === 'tie') return 'leaderboard.outcome.tie';
  return outcome === 'player' ? 'leaderboard.outcome.win' : 'leaderboard.outcome.loss';
}

/** One column's raw sort value for `a`, compared against the same for `b` -
 * `localeCompare`/rank for the two non-numeric columns, plain subtraction for
 * everything else (including `createdAt`, compared as a timestamp rather than
 * as the ISO string itself). */
function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry, key: SortKey): number {
  switch (key) {
    case 'displayName':
      return a.displayName.localeCompare(b.displayName);
    case 'outcome':
      return OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome];
    case 'createdAt':
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    default:
      return a[key] - b[key];
  }
}

export function LeaderboardScreen({ leaderId, onBack }: { leaderId: string; onBack: () => void }) {
  const { t, lang } = useLanguage();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Re-fetched per leader, same "one fetch, sort in memory" shape the API
  // route itself documents (see src/server/index.ts's leaderboard route).
  useEffect(() => {
    setEntries(null);
    setError(false);
    fetchLeaderboard(leaderId)
      .then((res) => setEntries(res.entries))
      .catch(() => setError(true));
  }, [leaderId]);

  const sorted = useMemo(() => {
    if (!entries) return [];
    const copy = [...entries];
    copy.sort((a, b) => (sortDir === 'asc' ? compareEntries(a, b, sortKey) : compareEntries(b, a, sortKey)));
    return copy;
  }, [entries, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Newest/highest first on a fresh column, matching the API's own
    // newest-first default order.
    setSortDir('desc');
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <div className="panel leaderboard-screen">
      <div className="builder-header">
        <div className="builder-header-title">
          <button type="button" className="back-arrow" onClick={onBack} aria-label={t('teamBuilder.back')}>
            ←
          </button>
          <h2>{t('leaderboard.title', { leader: leaderDisplayName(leaderId, t) })}</h2>
        </div>
      </div>

      {error && <p className="error-msg">{t('leaderboard.error')}</p>}
      {!error && entries === null && <p className="loading-msg">{t('common.loading')}</p>}
      {!error && entries !== null && entries.length === 0 && <p className="loading-msg">{t('leaderboard.empty')}</p>}

      {!error && entries !== null && entries.length > 0 && (
        // Capped-height, internally-scrolling container - same convention
        // `.log-panel` uses (frontend/src/styles/battle.css) rather than
        // letting the table grow the page.
        <div className="leaderboard-table-wrap">
          <div className="leaderboard-table" role="table">
            <div className="leaderboard-row leaderboard-row--head" role="row">
              {COLUMNS.map((col) => (
                <button
                  type="button"
                  key={col.key}
                  role="columnheader"
                  className={`leaderboard-cell leaderboard-cell--head${
                    sortKey === col.key ? ' leaderboard-cell--active' : ''
                  }`}
                  onClick={() => toggleSort(col.key)}
                >
                  {t(col.labelKey)}
                  {sortKey === col.key && (
                    <span className="leaderboard-sort-arrow" aria-hidden="true">
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {sorted.map((entry) => (
              <div className="leaderboard-row" role="row" key={entry.battleId}>
                <span className="leaderboard-cell" role="cell">
                  {entry.displayName}
                </span>
                <span className="leaderboard-cell" role="cell">
                  <span className={`leaderboard-outcome leaderboard-outcome--${outcomeModifier(entry.outcome)}`}>
                    {t(outcomeLabelKey(entry.outcome))}
                  </span>
                </span>
                <span className="leaderboard-cell" role="cell">
                  {formatDate(entry.createdAt)}
                </span>
                <span className="leaderboard-cell" role="cell">
                  {entry.turns}
                </span>
                <span className="leaderboard-cell" role="cell">
                  {entry.playerAlive}
                </span>
                <span className="leaderboard-cell" role="cell">
                  {entry.rivalAlive}
                </span>
                <span className="leaderboard-cell" role="cell">
                  {Math.round(entry.playerHpPct)}%
                </span>
                <span className="leaderboard-cell" role="cell">
                  {Math.round(entry.rivalHpPct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
