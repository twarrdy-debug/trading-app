import type { ReactNode } from 'react';

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number | null;
  /** Text at the bar tip. */
  display: string;
  /** Secondary line under the label (counts, win rate). */
  detail?: ReactNode;
}

/**
 * Horizontal bars from one baseline. `polarity` colors positive bars buy-green and negative
 * sell-red around a center baseline; otherwise all bars use the accent on a 0..max scale.
 * Values are also printed as text, so the list doubles as the table view.
 */
export function BarList({ rows, polarity = false, max }: { rows: BarRow[]; polarity?: boolean; max?: number }) {
  if (rows.length === 0) return <p className="m-0 px-5 py-6 text-sm text-dim">Brak danych w tym okresie.</p>;

  const extent = max ?? Math.max(1e-9, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-5">
      {rows.map((row) => {
        const value = row.value ?? 0;
        const share = Math.min(1, Math.abs(value) / extent);
        const color = !polarity ? 'bg-accent' : value >= 0 ? 'bg-buy' : 'bg-sell';
        return (
          <li key={row.key} className="grid grid-cols-[minmax(150px,220px)_minmax(0,1fr)_96px] items-center gap-4">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{row.label}</span>
              {row.detail && <span className="font-mono text-[11px] text-dim">{row.detail}</span>}
            </div>
            <div className={`relative h-3 ${polarity ? '' : 'bg-grid'}`}>
              {polarity && <span aria-hidden className="absolute inset-y-[-4px] left-1/2 w-px bg-line" />}
              <span
                className={`absolute inset-y-0 ${color} ${polarity && value < 0 ? 'rounded-l' : 'rounded-r'}`}
                style={
                  polarity
                    ? value >= 0
                      ? { left: '50%', width: `${share * 50}%` }
                      : { right: '50%', width: `${share * 50}%` }
                    : { left: 0, width: `${share * 100}%` }
                }
              />
            </div>
            <span className="text-right font-mono text-sm tabular-nums">{row.display}</span>
          </li>
        );
      })}
    </ul>
  );
}
