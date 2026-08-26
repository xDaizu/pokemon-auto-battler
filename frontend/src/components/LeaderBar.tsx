import { useEffect, useState } from 'react';
import '../styles/leaderBar.css';
import { fetchLeaders } from '../api/client';
import type { LeaderSummary } from '../api/types';
import { useLanguage } from '../i18n/LanguageContext';

interface LeaderBarProps {
  activeLeaderId: string;
  onSelect: (leaderId: string) => void;
}

/**
 * The eight gym-leader slots: one button per `GET /api/leaders` row, in gym
 * order. `available` is the only thing driving what renders - an unshipped
 * leader carries no `label`/`primaryType` at all (see `LeaderSummary`), so a
 * locked slot can only ever show the generic `?`. `label` is deliberately
 * shown as-is rather than through `t()` - it's English/DB-bound by design
 * (invariant 8), same as every other spot this app already shows it raw.
 */
export function LeaderBar({ activeLeaderId, onSelect }: LeaderBarProps) {
  const { t } = useLanguage();
  const [leaders, setLeaders] = useState<LeaderSummary[]>([]);

  useEffect(() => {
    fetchLeaders()
      .then((res) => setLeaders(res.leaders))
      .catch(() => undefined);
  }, []);

  // Nothing to render until the list arrives - a placeholder skeleton isn't
  // worth it for a fetch this small/local.
  if (leaders.length === 0) return null;

  return (
    <div className="leader-bar">
      {leaders.map((leader) =>
        leader.available ? (
          <button
            type="button"
            key={leader.id}
            className={`leader-bar-btn${leader.id === activeLeaderId ? ' leader-bar-btn--active' : ''}`}
            onClick={() => onSelect(leader.id)}
          >
            {leader.label ?? leader.id}
          </button>
        ) : (
          <button type="button" key={leader.id} className="leader-bar-btn" disabled title={t('leaderBar.locked')}>
            ?
          </button>
        ),
      )}
    </div>
  );
}
