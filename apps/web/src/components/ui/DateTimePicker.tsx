import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { currentLocale } from '../../lib/format.ts';
import { FieldLabelContext } from './Field.tsx';

/**
 * Date (and time) picker drawn in the app's theme, replacing the browser's own calendar popup.
 * The value is local time as <input type="datetime-local"> writes it ("2026-10-05T14:30"), or a
 * plain date ("2026-10-05") with `mode="date"`; '' is empty.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  mode?: 'datetime' | 'date';
  /** Allows clearing the value (e.g. an optional close time or a filter). */
  clearable?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowLocal = () => {
  const d = new Date();
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const parse = (value: string) => {
  const [date = '', time = ''] = value.split('T');
  return { date, time: time.slice(0, 5) };
};

export function DateTimePicker({ value, onChange, mode = 'datetime', clearable = false, placeholder, className = '', ...props }: Props) {
  const all = useT();
  const t = all.picker;
  const language = useLanguage();
  const labelId = useContext(FieldLabelContext);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const { date, time } = parse(value);
  const today = isoDate(new Date());
  const [month, setMonth] = useState(() => (date || today).slice(0, 7));
  const [focusDay, setFocusDay] = useState(date || today);
  // Monday first in Polish, Sunday first in English, as calendars there are.
  const sundayFirst = language === 'en';

  const place = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    const height = mode === 'datetime' ? 400 : 340;
    const left = Math.min(box.left, window.innerWidth - 300 - 8);
    setPosition(window.innerHeight - box.bottom < height && box.top > height ? { left, bottom: window.innerHeight - box.top + 4 } : { left, top: box.bottom + 4 });
  };
  const show = () => {
    const start = date || today;
    setMonth(start.slice(0, 7));
    setFocusDay(start);
    place();
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay, month]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    // The page moving (scrolled, or a phone's keyboard pushing it up for the hour box) moves the
    // panel with its field rather than closing it: closing made the time impossible to set on phones.
    const onScroll = (e: Event) => !panelRef.current?.contains(e.target as Node) && place();
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  });

  const commit = (nextDate: string, nextTime = time || (value ? time : nowLocal().slice(11))) =>
    onChange(mode === 'date' ? nextDate : `${nextDate}T${nextTime || '00:00'}`);
  const pickDay = (day: string) => {
    commit(day);
    if (mode === 'date') close();
  };

  // Grid of the month: leading days from the previous month, six weeks at most.
  const first = new Date(`${month}-01T12:00:00`);
  const lead = (first.getDay() - (sundayFirst ? 0 : 1) + 7) % 7;
  const days: string[] = [];
  for (let i = -lead; days.length < 42; i++) {
    const d = new Date(first);
    d.setDate(1 + i);
    days.push(isoDate(d));
    if (days.length >= 35 && d.getMonth() !== first.getMonth() && days.length % 7 === 0) break;
  }
  const weekdays = days.slice(0, 7).map((d) => new Intl.DateTimeFormat(currentLocale(), { weekday: 'narrow' }).format(new Date(`${d}T12:00:00`)));
  const monthTitle = new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric' }).format(first);
  const shiftMonth = (by: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + by);
    setMonth(isoDate(d).slice(0, 7));
  };
  const moveFocus = (byDays: number) => {
    const d = new Date(`${focusDay}T12:00:00`);
    d.setDate(d.getDate() + byDays);
    const next = isoDate(d);
    setFocusDay(next);
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
  };
  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(moves[e.key]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const [hour = '', minute = ''] = time.split(':');
  // What is being typed in the hour or minute box: kept as typed ("1" on the way to "14") and
  // committed whenever it is a valid number; padded to two digits once the box is left.
  const [draft, setDraft] = useState<{ part: 'h' | 'm'; text: string } | null>(null);
  const setTime = (h: number, m: number) => commit(date || today, `${pad(Math.min(23, Math.max(0, h)))}:${pad(Math.min(59, Math.max(0, m)))}`);
  const timeBox = (part: 'h' | 'm') => {
    const shown = part === 'h' ? hour : minute;
    const max = part === 'h' ? 23 : 59;
    const apply = (n: number) => (part === 'h' ? setTime(n, Number(minute) || 0) : setTime(Number(hour) || 0, n));
    return {
      value: draft?.part === part ? draft.text : shown,
      onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select(),
      onBlur: () => setDraft(null),
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const text = e.target.value.replace(/\D/g, '').slice(0, 2);
        setDraft({ part, text });
        if (text !== '' && Number(text) <= max) apply(Number(text));
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        setDraft(null);
        // Wraps around: 23 → 00, 00 → 23 (59 → 00 for minutes).
        apply(((Number(shown) || 0) + (e.key === 'ArrowUp' ? 1 : -1) + max + 1) % (max + 1));
      },
    };
  };

  const display = value
    ? new Intl.DateTimeFormat(currentLocale(), mode === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(mode === 'date' ? `${date}T12:00:00` : value),
      )
    : (placeholder ?? '');

  return (
    <>
      <span className={`relative flex ${className}`}>
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-label'] ? undefined : labelId ? `${labelId} ${id}-value` : undefined}
          onClick={() => (open ? close() : show())}
          onKeyDown={(e) => e.key === 'ArrowDown' && (e.preventDefault(), show())}
          className={`flex h-11 w-full items-center gap-2 rounded-(--radius-control) border bg-raised px-3 text-left text-sm transition hover:border-dim/40 ${
            open ? 'border-accent-ink bg-panel' : 'border-line'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className="shrink-0 text-dim">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span id={`${id}-value`} className={`grow truncate font-mono ${value ? 'text-ink' : 'text-dim'}`}>
            {display}
          </span>
        </button>
        {clearable && value && (
          <button
            type="button"
            aria-label={t.clear}
            onClick={() => onChange('')}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-dim hover:bg-chip hover:text-ink"
          >
            ✕
          </button>
        )}
      </span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={`${id}-panel`}
            role="dialog"
            aria-label={props['aria-label'] ?? t.title}
            style={{ position: 'fixed', ...position, width: 296 }}
            className="z-50 flex flex-col gap-3 rounded-(--radius-control) border border-line bg-panel p-3 text-ink shadow-(--shadow-pop)"
          >
            <div className="flex items-center gap-1">
              <button type="button" aria-label={t.prevMonth} onClick={() => shiftMonth(-1)} className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-chip hover:text-ink">
                ‹
              </button>
              <span className="grow text-center text-sm font-semibold capitalize" aria-live="polite">
                {monthTitle}
              </span>
              <button type="button" aria-label={t.nextMonth} onClick={() => shiftMonth(1)} className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-chip hover:text-ink">
                ›
              </button>
            </div>
            <div role="grid" aria-label={monthTitle} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 text-center">
              {weekdays.map((w, i) => (
                <span key={i} role="columnheader" className="pb-1 text-[11px] font-semibold text-dim uppercase">
                  {w}
                </span>
              ))}
              {days.map((d) => {
                const inMonth = d.slice(0, 7) === month;
                const selected = d === date;
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    data-day={d}
                    tabIndex={d === focusDay ? 0 : -1}
                    aria-selected={selected}
                    aria-label={new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'full' }).format(new Date(`${d}T12:00:00`))}
                    onClick={() => pickDay(d)}
                    className={`flex h-9 items-center justify-center rounded-lg font-mono text-[13px] transition ${
                      selected ? 'bg-accent font-bold text-on-accent' : d === today ? 'font-bold text-accent-ink ring-1 ring-accent-ink/50' : inMonth ? 'hover:bg-chip' : 'text-dim/60 hover:bg-chip'
                    }`}
                  >
                    {Number(d.slice(8))}
                  </button>
                );
              })}
            </div>
            {mode === 'datetime' && (
              // Two lines when the row does not fit (it used to push "Done" outside the panel).
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-xs text-dim">{t.time}</span>
                <input
                  aria-label={t.hour}
                  inputMode="numeric"
                  maxLength={2}
                  {...timeBox('h')}
                  className="h-9 w-12 rounded-lg border border-line bg-raised text-center font-mono text-sm outline-none focus:border-accent-ink"
                />
                <span className="font-mono">:</span>
                <input
                  aria-label={t.minute}
                  inputMode="numeric"
                  maxLength={2}
                  {...timeBox('m')}
                  className="h-9 w-12 rounded-lg border border-line bg-raised text-center font-mono text-sm outline-none focus:border-accent-ink"
                />
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(nowLocal());
                      close();
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent-ink hover:bg-chip"
                  >
                    {t.now}
                  </button>
                  <button type="button" onClick={() => close()} className="rounded-lg bg-chip px-2.5 py-1.5 text-xs font-semibold hover:brightness-110">
                    {t.done}
                  </button>
                </span>
              </div>
            )}
            {mode === 'date' && (
              <div className="flex justify-between border-t border-line pt-2">
                <button type="button" onClick={() => pickDay(today)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent-ink hover:bg-chip">
                  {t.today}
                </button>
                {clearable && value && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('');
                      close();
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dim hover:bg-chip"
                  >
                    {t.clear}
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
