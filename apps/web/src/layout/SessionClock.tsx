import { isBankHoliday, localDayBounds, marketSessions, toLocalDate, zonedTimeToUtc, type SessionKey } from '@trading/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCalendar } from '../api/hooks.ts';
import { useT } from '../i18n/index.tsx';
import { addDays } from '../lib/format.ts';

// Clock for traders (side menu, or the top bar on phones): the time in the user's zone plus a 24-hour strip of the four FX
// sessions (Sydney, Tokyo, London, New York). Open sessions light up in the accent (ink) colour and a
// line marks "now"; the tooltip tells when each one opens or closes, and a click opens the full chart.

const TRACK_H = 3;
const GAP = 2;
const WIDTH = 104;

const hm = (d: Date, timeZone: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(d);

function duration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * `placement`: where the full chart opens (below in a top bar, to the right in the side menu).
 * `compact`: the time alone (collapsed side menu, phone top bar).
 */
export function SessionClock({ timezone, placement = 'below', compact = false }: { timezone: string; placement?: 'below' | 'right'; compact?: boolean }) {
  const all = useT();
  const t = all.nav;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const holidayOn = useBankHolidays(now, timezone);
  // A session in its city's bank holiday counts as closed.
  const sessions = marketSessions(now, timezone).map((s) => ({ ...s, open: s.open && !holidayOn(s, s.current.date) }));
  const day = localDayBounds(now, timezone);
  const span = day.end.getTime() - day.start.getTime();
  const x = (d: Date) => (Math.min(Math.max(d.getTime() - day.start.getTime(), 0), span) / span) * WIDTH;
  const openKeys = sessions.filter((s) => s.open).map((s) => s.key);

  const [hours, minutes] = hm(now, timezone, all.locale).split(':');
  // "śr 30.09": the locale's short weekday without its dot, then day and month.
  const weekday = new Intl.DateTimeFormat(all.locale, { weekday: 'short', timeZone: timezone }).format(now).replace(/\.$/, '');
  const dayMonth = new Intl.DateTimeFormat(all.locale, { day: '2-digit', month: '2-digit', timeZone: timezone }).format(now);
  const date = `${weekday} ${dayMonth.replace('/', '.')}`;
  const tooltip = sessions
    .map((s) => {
      const name = t.sessions[s.key as SessionKey];
      const window = `${hm(s.current.start, timezone, all.locale)}–${hm(s.current.end, timezone, all.locale)}`;
      if (holidayOn(s, s.current.date)) return `${name} · ${t.sessionHoliday[s.key as SessionKey]}`;
      return s.open
        ? t.sessionOpen(name, window, duration(s.current.end.getTime() - now.getTime()))
        : t.sessionClosed(name, window, duration(s.current.start.getTime() - now.getTime()));
    })
    .join('\n');
  const height = sessions.length * TRACK_H + (sessions.length - 1) * GAP;

  // The full chart opens under the clock; a click outside or Escape closes it.
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // In the side menu the chart floats over the page next to the clock (the menu may scroll and clip it).
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || placement !== 'right') return;
    const box = wrapper.current?.getBoundingClientRect();
    if (box) setAnchor({ top: box.top, left: box.right + 12 });
  }, [open, placement]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      const inside = (node: Node) => wrapper.current?.contains(node) || panel.current?.contains(node);
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={wrapper} className={placement === 'right' && !compact ? 'relative w-full' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${hours}:${minutes}. ${t.sessionsTitle}`}
        title={open ? undefined : tooltip}
        className={`flex h-11 items-center gap-3 rounded-(--radius-control) py-1 text-left transition ${compact ? 'justify-center px-2.5' : 'pr-3.5 pl-3'} ${
          placement === 'right' && !compact ? 'w-full justify-between' : ''
        } ${open ? 'bg-raised ring-1 ring-line' : 'bg-chip hover:bg-raised'}`}
      >
        <span className="flex flex-col items-start leading-none">
          <span className="font-mono text-[17px] font-medium tracking-tight tabular-nums">
            {hours}
            <span className="clock-colon text-accent-ink">:</span>
            {minutes}
          </span>
          {!compact && <span className="mt-1 text-[10px] font-semibold text-dim">{date}</span>}
        </span>
        <span className={compact ? 'hidden' : placement === 'right' ? 'flex flex-col gap-1' : 'hidden flex-col gap-1 xl:flex'}>
          <svg width={WIDTH} height={height + 4} viewBox={`0 -2 ${WIDTH} ${height + 4}`} aria-hidden className="overflow-visible">
            {sessions.map((s, i) => {
              const y = i * (TRACK_H + GAP);
              return (
                <g key={s.key}>
                  <rect x={0} y={y} width={WIDTH} height={TRACK_H} rx={TRACK_H / 2} fill="var(--line)" />
                  {s.today.map((w) => (
                    <rect
                      key={w.start.toISOString()}
                      x={x(w.start)}
                      y={y}
                      width={Math.max(x(w.end) - x(w.start), 2)}
                      height={TRACK_H}
                      rx={TRACK_H / 2}
                      fill={s.open && w.start <= now && now < w.end ? 'var(--accent-ink)' : 'var(--dim)'}
                      opacity={s.open && w.start <= now && now < w.end ? 1 : 0.35}
                    />
                  ))}
                </g>
              );
            })}
            <line x1={x(now)} x2={x(now)} y1={-2} y2={height + 2} stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
          <span className="font-mono text-[10px] leading-none font-medium text-dim">
            {openKeys.length ? openKeys.map((k) => t.sessionCodes[k]).join(' · ') : t.marketsClosed}
          </span>
        </span>
      </button>
      {open && placement === 'below' && <SessionsPanel now={now} timezone={timezone} sessions={sessions} holidayOn={holidayOn} />}
      {open &&
        placement === 'right' &&
        anchor &&
        createPortal(
          <div ref={panel} className="fixed z-50" style={anchor}>
            <SessionsPanel now={now} timezone={timezone} sessions={sessions} holidayOn={holidayOn} floating />
          </div>,
          document.body,
        )}
    </div>
  );
}

type HolidayLookup = (session: { currency: string; zone: string }, date: string | undefined) => { title: string; currency: string } | undefined;

/** Bank holidays of the session cities around today, from the economic calendar (Forex Factory). */
function useBankHolidays(now: Date, timezone: string): HolidayLookup {
  const today = toLocalDate(now, timezone);
  const { data } = useCalendar({ from: addDays(today, -1), to: addDays(today, 1), impacts: ['holiday'] });
  const holidays = (data?.events ?? []).filter(isBankHoliday);
  return (session, date) => holidays.find((e) => e.currency === session.currency && toLocalDate(new Date(e.eventTime), session.zone) === date);
}

const PANEL_W = 560;
const ROW_H = 26;
const ROW_GAP = 6;
const AXIS_H = 26;

/**
 * The full sessions chart (opened from the header clock): the user's day with an hour axis, one
 * staggered bar per session labelled with the city's own time, a "now" line, and the city's bank
 * holiday from the economic calendar in place of its session.
 */
function SessionsPanel({
  now,
  timezone,
  sessions,
  holidayOn,
  floating = false,
}: {
  now: Date;
  timezone: string;
  sessions: ReturnType<typeof marketSessions>;
  holidayOn: HolidayLookup;
  /** Placed by its parent (the side menu's floating layer) rather than under the clock. */
  floating?: boolean;
}) {
  const all = useT();
  const t = all.nav;
  const today = toLocalDate(now, timezone);
  const day = localDayBounds(now, timezone);
  const span = day.end.getTime() - day.start.getTime();
  const pct = (d: Date) => (Math.min(Math.max(d.getTime() - day.start.getTime(), 0), span) / span) * 100;
  const hours = Array.from({ length: 12 }, (_, i) => i * 2);
  const hourAt = (h: number) => pct(zonedTimeToUtc(`${today}T${String(h).padStart(2, '0')}:00:00`, timezone));

  const weekend = sessions.every((s) => s.today.length === 0);

  return (
    <div
      role="dialog"
      aria-label={t.sessionsTitle}
      className={`card z-50 p-4 shadow-(--shadow-pop) ${floating ? '' : 'absolute top-full right-0 mt-2'}`}
      // Never wider than the screen (phones).
      style={{ width: `min(${PANEL_W}px, calc(100vw - 2rem))` }}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[15px] font-bold">{t.sessionsTitle}</span>
        <span className="text-xs text-dim">{t.sessionsZone(timezone)}</span>
      </div>
      <div className="relative" style={{ height: AXIS_H + sessions.length * (ROW_H + ROW_GAP) }}>
        {/* Hour axis */}
        <div className="absolute inset-x-0 top-0 rounded-md bg-chip" style={{ height: AXIS_H - 6 }}>
          {hours.map((h) => (
            <span key={h} className="absolute top-0 flex h-full -translate-x-1/2 flex-col items-center justify-between py-0.5" style={{ left: `${hourAt(h)}%` }}>
              <span className="font-mono text-[10px] leading-none text-dim">{h}</span>
              <span className="h-1.5 w-px bg-dim/50" />
            </span>
          ))}
        </div>
        {/* Sessions, one row each */}
        {sessions.map((s, i) => {
          const top = AXIS_H + i * (ROW_H + ROW_GAP);
          const name = t.sessions[s.key as SessionKey];
          const local = hm(now, s.zone, all.locale);
          // The label goes on the longest piece of the day (Sydney's day is split around midnight).
          const longest = [...s.today].sort((a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()))[0];
          return s.today.map((w) => {
            const holiday = holidayOn(s, w.date);
            const live = !holiday && s.open && w.start <= now && now < w.end;
            const left = pct(w.start);
            const width = Math.max(pct(w.end) - left, 0.6);
            return (
              <div
                key={`${s.key}-${w.start.toISOString()}`}
                title={holiday ? `${holiday.title} (${holiday.currency})` : `${name} ${hm(w.start, timezone, all.locale)}–${hm(w.end, timezone, all.locale)}`}
                className={`absolute flex items-center justify-center overflow-hidden rounded-md px-2 text-xs whitespace-nowrap ${
                  holiday
                    ? 'border border-dashed border-dim/60 bg-panel text-dim'
                    : live
                      ? 'bg-accent/20 text-ink ring-1 ring-accent-ink/60'
                      : 'bg-chip text-dim'
                }`}
                style={{ top, height: ROW_H, left: `${left}%`, width: `${width}%` }}
              >
                {w === longest &&
                  (holiday ? (
                    <span className="truncate">{t.sessionHoliday[s.key as SessionKey]}</span>
                  ) : (
                    <span className="truncate">
                      <span className={`font-bold ${live ? 'text-ink' : 'text-ink/80'}`}>{name}</span>
                      <span className="font-mono"> {t.sessionLocal(local)}</span>
                    </span>
                  ))}
              </div>
            );
          });
        })}
        {/* Now */}
        <div className="pointer-events-none absolute w-0.5 rounded-full bg-accent-ink" style={{ left: `${pct(now)}%`, top: AXIS_H - 8, bottom: 0 }} />
        {weekend && (
          <p className="absolute inset-x-0 m-0 text-center text-[13px] text-dim" style={{ top: AXIS_H + 2 * (ROW_H + ROW_GAP) - ROW_H / 2 }}>
            {t.weekendClosed}
          </p>
        )}
      </div>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 border-t border-line p-0 pt-3 text-xs text-dim">
        {sessions.map((s) => {
          const name = t.sessions[s.key as SessionKey];
          return (
            <li key={s.key}>
              <span className={s.open ? 'font-semibold text-ink' : ''}>{name}</span>{' '}
              {holidayOn(s, s.current.date)
                ? t.holidayShort
                : s.open
                  ? t.closesIn(duration(s.current.end.getTime() - now.getTime()))
                  : t.opensIn(duration(s.current.start.getTime() - now.getTime()))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Sun (light theme) or crescent moon (dark theme); the icon turns into the other one on switch. */
export function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
  const common = 'absolute inset-0 m-auto transition duration-300 ease-out';
  return (
    <span className="relative block size-[18px]" aria-hidden>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className={`${common} ${theme === 'light' ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0'}`}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${common} ${theme === 'dark' ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-90 opacity-0'}`}
      >
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    </span>
  );
}
