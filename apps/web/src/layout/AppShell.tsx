import { Link, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBasis, useMe, useTradingMonitor, useUpdateSettings } from '../api/hooks.ts';
import { Segmented } from '../components/ui/Field.tsx';
import { tradesWord } from '../features/journal/MonitorPanel.tsx';
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx';
import { ACCENT_OPTIONS, applyTheme, DEFAULT_ACCENT } from '../lib/theme.ts';

export const APP_NAME = '[NAZWA]';

const NAV = [
  { to: '/', label: 'Dziennik' },
  { to: '/statystyki', label: 'Statystyki' },
  { to: '/kalkulator', label: 'Kalkulator' },
  { to: '/analiza', label: 'Analiza' },
  { to: '/kalendarz', label: 'Kalendarz' },
  { to: '/sygnaly', label: 'Sygnały' },
] as const;

const DISMISSED_KEY = 'monitor-dismissed-streak';

/** Page-wide warning after too many losing trades in a row; comes back after the next loss. */
function LossStreakBanner() {
  const { data: m } = useTradingMonitor();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  if (!m?.alert || dismissed === m.streakKey) return null;

  const dismiss = () => {
    setDismissed(m.streakKey);
    try {
      localStorage.setItem(DISMISSED_KEY, m.streakKey);
    } catch {
      // Without storage the banner simply shows again after a reload.
    }
  };

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-sell bg-sell px-4 py-3 text-on-side md:px-8">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden className="shrink-0">
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 10v5M12 18v.01" />
      </svg>
      <p className="m-0 grow text-sm font-semibold tracking-[0.04em]">
        {m.lossStreak} {tradesWord(m.lossStreak)} z rzędu skończyły się niepowodzeniem. Trzymaj się zasad i nie overtraduj!
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="h-9 border border-current px-3 text-xs font-bold tracking-[0.14em] uppercase hover:bg-black/10"
      >
        Rozumiem
      </button>
    </div>
  );
}

function Clock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const text = new Intl.DateTimeFormat('pl-PL', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return <span className="hidden font-mono text-[13px] whitespace-nowrap text-dim xl:inline">{text}</span>;
}

export function AppShell() {
  const { data: me } = useMe();
  const update = useUpdateSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const basis = useBasis();
  // The calculator covers gold only, so only its difference alert matters here.
  const basisAlert = basis.data?.find((p) => p.pairKey === 'gold')?.alert ?? false;

  const theme = me?.settings.theme ?? 'dark';
  const accent = me?.settings.accentColor ?? DEFAULT_ACCENT;
  useEffect(() => applyTheme(theme, accent), [theme, accent]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-17 shrink-0 items-center gap-3 border-b border-line bg-bg px-4 md:gap-8 md:px-8">
        <Link to="/" className="flex items-center gap-3 text-ink no-underline">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--accent)" strokeWidth="2" aria-hidden>
            <path d="M2 14h8l3-8 4 16 3-8h6" />
          </svg>
          <span className="hidden text-sm font-bold tracking-[0.18em] sm:inline">{APP_NAME}</span>
        </Link>
        <nav aria-label="Główna nawigacja" className="hidden gap-1 text-[13px] font-semibold tracking-[0.12em] uppercase md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="border-b-2 border-transparent px-3.5 py-2.5 text-dim no-underline hover:text-ink"
              activeProps={{ className: '!border-accent !text-ink' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              {item.label}
              {item.to === '/kalkulator' && basisAlert && (
                <span className="ml-1.5 inline-block size-2 rotate-45 bg-sell align-middle" title="Różnica CFD/futures się zmieniła" />
              )}
            </Link>
          ))}
        </nav>
        <div className="grow" />
        {me && <Clock timezone={me.settings.timezone} />}
        {me && (
          <>
            <Segmented
              label="Motyw"
              value={theme}
              onChange={(value) => update.mutate({ theme: value })}
              options={[
                { value: 'dark', label: 'Ciemny' },
                { value: 'light', label: 'Jasny' },
              ]}
            />
            <div role="group" aria-label="Kolor wiodący" className="hidden items-center gap-2.5 lg:flex">
              {ACCENT_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Kolor wiodący ${color}`}
                  aria-pressed={color.toLowerCase() === accent.toLowerCase()}
                  onClick={() => update.mutate({ accentColor: color })}
                  className="size-5 rotate-45 border border-line p-0"
                  style={{
                    background: color,
                    boxShadow: color.toLowerCase() === accent.toLowerCase() ? `0 0 0 2px var(--bg), 0 0 0 4px ${color}` : 'none',
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Ustawienia"
              className="flex size-11 items-center justify-center text-dim hover:text-ink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
              </svg>
            </button>
          </>
        )}
      </header>
      <nav aria-label="Nawigacja" className="flex gap-1 overflow-x-auto border-b border-line px-2 text-xs font-semibold tracking-[0.12em] uppercase md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="shrink-0 border-b-2 border-transparent px-3 py-3 text-dim no-underline"
            activeProps={{ className: '!border-accent !text-ink' }}
            activeOptions={{ exact: item.to === '/' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <LossStreakBanner />
      <Outlet />
      {me && settingsOpen && <SettingsDialog user={me} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Screens planned for later stages. */
export function ComingSoon({ title, stage }: { title: string; stage: string }) {
  return (
    <main className="flex grow flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="eyebrow">{stage}</span>
      <h1 className="m-0 text-2xl font-semibold tracking-[0.12em] uppercase">{title}</h1>
      <p className="m-0 max-w-md text-dim">Ten moduł powstanie w kolejnym etapie prac.</p>
    </main>
  );
}
