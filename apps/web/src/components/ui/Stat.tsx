import type { ReactNode } from 'react';

/** Stat tile: label, headline value and an optional footnote or visual. */
export function Stat({
  label,
  value,
  foot,
  tone = 'ink',
  visual,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: 'ink' | 'buy' | 'sell';
  visual?: ReactNode;
}) {
  const color = tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : 'text-ink';
  return (
    <div className="card flex items-center gap-4 px-5 py-4">
      {visual}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="eyebrow">{label}</span>
        <span className={`text-[26px] leading-tight font-bold tracking-tight tabular-nums ${color}`}>{value}</span>
        {foot && <span className="text-xs text-dim">{foot}</span>}
      </div>
    </div>
  );
}

/** Ring gauge for a 0–100 value (win rate). */
export function Gauge({ percent, tone = 'accent' }: { percent: number | null; tone?: 'accent' | 'sell' | 'buy' }) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const filled = ((percent ?? 0) / 100) * circumference;
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden className="shrink-0">
      <circle cx="30" cy="30" r={r} fill="none" stroke="var(--grid)" strokeWidth="7" />
      {filled > 0 && (
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={tone === 'sell' ? 'var(--sell)' : tone === 'buy' ? 'var(--buy)' : 'var(--accent)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 30 30)"
        />
      )}
    </svg>
  );
}

/** Segmented bar: `filled` of `total` segments, e.g. trades used against the daily limit. */
export function Segments({ total, filled, over = 0, tone = 'accent' }: { total: number; filled: number; over?: number; tone?: 'accent' | 'sell' }) {
  const on = tone === 'sell' ? 'bg-sell' : 'bg-accent';
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total + over }, (_, i) => (
        <span key={i} className={`h-2 grow rounded-full ${i >= total ? 'bg-sell' : i < filled ? on : 'bg-grid'}`} />
      ))}
    </div>
  );
}
