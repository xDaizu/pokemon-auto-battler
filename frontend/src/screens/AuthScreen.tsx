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
type Screen = 'welcome' | 'register' | 'login';

export function AuthScreen() {
  const { t } = useLanguage();
  const { register, login } = useAuth();

  const [screen, setScreen] = useState<Screen>('welcome');
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

  // Leaving a screen behind means leaving its input and errors behind too —
  // otherwise a trainer who backs out of "Register" into "Login" would find
  // their half-typed username and a stale error still sitting there.
  function goTo(next: Screen) {
    setUsername('');
    setDisplayName('');
    setCombo(['', '', '']);
    setError(null);
    setScreen(next);
  }

  const isRegister = screen === 'register';
  const formComplete = Boolean(username.trim()) && combo.every(Boolean) && (!isRegister || displayName.trim());

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!formComplete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      if (isRegister) {
        await register(username.trim(), displayName.trim(), combo);
      } else {
        await login(username.trim(), combo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.generic'));
      setSubmitting(false);
    }
  }

  if (screen === 'welcome') {
    return (
      <div className="panel auth">
        <h2>{t('auth.welcomeHeading')}</h2>
        <p>{t('auth.welcomeQuestion')}</p>

        <div className="auth-welcome-choices">
          <button type="button" className="btn-primary" onClick={() => goTo('register')}>
            {t('auth.welcomeRegisterButton')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => goTo('login')}>
            {t('auth.welcomeLoginButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel auth">
      <button type="button" className="auth-back-link" onClick={() => goTo('welcome')}>
        {t('auth.backButton')}
      </button>

      <h2>{isRegister ? t('auth.registerHeading') : t('auth.loginHeading')}</h2>
      <p>
        {isRegister ? (
          <RichText
            text={t('auth.registerExplainer')}
            slots={{ iButton: <FieldHelp text={t('auth.iButtonHint')} label={t('common.moreInfo')} /> }}
          />
        ) : (
          <RichText text={t('auth.loginExplainer')} />
        )}
      </p>

      <form className="auth-form" onSubmit={handleSubmit}>
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

        {isRegister && (
          <label className="auth-field">
            <span className="auth-field-label">
              {t('auth.displayNameLabel')}
              <FieldHelp text={t('auth.displayNameHelp')} label={t('common.moreInfo')} />
            </span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
        )}

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

        <button type="submit" className="btn-primary" disabled={!formComplete || submitting}>
          {submitting ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
