import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authApi, useResetSession } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { useBasis, useMe, useTradingMonitor, useUpdateSettings } from '../api/hooks.ts';
import { lossAlertMessage } from '../features/journal/MonitorPanel.tsx';
import { useT } from '../i18n/index.tsx';
import { useNewsLive, useNewsStream } from '../lib/news-live.ts';
import { applyTheme, DEFAULT_ACCENT, systemTheme } from '../lib/theme.ts';
import { Onboarding } from '../features/onboarding/Onboarding.tsx';
import { NavIcon } from './NavIcon.tsx';
import { SessionClock, ThemeIcon } from './SessionClock.tsx';
import { IconButton, Logo, Sidebar } from './Sidebar.tsx';

export { APP_NAME } from './Sidebar.tsx';

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
    <div role="alert" className="mx-3 mt-3 flex sm:mx-4 lg:mx-6 lg:mt-4 flex-wrap items-center gap-3 rounded-(--radius) bg-sell px-5 py-3 text-on-side shadow-(--shadow)">
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

const COLLAPSED_KEY = 'sidebar-collapsed';

/** Folded side menu: remembered per browser; folded by default on narrower laptops. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored != null) return stored === '1';
    } catch {
      // No storage: fall back to the screen width.
    }
    return window.innerWidth < 1280;
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // The choice then lasts until the page is reloaded.
      }
      return !c;
    });
  return [collapsed, toggle] as const;
}

export function AppShell() {
  const t = useT();
  const { data: me, error } = useMe();
  const router = useRouter();
  const navigate = useNavigate();
  const resetSession = useResetSession();
  const signedOut = error instanceof ApiError && error.status === 401;
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [drawer, setDrawer] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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

  // The phone menu closes after moving to another screen, and with Escape.
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [drawer]);

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

  const theme = me?.settings.theme ?? 'dark';
  const accent = me?.settings.accentColor ?? DEFAULT_ACCENT;
  // Until /me arrives, the theme set by theme-init.js (last used) stays; applying the default would flash.
  useEffect(() => {
    if (me) applyTheme(theme, accent);
  }, [me, theme, accent]);

  // "system" shows (and switches away from) whatever the operating system uses now.
  const shownTheme = theme === 'system' ? systemTheme() : theme;
  const toggleTheme = () => update.mutate({ theme: shownTheme === 'dark' ? 'light' : 'dark' });

  if (signedOut) return null;
  // A new user first goes through the introduction (currency, favourites, account, strategy).
  if (me && !me.onboarded) return <Onboarding user={me} />;

  const menu = (mode: 'side' | 'drawer') =>
    me && (
      <Sidebar
        me={me}
        collapsed={mode === 'side' && collapsed}
        onToggleCollapsed={mode === 'side' ? toggleCollapsed : undefined}
        onClose={mode === 'drawer' ? () => setDrawer(false) : undefined}
        dots={{ calculator: basisAlert, news: newsUnseen }}
        shownTheme={shownTheme}
        onToggleTheme={toggleTheme}
        onSignOut={() => void signOut()}
      />
    );

  return (
    <div className="flex min-h-full">
      {/* Desktop: the side menu, full height, sticky while the page scrolls. */}
      <aside className={`sticky top-0 hidden h-dvh shrink-0 py-4 pl-4 transition-[width] duration-200 lg:block ${collapsed ? 'w-[5.5rem]' : 'w-[17rem]'}`}>{menu('side')}</aside>

      <div className="flex min-w-0 grow flex-col">
        {/* Phones and tablets: a slim bar with the menu button, the clock and the theme. */}
        <div className="sticky top-0 z-30 bg-bg/85 px-3 pt-3 backdrop-blur sm:px-4 lg:hidden">
          <header className="card flex h-14 items-center gap-2 rounded-(--radius-control) px-2">
            <IconButton label={t.nav.openMenu} onClick={() => setDrawer(true)}>
              <NavIcon name="menu" size={20} />
            </IconButton>
            <Logo />
            <div className="grow" />
            {me && <SessionClock timezone={me.settings.timezone} compact />}
            {me && (
              <IconButton label={shownTheme === 'dark' ? t.nav.toLight : t.nav.toDark} onClick={toggleTheme}>
                <ThemeIcon theme={shownTheme} />
              </IconButton>
            )}
          </header>
        </div>
        <LossStreakBanner />
        <Outlet />
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label={t.nav.closeMenu} onClick={() => setDrawer(false)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <aside aria-label={t.nav.main} className="absolute inset-y-0 left-0 w-[min(18rem,86vw)] p-3">
            {menu('drawer')}
          </aside>
        </div>
      )}
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
