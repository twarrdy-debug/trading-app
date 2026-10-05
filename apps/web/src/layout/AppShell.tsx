import { Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authApi, useResetSession } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { useBasis, useMe, useTradingMonitor, useUpdateSettings } from '../api/hooks.ts';
import { lossAlertMessage } from '../features/journal/MonitorPanel.tsx';
import { useT, type Messages } from '../i18n/index.tsx';
import { useNewsLive, useNewsStream } from '../lib/news-live.ts';
import { applyTheme, DEFAULT_ACCENT, systemTheme } from '../lib/theme.ts';
import { Onboarding } from '../features/onboarding/Onboarding.tsx';
import { SessionClock, ThemeIcon } from './SessionClock.tsx';

export const APP_NAME = '[NAZWA]';

const NAV = [
  { to: '/', label: 'dashboard' },
  { to: '/dziennik', label: 'journal' },
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
    // The bare address shows guests the public page; any other one asks them to sign in.
    if (pathname === '/') {
      router.history.replace('/start');
      return;
    }
    const next = `${pathname}${search && Object.keys(search).length ? `?${new URLSearchParams(search as Record<string, string>)}` : ''}`;
    router.history.replace(`/logowanie${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
  }, [signedOut, router]);

  const signOut = async () => {
    await authApi.signOut().catch(() => undefined);
    await resetSession();
    await navigate({ to: '/logowanie' });
  };
  const update = useUpdateSettings();
  const basis = useBasis();
  // A changed CFD/futures difference on any market the calculator covers.
  const basisAlert = basis.data?.some((p) => p.alert) ?? false;
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

  // "system" shows (and switches away from) whatever the operating system uses now.
  const shownTheme = theme === 'system' ? systemTheme() : theme;

  if (signedOut) return null;
  // A new user first goes through the introduction (currency, favourites, account, strategy).
  if (me && !me.onboarded) return <Onboarding user={me} />;

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
                className="rounded-[10px] px-3 py-2 font-medium whitespace-nowrap text-dim no-underline transition hover:bg-chip hover:text-ink xl:px-3.5"
                activeProps={{ className: '!bg-chip !font-bold !text-ink' }}
                activeOptions={{ exact: item.to === '/' }}
              >
                {t.nav[item.label]}
                {navDot(item.to)}
              </Link>
            ))}
          </nav>
          <div className="grow" />
          {me && <SessionClock timezone={me.settings.timezone} />}
          {me && (
            <>
              <button
                type="button"
                onClick={() => update.mutate({ theme: shownTheme === 'dark' ? 'light' : 'dark' })}
                aria-label={shownTheme === 'dark' ? t.nav.toLight : t.nav.toDark}
                title={shownTheme === 'dark' ? t.nav.toLight : t.nav.toDark}
                className="flex size-10 items-center justify-center rounded-[11px] text-dim transition hover:bg-chip hover:text-ink"
              >
                <ThemeIcon theme={shownTheme} />
              </button>
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
              <Link
                to="/ustawienia"
                aria-label={t.nav.settings}
                title={t.nav.settings}
                className="flex h-10 items-center gap-2 rounded-[11px] px-2.5 text-sm font-medium text-dim no-underline transition hover:bg-chip hover:text-ink"
                activeProps={{ className: '!bg-chip !font-bold !text-ink' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {/* Classic cog (Lucide "settings", ISC). */}
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {/* Hidden from lg to 2xl, where the full menu and the clock leave no room for it. */}
                <span className="lg:hidden 2xl:inline">{t.nav.settings}</span>
              </Link>
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
