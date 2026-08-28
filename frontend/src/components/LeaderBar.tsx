import { useEffect, useState, type CSSProperties } from 'react';
import '../styles/leaderBar.css';
import { fetchLeaders } from '../api/client';
import type { LeaderSummary } from '../api/types';
import { useLanguage } from '../i18n/LanguageContext';
import { leaderThemes } from '../theme/leaderThemes';
import { typeColors } from '../theme/typeColors';

interface LeaderBarProps {
  activeLeaderId: string;
  onSelect: (leaderId: string) => void;
  /** Once a leader's team is being built (or battled), the choice is locked
   * in - the bar still shows who's active, but every slot goes inert. The
   * only way out is IntroScreen's back arrow, which returns here first. */
  disabled?: boolean;
}

/**
 * The eight gym-leader slots: one button per `GET /api/leaders` row, in gym
 * order, laid out as a full-width, eight-across strip of badge buttons - a
 * gym leader's own badge stands in for their name, so the bar reads like a
 * badge case rather than a row of text tabs. `available` is the only thing
 * driving what renders - an unshipped leader carries no `label`/badge at all
 * (see `LeaderSummary`), so a locked slot can only ever show the generic `?`
 * empty socket. A `teaser` leader (Lt. Surge today) gets a real, type-colored
 * socket but its badge art is blacked out (`.teaser-blackout`, same
 * treatment IntroScreen gives its splash art) - filled, but redacted.
 */
export function LeaderBar({ activeLeaderId, onSelect, disabled = false }: LeaderBarProps) {
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
      {leaders.map((leader) => {
        if (!leader.available) {
          return (
            <button
              type="button"
              key={leader.id}
              className="leader-bar-btn leader-bar-btn--locked"
              disabled
              title={t('leaderBar.locked')}
              aria-label={t('leaderBar.locked')}
            >
              ?
            </button>
          );
        }

        // Badge + thematic type color come from leaderThemes, not this
        // response - LeaderSummary carries no art, only the id it's keyed by.
        const theme = leaderThemes[leader.id];
        const colors = theme ? typeColors[theme.typeKey] : undefined;
        const isTeaser = leader.unreleased === 'teaser';
        const label = leader.label ?? leader.id;
        // "·" separator matches the app's existing convention for combining
        // two facts into one title/aria-label (see IntroScreen's mon-circle).
        const accessibleLabel = isTeaser ? `${label} · ${t('intro.teaserRibbon')}` : label;

        return (
          <button
            type="button"
            key={leader.id}
            className={`leader-bar-btn leader-bar-btn--badge${
              leader.id === activeLeaderId ? ' leader-bar-btn--active' : ''
            }`}
            style={
              colors
                ? ({
                    '--type-light': colors.light,
                    '--type-color': colors.regular,
                    '--type-dark': colors.dark,
                  } as CSSProperties)
                : undefined
            }
            disabled={disabled}
            title={disabled ? t('leaderBar.lockedInBuild') : accessibleLabel}
            aria-label={accessibleLabel}
            onClick={() => onSelect(leader.id)}
          >
            {theme?.badge ? (
              <img
                className={`leader-bar-badge img-antialiased${isTeaser ? ' teaser-blackout' : ''}`}
                src={theme.badge}
                alt=""
              />
            ) : (
              label
            )}
          </button>
        );
      })}
    </div>
  );
}
