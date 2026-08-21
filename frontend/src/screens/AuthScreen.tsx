import { useEffect, useRef, useState } from 'react';
import '../styles/auth.css';
import { fetchSpecies } from '../api/client';
import type { SpeciesOption } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FieldHelp } from '../components/FieldHelp';
import { PokemonCombobox, type PokemonComboboxHandle } from '../components/PokemonCombobox';
import { RichText, useLanguage } from '../i18n/LanguageContext';

const SLOTS = [0, 1, 2] as const;

type Combo = [string, string, string];
type ComboRefs = [
  React.RefObject<PokemonComboboxHandle | null>,
  React.RefObject<PokemonComboboxHandle | null>,
  React.RefObject<PokemonComboboxHandle | null>,
];

export function AuthScreen() {
  const { t } = useLanguage();
  const { login } = useAuth();

  const [species, setSpecies] = useState<SpeciesOption[] | null>(null);
  const [username, setUsername] = useState('');
  const [combo, setCombo] = useState<Combo>(['', '', '']);
  // Set once the server reports the username is unclaimed: the first screen's
  // fields are done at that point, so they're captured here rather than
  // re-collected, and their presence is what switches the form to screen two.
  const [pendingRegistration, setPendingRegistration] = useState<{ username: string; pokemon: Combo } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const comboRefs = [useRef<PokemonComboboxHandle>(null), useRef<PokemonComboboxHandle>(null), useRef<PokemonComboboxHandle>(null)] as ComboRefs;

  useEffect(() => {
    fetchSpecies()
      .then((res) => setSpecies(res.species))
      .catch(() => setError(t('auth.error.speciesFailed')));
  }, [t]);

  const comboComplete = username.trim() && combo.every(Boolean);
  const displayNameComplete = displayName.trim().length > 0;

  async function handleComboSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!comboComplete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await login(username.trim(), combo);
      if ('needsDisplayName' in response) {
        setPendingRegistration({ username: username.trim(), pokemon: combo });
        setSubmitting(false);
      }
      // Otherwise login() already stored the session; the parent switches
      // screens once `user` is set, so there's nothing further to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.generic'));
      setSubmitting(false);
    }
  }

  async function handleDisplayNameSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingRegistration || !displayNameComplete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await login(pendingRegistration.username, pendingRegistration.pokemon, displayName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.generic'));
      setSubmitting(false);
    }
  }

  if (pendingRegistration) {
    return (
      <div className="panel auth">
        <h2>{t('auth.displayNameHeading')}</h2>
        <p>{t('auth.displayNameExplainer')}</p>

        <form className="auth-form" onSubmit={handleDisplayNameSubmit}>
          <label className="auth-field">
            <span className="auth-field-label">
              {t('auth.displayNameLabel')}
              <FieldHelp text={t('auth.displayNameHelp')} label={t('common.moreInfo')} />
            </span>
            <input
              type="text"
              value={displayName}
              autoFocus
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={!displayNameComplete || submitting}>
            {submitting ? t('common.loading') : t('auth.submit')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="panel auth">
      <h2>{t('auth.heading')}</h2>
      <p>
        <RichText text={t('auth.explainer')} />
      </p>

      <form className="auth-form" onSubmit={handleComboSubmit}>
        <label className="auth-field">
          <span className="auth-field-label">
            {t('auth.usernameLabel')}
            <FieldHelp text={t('auth.usernameHelp')} label={t('common.moreInfo')} />
          </span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <span className="auth-field-label auth-group-label">
          {t('auth.pokemonGroupLabel')}
          <FieldHelp text={t('auth.pokemonHelp')} label={t('common.moreInfo')} />
        </span>
        <div className="auth-combo">
          {SLOTS.map((slot) => (
            <label className="auth-field" key={slot}>
              <span>{t('auth.pokemonSlotLabel', { n: slot + 1 })}</span>
              {/* Names stay English: esDex.json only covers the battle roster,
                  so translating here would yield a mixed-language list. */}
              <PokemonCombobox
                ref={comboRefs[slot]}
                options={species}
                value={combo[slot]}
                disabled={!species}
                placeholder={t('auth.pokemonPlaceholder')}
                loadingLabel={t('common.loading')}
                noResultsLabel={t('auth.pokemonNoResults')}
                onChange={(id) => {
                  const next = [...combo] as Combo;
                  next[slot] = id;
                  setCombo(next);
                }}
                onSelected={() => comboRefs[slot + 1]?.current?.open()}
              />
            </label>
          ))}
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={!comboComplete || submitting}>
          {submitting ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
