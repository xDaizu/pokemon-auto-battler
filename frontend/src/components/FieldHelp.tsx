import { useEffect, useId, useRef, useState } from 'react';

interface FieldHelpProps {
  text: string;
  label: string;
}

/**
 * A small "i" button that reveals a field's explanation in a tooltip on
 * tap/click. Deliberately click-triggered rather than CSS `:hover`/`title` —
 * this app is mobile-first and touch has no hover, so a hover-only tooltip
 * would just never appear there.
 */
export function FieldHelp({ text, label }: FieldHelpProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <span className="field-help" ref={rootRef}>
      <button
        type="button"
        className="field-help-trigger"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className="field-help-tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
