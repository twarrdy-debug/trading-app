import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { FieldLabelContext } from './Field.tsx';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Options with the same group are listed under that heading. */
  group?: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Needed outside a <Field>; inside one the field label names the control. */
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

const MAX_HEIGHT = 288;

/**
 * Drop-down list drawn in the app's theme (native <select> menus follow the operating system).
 * Follows the WAI-ARIA "select-only combobox" pattern: focus stays on the button and the active
 * option is announced through aria-activedescendant. Arrow keys, Home/End, Enter/Space, Escape
 * and typing the first letters work as in a native select.
 */
export function Select<T extends string>({ value, options, onChange, disabled, className = '', ...props }: SelectProps<T>) {
  const labelId = useContext(FieldLabelContext);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; width: number; top?: number; bottom?: number }>({ left: 0, width: 0 });
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options.find((o) => o.value === value);

  const place = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom;
    // Opens upwards when there is not enough room below.
    setPosition(
      below < Math.min(MAX_HEIGHT, options.length * 40 + 8) && box.top > below
        ? { left: box.left, width: box.width, bottom: window.innerHeight - box.top + 4 }
        : { left: box.left, width: box.width, top: box.bottom + 4 },
    );
  };

  const show = (index = selectedIndex) => {
    if (disabled) return;
    place();
    setActive(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    buttonRef.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const reposition = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', place);
    };
  });

  /** Jumps to the next option starting with the letters typed within the last second. */
  const typeAhead = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 1000 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const start = open ? active : selectedIndex;
    const order = [...options.keys()].map((i) => (start + 1 + i) % options.length);
    const match = order.find((i) => options[i]!.label.toLowerCase().startsWith(typed.current.text));
    if (match == null) return;
    if (open) setActive(match);
    else if (options[match]!.value !== value) onChange(options[match]!.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) typeAhead(e.key);
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
      PageDown: Math.min(last, active + 8),
      PageUp: Math.max(0, active - 8),
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]!);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      // Keeps an enclosing <dialog> open.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      typeAhead(e.key);
    }
  };

  // Inside a modal <dialog> the list must render in the dialog (top layer), elsewhere in <body>.
  const container = buttonRef.current?.closest('dialog') ?? document.body;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-labelledby={props['aria-label'] ? undefined : labelId ? `${labelId} ${id}-value` : undefined}
        aria-label={props['aria-label']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-(--radius-control) border bg-raised px-3 text-left text-sm text-ink transition hover:border-dim/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-accent-ink bg-panel' : 'border-line'
        } ${className}`}
      >
        <span id={`${id}-value`} className="truncate">
          {selected?.label ?? ''}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={`shrink-0 text-dim transition ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            aria-label={props['aria-label']}
            className="fixed z-50 m-0 flex list-none flex-col gap-0.5 overflow-auto rounded-(--radius-control) border border-line bg-panel p-1 text-sm text-ink shadow-(--shadow-pop)"
            style={{ ...position, minWidth: position.width, width: 'max-content', maxWidth: 'min(480px, calc(100vw - 16px))', maxHeight: MAX_HEIGHT }}
          >
            {options.map((option, i) => {
              const heading = option.group && option.group !== options[i - 1]?.group;
              return (
                <li key={`${option.group ?? ''}${option.value}`} role="presentation" className="contents">
                  {heading && (
                    <span role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold text-dim">
                      {option.group}
                    </span>
                  )}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={option.value === value}
                    data-index={i}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-[9px] px-3 py-2 ${
                      i === active ? 'bg-chip' : ''
                    } ${option.value === value ? 'font-bold' : ''}`}
                  >
                    <span>{option.label}</span>
                    {option.value === value && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="2.5" aria-hidden>
                        <path d="M5 12.5 10 17l9-10" />
                      </svg>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>,
          container,
        )}
    </>
  );
}
