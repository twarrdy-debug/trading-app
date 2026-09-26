import type { ReactNode } from 'react';
import { Brackets } from './Panel.tsx';

/** Stat tile: label, headline value and an optional footnote or visual. */
export function Stat({
  label,
  value,
  foot,
  tone = 'ink',
  visual,
  brackets = false,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: 'ink' | 'buy' | 'sell';
  visual?: ReactNode;
  brackets?: boolean;
}) {
  const color = tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : 'text-ink';
  return (
    <div className="relative flex items-center gap-4 border border-line bg-panel px-5 py-4">
      {brackets && <Brackets />}
      {visual}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="eyebrow">{label}</span>
        <span className={`font-mono text-[28px] leading-tight font-semibold ${color}`}>{value}</span>
        {foot && <span className="font-mono text-xs text-dim">{foot}</span>}
      </div>
    </div>
  );
}

/** Ring gauge for a 0–100 value (win rate). */
export function Gauge({ percent }: { percent: number | null }) {
  const r = 30;
  const circumference = 2 * Math.PI * r;
  const filled = ((percent ?? 0) / 100) * circumference;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--grid)" strokeWidth="6" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="6"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

/** Segmented bar: `filled` of `total` segments, e.g. trades used against the daily limit. */
export function Segments({ total, filled, over = 0 }: { total: number; filled: number; over?: number }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total + over }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 grow ${i >= total ? 'bg-sell' : i < filled ? 'bg-accent' : 'bg-grid'}`}
        />
      ))}
    </div>
  );
}
