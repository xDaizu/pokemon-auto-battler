import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * The trainer's name in the title bar, doubling as the menu holding whatever
 * is account-scoped — for now just "log out", which used to sit beside the
 * name as a second control and cost the bar a whole button's width.
 *
 * Click-triggered and dismissed on an outside `pointerdown`, the same shape
 * `FieldHelp` uses: this app is mobile-first and touch has no hover, so a
 * hover-opened menu would simply never open on a phone.
 */
export function TrainerMenu({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Escape dismisses without moving the pointer, so focus has nowhere to
      // land on its own — hand it back to the trigger rather than dropping it
      // on <body> and losing the tab position.
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="trainer-menu" ref={rootRef}>
      {/* The name itself is the accessible name of the trigger, which with
          `aria-haspopup` reads as "<trainer>, menu" — no separate label copy
          to translate for what the name already says. */}
      <button
        type="button"
        ref={triggerRef}
        className="trainer-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="trainer-name">{displayName}</span>
        <span className="trainer-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="trainer-menu-popover" id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            className="trainer-menu-item"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            {t('app.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
