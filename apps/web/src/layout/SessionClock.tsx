import { localDayBounds, marketSessions, type SessionKey } from '@trading/shared';
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.tsx';

// Header clock for traders: the time in the user's zone plus a 24-hour strip of the four FX
// sessions (Sydney, Tokyo, London, New York). Open sessions light up in the accent (ink) colour and a
// line marks "now"; the tooltip tells when each one opens or closes.

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

export function SessionClock({ timezone }: { timezone: string }) {
  const all = useT();
  const t = all.nav;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const sessions = marketSessions(now, timezone);
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
      return s.open
        ? t.sessionOpen(name, window, duration(s.current.end.getTime() - now.getTime()))
        : t.sessionClosed(name, window, duration(s.current.start.getTime() - now.getTime()));
    })
    .join('\n');
  const height = sessions.length * TRACK_H + (sessions.length - 1) * GAP;

  return (
    <div
      role="timer"
      aria-label={`${hours}:${minutes}. ${tooltip}`}
      title={tooltip}
      className="hidden h-11 items-center gap-3 rounded-(--radius-control) bg-chip py-1 pr-3.5 pl-3 lg:flex"
    >
      <span className="flex flex-col items-start leading-none">
        <span className="font-mono text-[17px] font-medium tracking-tight tabular-nums">
          {hours}
          <span className="clock-colon text-accent-ink">:</span>
          {minutes}
        </span>
        <span className="mt-1 text-[10px] font-semibold text-dim">{date}</span>
      </span>
      <span className="hidden flex-col gap-1 xl:flex">
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
