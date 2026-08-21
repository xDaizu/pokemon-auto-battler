import { useEffect, useRef, useState } from 'react';
import '../styles/auth.css';
import { fetchSpecies } from '../api/client';
import type { SpeciesOption } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
  const [displayName, setDisplayName] = useState('');
  const [combo, setCombo] = useState<Combo>(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const comboRefs = [useRef<PokemonComboboxHandle>(null), useRef<PokemonComboboxHandle>(null), useRef<PokemonComboboxHandle>(null)] as ComboRefs;

  useEffect(() => {
    fetchSpecies()
      .then((res) => setSpecies(res.species))
      .catch(() => setError(t('auth.error.speciesFailed')));
  }, [t]);

  const complete = username.trim() && displayName.trim() && combo.every(Boolean);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await login(username.trim(), displayName.trim(), combo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.generic'));
      setSubmitting(false);
    }
  }

  return (
    <div className="panel auth">
      <h2>{t('auth.heading')}</h2>
      <p>
        <RichText text={t('auth.explainer')} />
      </p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>{t('auth.usernameLabel')}</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="auth-field">
          <span>{t('auth.displayNameLabel')}</span>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

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

        <button type="submit" disabled={!complete || submitting}>
          {submitting ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
