import { DASHBOARD_WIDGETS, type DashboardWidget } from '@trading/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useUpdateSettings } from '../../api/hooks.ts';
import { toggleClass } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';

const TILES: DashboardWidget[] = ['netPnl', 'monthPnl', 'winRate', 'profitFactor', 'avgWinLoss'];
const PANELS = DASHBOARD_WIDGETS.filter((w) => !TILES.includes(w));

/**
 * "Customize": which widgets the dashboard shows, saved on the account at every click (so the
 * choice follows the user to other devices). Everything shows until the user hides something.
 */
export function DashboardCustomize({ hidden }: { hidden: DashboardWidget[] }) {
  const t = useT().dashboard;
  const id = useId();
  const update = useUpdateSettings();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const toggle = (w: DashboardWidget) => update.mutate({ dashboardHidden: hidden.includes(w) ? hidden.filter((h) => h !== w) : [...hidden, w] });

  const group = (label: string, widgets: readonly DashboardWidget[]) => (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-xs font-semibold text-dim">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {widgets.map((w) => {
          const on = !hidden.includes(w);
          return (
            <button key={w} type="button" role="switch" aria-checked={on} onClick={() => toggle(w)} className={`flex h-9 items-center gap-2 px-3 text-[13px] ${toggleClass(on)}`}>
              <span aria-hidden className={`flex size-4 items-center justify-center rounded-[5px] border text-[10px] ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>
                {on ? '✓' : ''}
              </span>
              {t.widgets[w]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className={`flex h-11 items-center gap-2 px-3.5 text-sm font-semibold ${toggleClass(open)}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        {t.customize}
        {hidden.length > 0 && <span className="rounded-full bg-chip px-1.5 font-mono text-[11px]">−{hidden.length}</span>}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t.customizeTitle}
          className="card absolute top-full right-0 z-40 mt-2 flex w-[min(30rem,calc(100vw-1.5rem))] flex-col gap-4 p-4 shadow-(--shadow-pop)"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-bold">{t.customizeTitle}</span>
            <button
              type="button"
              disabled={hidden.length === 0}
              onClick={() => update.mutate({ dashboardHidden: [] })}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-accent-ink hover:bg-chip disabled:opacity-40"
            >
              {t.showAll}
            </button>
          </div>
          {group(t.groupTiles, TILES)}
          {group(t.groupPanels, PANELS)}
        </div>
      )}
    </div>
  );
}
