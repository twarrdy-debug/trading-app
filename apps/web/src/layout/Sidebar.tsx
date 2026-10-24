import type { PublicUser } from '@trading/api/types';
import { APP_NAME, SUPPORT_EMAIL, type Feature } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LogoMark, Wordmark } from '../components/ui/Brand.tsx';
import { useT, type Messages } from '../i18n/index.tsx';
import { NavIcon, type NavIconName } from './NavIcon.tsx';
import { SessionClock, ThemeIcon } from './SessionClock.tsx';

export { APP_NAME };

/** Screens behind a plan (or locked in the demo): a small lock beside them in the menu. */
const LOCKED_BY: Record<string, Feature> = { '/analiza': 'analysis', '/news': 'news' };

export const NAV = [
  { to: '/dashboard', label: 'dashboard', icon: 'dashboard' },
  { to: '/transakcje', label: 'trades', icon: 'trades' },
  { to: '/statystyki', label: 'stats', icon: 'stats' },
  { to: '/analiza', label: 'analysis', icon: 'analysis' },
  { to: '/strategie', label: 'strategies', icon: 'strategies' },
  { to: '/kalkulator', label: 'calculator', icon: 'calculator' },
  { to: '/kalendarz', label: 'calendar', icon: 'calendar' },
  { to: '/news', label: 'news', icon: 'news' },
  // Signals are hidden from the menu for now; the page stays at /sygnaly.
] as const satisfies readonly { to: string; label: keyof Messages['nav']; icon: NavIconName }[];

/** Shown in the menu only for the admin role. */
const ADMIN_ITEM = { to: '/admin', label: 'admin', icon: 'admin' } as const;

export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <Link to="/dashboard" className="flex min-w-0 items-center gap-2.5 text-ink no-underline">
      <LogoMark size={36} />
      {withName ? <Wordmark className="truncate text-[16px]" /> : <span className="sr-only">{APP_NAME}</span>}
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
              activeOptions={{ exact: item.to === '/dashboard' }}
            >
              <NavIcon name={item.icon} className="group-data-[status=active]:text-accent-ink" />
              {!collapsed && <span className="truncate">{t.nav[item.label]}</span>}
              {LOCKED_BY[item.to] && (me.demo || !me.plan.features.includes(LOCKED_BY[item.to]!)) && !collapsed && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="ml-auto shrink-0 opacity-70">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              )}
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
        <HelpButton collapsed={collapsed} inline={Boolean(onClose)} />
        <MenuButton collapsed={collapsed} label={themeLabel} onClick={onToggleTheme} icon={<ThemeIcon theme={shownTheme} />} />
        {(me.authenticated || me.demo) && <MenuButton collapsed={collapsed} label={me.demo ? t.demo.exit : t.auth.signOut} onClick={onSignOut} icon={<NavIcon name="signOut" />} />}
        {!collapsed && (
          <div className="mt-2 flex items-center gap-2.5 rounded-[11px] bg-chip px-3 py-2">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
              {me.displayName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold">{me.displayName}</span>
              {me.email && !me.demo && <span className="truncate text-[11px] text-dim">{me.email}</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Help": a small card with the support address (shown, not a mail link) and a copy button. */
function HelpButton({ collapsed, inline }: { collapsed: boolean; /** In the phone drawer: the card opens under the button. */ inline: boolean }) {
  const t = useT().nav;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [at, setAt] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => button.current?.contains(target as Node) || panel.current?.contains(target as Node);
    const onDown = (e: PointerEvent) => !inside(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const toggle = () => {
    // Beside the side menu, level with the button (the menu scrolls, so the card cannot sit inside it).
    const box = button.current?.getBoundingClientRect();
    if (box) setAt({ left: box.right + 16, bottom: Math.max(8, window.innerHeight - box.bottom) });
    setOpen((o) => !o);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const card = (
    <div
      ref={panel}
      role="dialog"
      aria-label={t.helpTitle}
      style={inline ? undefined : { position: 'fixed', left: at.left, bottom: at.bottom }}
      className={`flex flex-col gap-2.5 p-4 ${inline ? 'mt-1 rounded-(--radius-control) bg-raised' : 'card z-50 w-72 shadow-(--shadow-pop) ring-1 ring-line'}`}
    >
      <span className="text-sm font-bold">{t.helpTitle}</span>
      <span className="text-[13px] text-dim">{t.helpText}</span>
      <span className={`rounded-(--radius-control) px-3 py-2.5 font-mono text-[13px] font-semibold break-all select-all ${inline ? 'bg-panel' : 'bg-raised'}`}>{SUPPORT_EMAIL}</span>
      <button type="button" onClick={() => void copy()} className="self-start rounded-[10px] px-2.5 py-1.5 text-xs font-bold text-accent-ink hover:bg-chip">
        {copied ? t.emailCopied : t.copyEmail}
      </button>
    </div>
  );
  return (
    <div>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={collapsed ? t.help : undefined}
        aria-label={collapsed ? t.help : undefined}
        className={`flex h-10 w-full items-center gap-3 rounded-[11px] text-left text-sm font-medium transition hover:bg-chip hover:text-ink ${open ? 'bg-chip text-ink' : 'text-dim'} ${collapsed ? 'justify-center' : 'px-3'}`}
      >
        <NavIcon name="help" />
        {!collapsed && <span className="truncate">{t.help}</span>}
      </button>
      {open && (inline ? card : createPortal(card, document.body))}
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
