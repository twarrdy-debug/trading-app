import type { PublicUser } from '@trading/api/types';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useT, type Messages } from '../i18n/index.tsx';
import { NavIcon, type NavIconName } from './NavIcon.tsx';
import { SessionClock, ThemeIcon } from './SessionClock.tsx';

export const APP_NAME = '[NAZWA]';

export const NAV = [
  { to: '/', label: 'dashboard', icon: 'dashboard' },
  { to: '/transakcje', label: 'trades', icon: 'trades' },
  { to: '/dziennik', label: 'journal', icon: 'journal' },
  { to: '/statystyki', label: 'stats', icon: 'stats' },
  { to: '/analiza', label: 'analysis', icon: 'analysis' },
  { to: '/kalkulator', label: 'calculator', icon: 'calculator' },
  { to: '/kalendarz', label: 'calendar', icon: 'calendar' },
  { to: '/news', label: 'news', icon: 'news' },
  // Signals are hidden from the menu for now; the page stays at /sygnaly.
] as const satisfies readonly { to: string; label: keyof Messages['nav']; icon: NavIconName }[];

/** Shown in the menu only for the admin role. */
const ADMIN_ITEM = { to: '/admin', label: 'admin', icon: 'admin' } as const;

export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5 text-ink no-underline">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent">
        <svg width="18" height="18" viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 14h8l3-8 4 16 3-8h6" />
        </svg>
      </span>
      {withName && <span className="truncate text-[15px] font-bold">{APP_NAME}</span>}
    </Link>
  );
}

interface Props {
  me: PublicUser;
  /** Icons only (the side menu folded on desktop). */
  collapsed: boolean;
  /** Desktop: fold/unfold. Absent in the phone drawer, which has `onClose` instead. */
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  /** Red dot on the calculator / accent dot on news. */
  dots: { calculator: boolean; news: boolean };
  shownTheme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignOut: () => void;
}

/**
 * The side menu: logo, the session clock, the screens with their alert dots, and at the bottom the
 * settings, theme and sign-out. Folded, it keeps the icons (names in tooltips).
 */
export function Sidebar({ me, collapsed, onToggleCollapsed, onClose, dots, shownTheme, onToggleTheme, onSignOut }: Props) {
  const t = useT();
  const items = [...NAV, ...(me.role === 'admin' ? [ADMIN_ITEM] : [])];
  const dotFor = (to: string) =>
    to === '/kalkulator' && dots.calculator ? { className: 'bg-sell', title: t.nav.basisChanged } : to === '/news' && dots.news ? { className: 'bg-accent', title: t.nav.newsAlert } : null;
  const themeLabel = shownTheme === 'dark' ? t.nav.toLight : t.nav.toDark;

  return (
    <div className="card flex h-full w-full flex-col gap-4 overflow-y-auto overscroll-contain p-3">
      <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : 'justify-between pl-1.5'}`}>
        <Logo withName={!collapsed} />
        {onToggleCollapsed && (
          <IconButton label={collapsed ? t.nav.expand : t.nav.collapse} onClick={onToggleCollapsed}>
            <NavIcon name="collapse" className={collapsed ? 'rotate-180' : ''} />
          </IconButton>
        )}
        {onClose && (
          <IconButton label={t.nav.closeMenu} onClick={onClose}>
            <NavIcon name="close" />
          </IconButton>
        )}
      </div>

      <div className={collapsed ? 'flex justify-center' : ''}>
        <SessionClock timezone={me.settings.timezone} placement="right" compact={collapsed} />
      </div>

      <nav aria-label={t.nav.main} className="flex flex-col gap-0.5">
        {items.map((item) => {
          const dot = dotFor(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={collapsed ? t.nav[item.label] : undefined}
              aria-label={collapsed ? t.nav[item.label] : undefined}
              onClick={onClose}
              className={`group relative flex h-10 items-center gap-3 rounded-[11px] text-sm font-medium text-dim no-underline transition hover:bg-chip hover:text-ink ${collapsed ? 'justify-center' : 'px-3'}`}
              activeProps={{ className: '!bg-chip !font-bold !text-ink' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              <NavIcon name={item.icon} className="group-data-[status=active]:text-accent-ink" />
              {!collapsed && <span className="truncate">{t.nav[item.label]}</span>}
              {dot && (
                <span
                  title={dot.title}
                  className={`size-2 rounded-full ${dot.className} ${collapsed ? 'absolute top-2 right-2.5 ring-2 ring-panel' : 'ml-auto'}`}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="grow" />

      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Link
          to="/ustawienia"
          title={collapsed ? t.nav.settings : undefined}
          aria-label={collapsed ? t.nav.settings : undefined}
          onClick={onClose}
          className={`group flex h-10 items-center gap-3 rounded-[11px] text-sm font-medium text-dim no-underline transition hover:bg-chip hover:text-ink ${collapsed ? 'justify-center' : 'px-3'}`}
          activeProps={{ className: '!bg-chip !font-bold !text-ink' }}
        >
          <NavIcon name="settings" className="group-data-[status=active]:text-accent-ink" />
          {!collapsed && t.nav.settings}
        </Link>
        <MenuButton collapsed={collapsed} label={themeLabel} onClick={onToggleTheme} icon={<ThemeIcon theme={shownTheme} />} />
        {me.authenticated && <MenuButton collapsed={collapsed} label={t.auth.signOut} onClick={onSignOut} icon={<NavIcon name="signOut" />} />}
        {!collapsed && (
          <div className="mt-2 flex items-center gap-2.5 rounded-[11px] bg-chip px-3 py-2">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
              {me.displayName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold">{me.displayName}</span>
              {me.email && <span className="truncate text-[11px] text-dim">{me.email}</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({ collapsed, label, onClick, icon }: { collapsed: boolean; label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`flex h-10 items-center gap-3 rounded-[11px] text-left text-sm font-medium text-dim transition hover:bg-chip hover:text-ink ${collapsed ? 'justify-center' : 'px-3'}`}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-dim transition hover:bg-chip hover:text-ink">
      {children}
    </button>
  );
}
