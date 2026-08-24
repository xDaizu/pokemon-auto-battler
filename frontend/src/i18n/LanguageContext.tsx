import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from './dexNames';
import { interpolate, translations, type TranslationKey } from './translations';

const STORAGE_KEY = 'pokemon-auto-battler:lang';

function detectInitialLang(): Lang {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'es') return stored;
  return window.navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectInitialLang);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => interpolate(translations[lang][key], vars),
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}

/**
 * Renders `**bold**` spans in an otherwise-plain translated string as
 * <strong>. A `{{token}}` with a matching entry in `slots` is swapped for
 * that React node instead — e.g. dropping a real `FieldHelp` button inline
 * in copy that refers to it, so the reader sees the exact widget being
 * described rather than a description of one.
 */
export function RichText({ text, slots }: { text: string; slots?: Record<string, ReactNode> }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{\w+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const slotMatch = /^\{\{(\w+)\}\}$/.exec(part);
        const slot = slotMatch && slots?.[slotMatch[1]!];
        return slot ? <span key={i}>{slot}</span> : part;
      })}
    </>
  );
}
