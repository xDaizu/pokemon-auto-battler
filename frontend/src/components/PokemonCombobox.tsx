import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { spriteUrl } from '../api/client';
import type { SpeciesOption } from '../api/types';

export interface PokemonComboboxHandle {
  /** Opens the list and focuses the search input — used to chain slots together. */
  open: () => void;
}

interface PokemonComboboxProps {
  options: SpeciesOption[] | null;
  value: string;
  onChange: (id: string) => void;
  /** Fires right after a Pokémon is picked (not on open/close/typing). */
  onSelected?: () => void;
  placeholder: string;
  loadingLabel: string;
  noResultsLabel: string;
  disabled?: boolean;
}

/**
 * Searchable Pokémon picker. Renders option names only while the list is
 * open — sprites are fetched (one <img> each, browser-cached) only for the
 * trigger once a Pokémon is actually selected, never for the whole list.
 *
 * Selection runs on the option's `onClick` (the terminal event of a tap/
 * click gesture), not `onMouseDown`. Mutating the DOM on mousedown — e.g.
 * to close this list and open the next slot — leaves the subsequent
 * mouseup/click of the same gesture to land on whatever now occupies that
 * spot, which on a chained combobox reliably misfires the wrong field.
 * Closing on blur is deferred a tick so the option's click still lands
 * before we tear the list down.
 *
 * Even on `onClick`, mobile browsers can still misfire: picking an option
 * collapses the list back down to this trigger in the same spot the tap
 * landed, and some mobile browsers synthesize their click from the tap's
 * *release* coordinates against the *post-update* layout — so the same
 * gesture's click re-lands on the trigger it just closed, reopening this
 * slot instead of advancing. `suppressReopenUntilRef` swallows any open
 * attempt in the instant after a real selection to absorb that ghost tap.
 */
export const PokemonCombobox = forwardRef<PokemonComboboxHandle, PokemonComboboxProps>(function PokemonCombobox(
  { options, value, onChange, onSelected, placeholder, loadingLabel, noResultsLabel, disabled },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressReopenUntilRef = useRef(0);

  const selected = useMemo(() => options?.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function openList() {
    if (disabled || !options) return;
    if (Date.now() < suppressReopenUntilRef.current) return;
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      // On mobile the keyboard eats half the viewport — make sure the
      // field we just opened is actually visible above it.
      inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  useImperativeHandle(ref, () => ({ open: openList }));

  function select(option: SpeciesOption) {
    onChange(option.id);
    setOpen(false);
    setQuery('');
    suppressReopenUntilRef.current = Date.now() + 500;
    onSelected?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) select(option);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="pokemon-combobox" ref={rootRef} onKeyDown={onKeyDown}>
      {open ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="pokemon-combobox-input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => {
            // Deferred: an option tap blurs this input on its way in, and
            // we still need that same tap's click to land on the option.
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
            }, 0);
          }}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="pokemon-combobox-list"
        />
      ) : (
        <button
          type="button"
          className="pokemon-combobox-trigger"
          disabled={disabled || !options}
          onClick={openList}
        >
          {selected ? (
            <>
              <img className="pokemon-combobox-sprite" src={spriteUrl(selected.num)} alt="" />
              <span>{selected.name}</span>
            </>
          ) : (
            <span className="pokemon-combobox-placeholder">{options ? placeholder : loadingLabel}</span>
          )}
        </button>
      )}

      {open && (
        <ul className="pokemon-combobox-list" role="listbox" id="pokemon-combobox-list">
          {filtered.length === 0 && <li className="pokemon-combobox-empty">{noResultsLabel}</li>}
          {filtered.map((option, i) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              className={
                'pokemon-combobox-option' +
                (i === highlight ? ' pokemon-combobox-option--highlight' : '') +
                (option.id === value ? ' pokemon-combobox-option--selected' : '')
              }
              onClick={() => select(option)}
              onMouseEnter={() => setHighlight(i)}
            >
              {option.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
