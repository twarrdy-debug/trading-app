import { Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authApi, useResetSession } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { useBasis, useMe, useTradingMonitor, useUpdateSettings } from '../api/hooks.ts';
import { Segmented } from '../components/ui/Field.tsx';
import { lossAlertMessage } from '../features/journal/MonitorPanel.tsx';
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx';
import { useT, type Messages } from '../i18n/index.tsx';
import { useNewsLive, useNewsStream } from '../lib/news-live.ts';
import { ACCENT_OPTIONS, applyTheme, DEFAULT_ACCENT } from '../lib/theme.ts';

export const APP_NAME = '[NAZWA]';

const NAV = [
  { to: '/', label: 'journal' },
  { to: '/statystyki', label: 'stats' },
  { to: '/kalkulator', label: 'calculator' },
  { to: '/analiza', label: 'analysis' },
  { to: '/kalendarz', label: 'calendar' },
  { to: '/news', label: 'news' },
  // Signals are hidden from the menu for now; the page stays at /sygnaly.
] as const satisfies readonly { to: string; label: keyof Messages['nav'] }[];

const DISMISSED_KEY = 'monitor-dismissed-streak';

/** Page-wide warning after too many losing trades in a row; comes back after the next loss. */
function LossStreakBanner() {
  const t = useT();
  const { data: m } = useTradingMonitor();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  // Every account that reached the losses threshold; the banner names them.
  const alerted = m?.groups.filter((g) => g.alert) ?? [];
  const key = alerted.map((g) => g.alertKey).join('|');
  if (!m || alerted.length === 0 || dismissed === key) return null;

  const dismiss = () => {
    setDismissed(key);
    try {
      localStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // Without storage the banner simply shows again after a reload.
    }
  };
  const named = alerted.some((g) => g.name != null);

  return (
    <div role="alert" className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-(--radius) bg-sell px-5 py-3 text-on-side shadow-(--shadow) md:mx-8">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden className="shrink-0">
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 10v5M12 18v.01" />
      </svg>
      <p className="m-0 grow text-sm font-semibold">
        {alerted
          .map((g) => `${named ? `${g.name ?? t.accounts.none}: ` : ''}${lossAlertMessage(t, m.lossMode, g.lossCount)}`)
          .join(' ')}
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="h-9 rounded-(--radius-chip) bg-black/15 px-3.5 text-[13px] font-bold hover:bg-black/25"
      >
        {t.lossStreak.ok}
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
  const t = useT();
  const text = new Intl.DateTimeFormat(t.locale, {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return <span className="hidden font-mono text-xs whitespace-nowrap text-dim xl:inline">{text}</span>;
}

export function AppShell() {
  const t = useT();
  const { data: me, error } = useMe();
  const router = useRouter();
  const navigate = useNavigate();
  const resetSession = useResetSession();
  const signedOut = error instanceof ApiError && error.status === 401;

  // Without a session: to the sign-in page, coming back here afterwards.
  useEffect(() => {
    if (!signedOut) return;
    const { pathname, search } = router.state.location;
    const next = `${pathname}${search && Object.keys(search).length ? `?${new URLSearchParams(search as Record<string, string>)}` : ''}`;
    router.history.replace(`/logowanie${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
  }, [signedOut, router]);

  const signOut = async () => {
    await authApi.signOut().catch(() => undefined);
    await resetSession();
    await navigate({ to: '/logowanie' });
  };
  const update = useUpdateSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const basis = useBasis();
  // The calculator covers gold only, so only its difference alert matters here.
  const basisAlert = basis.data?.find((p) => p.pairKey === 'gold')?.alert ?? false;
  useNewsStream(Boolean(me), me?.settings.newsKeywords ?? [], t.news.alertTitle);
  const newsUnseen = useNewsLive().unseen > 0;
  const navDot = (to: string) =>
    to === '/kalkulator' && basisAlert ? (
      <span className="ml-1.5 inline-block size-2 rounded-full bg-sell align-middle" title={t.nav.basisChanged} />
    ) : to === '/news' && newsUnseen ? (
      <span className="ml-1.5 inline-block size-2 rounded-full bg-accent align-middle" title={t.nav.newsAlert} />
    ) : null;

  const theme = me?.settings.theme ?? 'dark';
  const accent = me?.settings.accentColor ?? DEFAULT_ACCENT;
  // Until /me arrives, the theme set by index.html (last used) stays; applying the default would flash.
  useEffect(() => {
    if (me) applyTheme(theme, accent);
  }, [me, theme, accent]);

  if (signedOut) return null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 bg-bg/85 px-4 pt-4 backdrop-blur md:px-8">
        <header className="card flex h-15 shrink-0 items-center gap-3 rounded-(--radius-control) pr-2 pl-4 lg:gap-5 xl:gap-6">
          <Link to="/" className="flex items-center gap-2.5 text-ink no-underline">
            <span className="flex size-8 items-center justify-center rounded-[9px] bg-accent">
              <svg width="18" height="18" viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 14h8l3-8 4 16 3-8h6" />
              </svg>
            </span>
            <span className="hidden text-[15px] font-bold sm:inline">{APP_NAME}</span>
          </Link>
          <nav aria-label={t.nav.main} className="hidden gap-1 text-sm lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-[10px] px-3.5 py-2 font-medium text-dim no-underline transition hover:bg-chip hover:text-ink"
                activeProps={{ className: '!bg-chip !font-bold !text-ink' }}
                activeOptions={{ exact: item.to === '/' }}
              >
                {t.nav[item.label]}
                {navDot(item.to)}
              </Link>
            ))}
          </nav>
          <div className="grow" />
          {me && <Clock timezone={me.settings.timezone} />}
          {me && (
            <>
              <Segmented
                label={t.nav.theme}
                value={theme}
                onChange={(value) => update.mutate({ theme: value })}
                options={[
                  { value: 'dark', label: t.nav.dark },
                  { value: 'light', label: t.nav.light },
                ]}
              />
              <div role="group" aria-label={t.nav.accent} className="hidden items-center gap-2 xl:flex">
                {ACCENT_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={t.nav.accentColor(color)}
                    aria-pressed={color.toLowerCase() === accent.toLowerCase()}
                    onClick={() => update.mutate({ accentColor: color })}
                    className="size-4 rounded-full border border-black/10 p-0"
                    style={{
                      background: color,
                      boxShadow: color.toLowerCase() === accent.toLowerCase() ? `0 0 0 2px var(--panel), 0 0 0 4px ${color}` : 'none',
                    }}
                  />
                ))}
              </div>
              {me.authenticated && (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  aria-label={t.auth.signOut}
                  title={t.auth.signOut}
                  className="flex size-10 items-center justify-center rounded-[11px] text-dim transition hover:bg-chip hover:text-ink"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t.nav.settings}
                className="flex size-10 items-center justify-center rounded-[11px] text-dim transition hover:bg-chip hover:text-ink"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
                </svg>
              </button>
            </>
          )}
        </header>
        <nav aria-label={t.nav.mobile} className="flex gap-1 overflow-x-auto pt-3 text-[13px] lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="shrink-0 rounded-[10px] px-3 py-2 font-medium text-dim no-underline"
              activeProps={{ className: '!bg-panel !font-bold !text-ink shadow-sm' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              {t.nav[item.label]}
              {navDot(item.to)}
            </Link>
          ))}
        </nav>
      </div>
      <LossStreakBanner />
      <Outlet />
      {me && settingsOpen && <SettingsDialog user={me} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Screens planned for later stages. */
export function ComingSoon({ module }: { module: 'analysis' | 'signals' }) {
  const t = useT().comingSoon;
  return (
    <main className="flex grow flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="eyebrow">{t[`${module}Stage`]}</span>
      <h1 className="m-0 text-2xl font-bold tracking-tight">{t[`${module}Title`]}</h1>
      <p className="m-0 max-w-md text-dim">{t.text}</p>
    </main>
  );
}
