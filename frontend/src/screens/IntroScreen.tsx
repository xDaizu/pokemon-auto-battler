import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import '../styles/intro.css';
import { fetchLeaders, fetchRival, spriteUrl } from '../api/client';
import type { LeaderSummary, RivalResponse } from '../api/types';
import { PokemonDetailCard, usePokemonDetailCard } from '../components/PokemonDetailCard';
import { RichText, useLanguage } from '../i18n/LanguageContext';
import { translateSpeciesName } from '../i18n/dexNames';
import { pokemonCountWord } from '../i18n/pokemonCount';
import { type TranslationKey } from '../i18n/translations';
import { leaderThemes } from '../theme/leaderThemes';
import { ThemeScope } from '../theme/ThemeScope';
import { typeColors } from '../theme/typeColors';

/** The `leader.<id>.*` identity-copy keys (see i18n/translations.ts), keyed
 * by `leaderId` - a lookup map rather than a template literal, since
 * `TranslationKey` is a closed union and can't be built from an arbitrary
 * string. Misty's own row is what M9 adds alongside her actual copy. */
const LEADER_COPY_KEY: Record<
  string,
  { splashTitle: TranslationKey; heading: TranslationKey; rivalLabel: TranslationKey; description: TranslationKey }
> = {
  brock: {
    splashTitle: 'leader.brock.splashTitle',
    heading: 'leader.brock.heading',
    rivalLabel: 'leader.brock.rivalLabel',
    description: 'leader.brock.description',
  },
  misty: {
    splashTitle: 'leader.misty.splashTitle',
    heading: 'leader.misty.heading',
    rivalLabel: 'leader.misty.rivalLabel',
    description: 'leader.misty.description',
  },
  'lt-surge': {
    splashTitle: 'leader.lt-surge.splashTitle',
    heading: 'leader.lt-surge.heading',
    rivalLabel: 'leader.lt-surge.rivalLabel',
    description: 'leader.lt-surge.description',
  },
};

// The fixed cap on moves per Pokémon - same value TeamBuilder.tsx enforces.
// Unlike the level cap and team size below, this isn't a per-leader rule
// (LeaderRules carries no such field), so there's nothing to fetch it from.
const MAX_MOVES = 4;

/** Ace-first display order for the splash's circle stack: the leader's
 * signature Pokémon (by `aceIndex`) leads, everything else follows in the
 * roster's own (battle-slot) order, which stays untouched everywhere else. */
function orderForSplash<T>(pokemon: T[], aceIndex: number): T[] {
  const ace = pokemon[aceIndex];
  if (!ace) return pokemon;
  return [ace, ...pokemon.filter((mon) => mon !== ace)];
}

export function IntroScreen({ leaderId, onContinue }: { leaderId: string; onContinue: () => void }) {
  const { t, lang } = useLanguage();
  const [rival, setRival] = useState<RivalResponse | null>(null);
  const [leaders, setLeaders] = useState<LeaderSummary[]>([]);
  const card = usePokemonDetailCard();

  useEffect(() => {
    fetchRival(leaderId).then(setRival).catch(() => undefined);
  }, [leaderId]);

  // Fetched once - `leaders` covers every leader regardless of which is
  // active, so switching `leaderId` just re-derives `leader` below rather
  // than re-fetching.
  useEffect(() => {
    fetchLeaders()
      .then((res) => setLeaders(res.leaders))
      .catch(() => undefined);
  }, []);

  const leader = leaders.find((l) => l.id === leaderId) ?? null;
  const splashMons = rival ? orderForSplash(rival.pokemon, rival.aceIndex) : [];
  const teamSize = leader?.teamSize;
  const levelCap = leader?.levelCap;
  // A teaser leader (server-authoritative, see `LeaderSummary.unreleased`)
  // shows its real roster art but stays non-interactive here: no stats
  // modal, and the CTA below can't actually start a challenge.
  const isTeaser = leader?.unreleased === 'teaser';

  // Shared button markup for one circle in the splash's mons stack — used
  // for both the ace (rendered on its own, on top) and the rest (rendered
  // side by side in a row below it).
  const renderMonCircle = (mon: RivalResponse['pokemon'][number], isAce: boolean) => (
    <button
      type="button"
      className={`mon-circle${isAce ? ' mon-circle--ace' : ''}`}
      key={mon.species}
      title={`${translateSpeciesName(mon.name, lang)} · ${t('common.levelAbbrev')}${mon.level}`}
      aria-label={t('pokemonCard.viewDetails', { name: translateSpeciesName(mon.name, lang) })}
      disabled={isTeaser}
      onClick={isTeaser ? undefined : () => card.open(mon)}
    >
      {/* Same "shadow double" trick as the leader's own portrait
       * (leader-splash-shadow below) — a flat silhouette cut from the ace's
       * own sprite via mask-image, offset behind it. Always black, unlike
       * the leader's type-colored version: the ace has no single type of
       * its own to swatch. Ace-only; the rest of the roster stays plain. */}
      {isAce && (
        <span
          className="mon-circle-ace-shadow img-pixelated"
          aria-hidden="true"
          style={{
            WebkitMaskImage: `url(${spriteUrl(mon.num)})`,
            maskImage: `url(${spriteUrl(mon.num)})`,
          }}
        />
      )}
      <img
        className={`img-pixelated${isTeaser ? ' teaser-blackout' : ''}`}
        src={spriteUrl(mon.num)}
        alt={mon.name}
      />
    </button>
  );

  // `leaderId` is app state now, not a hardcoded literal - fall back to
  // Brock's own theme/copy for an id that (shouldn't, but) has no entry yet,
  // same graceful-degradation spirit as `ThemeScope`'s own fallback.
  const theme = leaderThemes[leaderId] ?? leaderThemes.brock;
  const copyKeys = LEADER_COPY_KEY[leaderId] ?? LEADER_COPY_KEY.brock;

  // Leader's thematic type swatch (see theme/typeColors.ts) fills the
  // Persona-3-style shadow silhouette below — Brock's type, not the Dark type.
  // Only meaningful once there's a portrait to cut the silhouette from. Left
  // in its real color even for a teaser leader: with the sprite itself
  // blacked out (`.teaser-blackout`), this colored double-exposure is the one
  // hint of the leader's actual palette peeking out from behind the redaction.
  const shadowStyle: CSSProperties = {
    backgroundColor: typeColors[theme.typeKey]?.dark,
    WebkitMaskImage: theme.portrait ? `url(${theme.portrait})` : undefined,
    maskImage: theme.portrait ? `url(${theme.portrait})` : undefined,
  };

  // Same thematic swatch, this time for the heading's comic-panel box.
  const typeBoxStyle: CSSProperties = {
    backgroundColor: typeColors[theme.typeKey]?.regular,
    borderColor: typeColors[theme.typeKey]?.dark,
  };

  // Feeds `theme.portraitMetrics` to intro.css as CSS custom properties,
  // replacing the numbers it used to hardcode for Brock's art alone. Passed
  // unitless: intro.css multiplies each by `--splash-unit`, its design unit
  // that shrinks the whole splash proportionally on narrow screens, so these
  // are design-space numbers rather than px (see intro.css's leader-splash
  // section).
  const splashStyle = {
    '--leader-portrait-width': theme.portraitMetrics.width,
    '--leader-portrait-reserved-height': theme.portraitMetrics.reservedHeight,
    '--leader-portrait-offset-top': theme.portraitMetrics.offsetTop,
  } as CSSProperties;

  return (
    <div className="panel intro">
      <ThemeScope leaderId={leaderId}>
        <div className="leader-splash" style={splashStyle}>
          <h1 className="leader-splash-title">{t(copyKeys.splashTitle)}</h1>
          {/* No art yet for a just-shipped leader (see LeaderTheme.portrait) -
              skip the whole block rather than rendering a broken image. */}
          {theme.portrait && (
            // Keyed by leaderId so the fade-in-from-right (see intro.css's
            // leader-portrait-fade-in) remounts and replays on every leader
            // switch, not just the very first paint - same trick as the
            // mon-circle buttons below, keyed by species for the same reason.
            <div className="leader-splash-portrait" key={leaderId}>
              <div className="leader-splash-shadow img-antialiased" style={shadowStyle} aria-hidden="true" />
              <img
                className={`leader-splash-sprite img-antialiased${isTeaser ? ' teaser-blackout' : ''}`}
                src={theme.portrait}
                alt={t(copyKeys.rivalLabel)}
              />
            </div>
          )}
          <div className={`leader-splash-mons leader-splash-mons--count-${splashMons.length}`}>
            {/* Ace-first for the splash only (signature mon leads the circle
             * stack) — the roster's own order is battle team-slot order and
             * stays untouched. Rendered on its own, above the rest, so it
             * paints in front rather than getting buried by DOM order.
             * The `--count-N` modifier (N = leader's team size) is what lets
             * intro.css give the 2-mon and 3-mon splashes their own sizing/
             * layout instead of one shared ruleset drifting between leaders -
             * see intro.css's "Leader splash mons" section. */}
            {splashMons[0] && renderMonCircle(splashMons[0], true)}
            <div className="leader-splash-mons-row">
              {splashMons.slice(1).map((mon) => renderMonCircle(mon, false))}
            </div>
          </div>
          {/* Police-line-style tape, slapped diagonally across the blacked-out
           * art — the one splash of color the teaser state gets, and the
           * clearest signal (louder than the disabled CTA below) that this
           * leader isn't open yet. Repeated copies rather than one centered
           * label so the tape reads as tape at any splash width; decorative
           * only (aria-hidden) since the disabled CTA's label already covers
           * the same fact for assistive tech. */}
          {isTeaser && (
            <div className="teaser-ribbon" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span className="teaser-ribbon-item" key={i}>
                  <span className="teaser-ribbon-text">{t('intro.teaserRibbon')}</span>
                  <span className="teaser-ribbon-dot" />
                </span>
              ))}
            </div>
          )}
        </div>
      </ThemeScope>

      <div className="intro-heading">
        <div className="intro-heading-box" style={typeBoxStyle}>
          {theme.badge && (
            <img
              className={`intro-heading-badge img-antialiased${isTeaser ? ' teaser-blackout' : ''}`}
              src={theme.badge}
              alt=""
              aria-hidden="true"
            />
          )}
          <h2>{t(copyKeys.heading)}</h2>
        </div>
      </div>
      <div className="intro-body-box">
        <p>
          <RichText text={t(copyKeys.description)} />
        </p>
      </div>
      <div className="cta-row">
        <button type="button" className="btn-primary" disabled={isTeaser} onClick={isTeaser ? undefined : onContinue}>
          {t(isTeaser ? 'intro.ctaUnreleased' : 'intro.cta')}
        </button>
      </div>
      <details className="rules-accordion">
        <summary>{t('intro.rulesIntro')}</summary>
        <ul className="rules-list">
          <li>{t('intro.rule.noItems')}</li>
          <li>{t('intro.rule.noUsableItems')}</li>
          {teamSize != null && (
            <li>{t('intro.rule.pokemonCount', { count: pokemonCountWord(teamSize, lang) })}</li>
          )}
          <li>{t('intro.rule.exclusiveStarter')}</li>
          {levelCap != null && <li>{t('intro.rule.levelCap', { cap: levelCap })}</li>}
          {levelCap != null && <li>{t('intro.rule.evoStage', { cap: levelCap })}</li>}
          {levelCap != null && <li>{t('intro.rule.moves', { max: MAX_MOVES, cap: levelCap })}</li>}
        </ul>
      </details>

      {card.mon && <PokemonDetailCard mon={card.mon} onClose={card.close} t={t} lang={lang} />}
    </div>
  );
}
