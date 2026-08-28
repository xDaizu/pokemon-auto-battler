import { useState } from 'react';
import '../styles/footer.css';
import { submitFeedback } from '../api/client';
import { useLanguage } from '../i18n/LanguageContext';

const MAX_LEN = 180;

// Indexing a fixed array (rather than building a `footer.cta.${n}` template
// literal) keeps `t()`'s argument a real `TranslationKey`, no cast needed.
const CTA_KEYS = [
  'footer.cta.0',
  'footer.cta.1',
  'footer.cta.2',
  'footer.cta.3',
  'footer.cta.4',
  'footer.cta.5',
  'footer.cta.6',
  'footer.cta.7',
  'footer.cta.8',
  'footer.cta.9',
] as const;

export function Footer() {
  const { t } = useLanguage();
  // useState's lazy initializer runs exactly once, on mount - so the phrase
  // stays put across this component's own re-renders (typing, submitting)
  // and only reshuffles on a fresh mount (signing out and back in), which is
  // what makes it "look different across visits" without extra plumbing.
  const [phraseIndex] = useState(() => Math.floor(Math.random() * CTA_KEYS.length));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setStatus('submitting');
    submitFeedback({ body: trimmed })
      .then(() => setStatus('done'))
      .catch(() => setStatus('error'));
  }

  function reset() {
    setOpen(false);
    setText('');
    setStatus('idle');
  }

  return (
    <footer className="app-footer">
      <p className="footer-cta">{t(CTA_KEYS[phraseIndex]!)}</p>
      {!open && (
        <button type="button" className="btn-secondary footer-toggle" onClick={() => setOpen(true)}>
          {t('footer.button')}
        </button>
      )}
      {open && (
        <div className="footer-form">
          {status === 'done' ? (
            <>
              <p className="suggestion-thanks">{t('footer.thanks')}</p>
              <button type="button" className="btn-secondary" onClick={reset}>
                {t('footer.close')}
              </button>
            </>
          ) : (
            <>
              <textarea
                className="footer-textarea"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                maxLength={MAX_LEN}
                rows={3}
                placeholder={t('footer.placeholder')}
                autoFocus
              />
              <div className="footer-form-row">
                <span className="footer-counter" aria-live="polite">
                  {text.length}/{MAX_LEN}
                </span>
                <div className="cta-row">
                  {status === 'error' && <span className="error-msg">{t('footer.error')}</span>}
                  <button type="button" className="btn-secondary" onClick={reset}>
                    {t('footer.close')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={status === 'submitting' || !text.trim()}
                    onClick={submit}
                  >
                    {status === 'submitting' ? t('common.loading') : t('footer.submit')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </footer>
  );
}
