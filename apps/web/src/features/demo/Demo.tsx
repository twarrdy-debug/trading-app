import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, DEMO_BLOCKED_EVENT } from '../../api/client.ts';
import { LockedPreview } from '../../components/ui/LockedPreview.tsx';
import { useT } from '../../i18n/index.tsx';

/**
 * The public demo (owner's variant A): one shared read-only user with sample data, entered without
 * signing in. Entering and leaving reload the page, so nothing of a previous session stays cached.
 */
export async function enterDemo() {
  await api<void>('/demo', { method: 'POST' });
  window.location.assign('/dashboard');
}

/** Leaves the demo, then opens `to` (the landing page, sign-up or sign-in). */
export async function leaveDemo(to = '/') {
  await api<void>('/demo/exit', { method: 'POST' }).catch(() => undefined);
  window.location.assign(to);
}

/** "▶ See the demo": the hero's quieter second button, or a plain link (header, sign-in page). */
export function DemoButton({ variant = 'button', className = '' }: { variant?: 'button' | 'link'; className?: string }) {
  const t = useT().demo;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await enterDemo();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.failed);
      setBusy(false);
    }
  };
  const look =
    variant === 'button'
      ? 'inline-flex h-12 items-center gap-2.5 rounded-(--radius-control) border border-line bg-panel px-5 text-[15px] font-semibold text-ink hover:bg-raised'
      : 'inline-flex items-center gap-1 text-sm font-bold text-accent-ink hover:underline';
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => void go()} disabled={busy} className={`${look} disabled:opacity-60 ${className}`}>
        {variant === 'button' && (
          <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-accent/15 text-[10px] text-accent-ink">
            ▶
          </span>
        )}
        {variant === 'button' ? t.see : t.seeLink}
      </button>
      {error && <span role="alert" className="text-xs text-sell">{error}</span>}
    </span>
  );
}

/** The bar on every screen of the demo, and the notice when a save is refused. */
export function DemoBanner() {
  const t = useT().demo;
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setNotice(true);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(false), 6000);
    };
    window.addEventListener(DEMO_BLOCKED_EVENT, show);
    return () => {
      window.removeEventListener(DEMO_BLOCKED_EVENT, show);
      clearTimeout(timer);
    };
  }, []);
  return (
    <>
      <div className="px-3 pt-3 sm:px-4 lg:px-6 lg:pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-control) bg-accent/10 px-3.5 py-2.5 ring-1 ring-accent/30 ring-inset">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] text-accent-ink">
            ▶
          </span>
          <span className="min-w-0 grow text-[13px] leading-snug">
            <b>{t.bannerTitle}</b> <span className="text-dim">{t.bannerText}</span>
          </span>
          <button type="button" onClick={() => void leaveDemo('/rejestracja')} className="h-8 rounded-[10px] bg-accent px-3.5 text-[12.5px] font-bold whitespace-nowrap text-on-accent hover:brightness-105">
            {t.signUp}
          </button>
          <button type="button" onClick={() => void leaveDemo('/')} className="h-8 rounded-[10px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap text-dim hover:bg-chip hover:text-ink">
            {t.exit}
          </button>
        </div>
      </div>
      {notice && (
        <div role="status" className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-(--radius-control) bg-panel p-4 shadow-(--shadow-pop) ring-1 ring-line">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[13px] font-bold text-accent-ink">
            i
          </span>
          <span className="flex flex-col gap-2 text-[13px] leading-snug">
            <span>
              <b>{t.noticeTitle}</b> <span className="text-dim">{t.noticeText}</span>
            </span>
            <button type="button" onClick={() => void leaveDemo('/rejestracja')} className="self-start text-[12.5px] font-bold text-accent-ink hover:underline">
              {t.signUp} →
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** A screen the demo does not open (analysis, backtesting, news, calculator PRO): a blurred outline under a lock. */
export function DemoLocked({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  const t = useT().demo;
  return (
    <LockedPreview
      title={title}
      text={text}
      eyebrow={t.lockedEyebrow}
      actions={
        <>
          <button type="button" onClick={() => void leaveDemo('/rejestracja')} className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-5 text-sm font-bold text-on-accent hover:brightness-105">
            {t.signUp}
          </button>
          <button type="button" onClick={() => void leaveDemo('/logowanie')} className="inline-flex h-11 items-center rounded-(--radius-control) border border-line bg-panel px-5 text-sm font-semibold text-ink hover:bg-raised">
            {t.signIn}
          </button>
        </>
      }
    >
      {children ?? <Outline />}
    </LockedPreview>
  );
}

/** Shapes standing for a chart screen behind the lock. */
function Outline() {
  return (
    <>
      <div className="card h-24" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="card h-[30rem]" style={{ background: 'var(--chart-bg)' }} />
        <div className="flex flex-col gap-4">
          <div className="card h-32" />
          <div className="card h-72" />
        </div>
      </div>
    </>
  );
}
