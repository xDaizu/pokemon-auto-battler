import { useEffect, useState } from 'react';
import '../styles/auth.css';
import { fetchSpecies } from '../api/client';
import type { SpeciesOption } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { RichText, useLanguage } from '../i18n/LanguageContext';

const SLOTS = [0, 1, 2] as const;

type Combo = [string, string, string];

export function AuthScreen() {
  const { t } = useLanguage();
  const { login } = useAuth();

  const [species, setSpecies] = useState<SpeciesOption[] | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [combo, setCombo] = useState<Combo>(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
              <select
                value={combo[slot]}
                disabled={!species}
                onChange={(e) => {
                  const next = [...combo] as Combo;
                  next[slot] = e.target.value;
                  setCombo(next);
                }}
              >
                <option value="">{species ? t('auth.pokemonPlaceholder') : t('common.loading')}</option>
                {/* Names stay English: esDex.json only covers the battle roster,
                    so translating here would yield a mixed-language list. */}
                {(species ?? []).map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
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
