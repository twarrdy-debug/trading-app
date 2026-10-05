import type { TradeStats } from '@trading/api/types';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/index.tsx';
import { formatAmount, formatNumber, formatPercent } from '../../lib/format.ts';
import { InfoTip, type InfoContent } from '../../components/ui/InfoTip.tsx';

/** Dashboard tile: label with help on top, the value bottom-left and a visual bottom-right. */
function Tile({ label, info, value, foot, visual }: { label: string; info: InfoContent; value: ReactNode; foot?: ReactNode; visual?: ReactNode }) {
  return (
    <div className="card flex min-h-36 flex-col justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-2 text-sm text-dim">
        {label}
        <InfoTip info={info} />
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[30px] leading-none font-bold tracking-tight tabular-nums">{value}</span>
          {foot && <span className="font-mono text-xs text-dim">{foot}</span>}
        </div>
        {visual}
      </div>
    </div>
  );
}

const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-buy' : 'text-sell');

/** Net P&L, profit factor, win rate and average win/loss for the period. */
export function DashboardTiles({ stats }: { stats: TradeStats }) {
  const t = useT().dashboard;
  const s = stats.summary;
  const currency = stats.currency;
  const ratio = s.avgWin != null && s.avgLoss ? s.avgWin / Math.abs(s.avgLoss) : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[87.5rem]:grid-cols-4">
      <Tile
        label={t.netPnl}
        info={t.info.netPnl}
        value={<span className={tone(s.pnl)}>{formatAmount(s.pnl, currency)}</span>}
        foot={s.returnPct != null ? <span className={tone(s.returnPct)}>{`${s.returnPct >= 0 ? '↗' : '↘'} ${formatNumber(s.returnPct, true)}%`}</span> : undefined}
        visual={<Sparkline values={stats.equityCurve.map((p) => p.cumulative)} />}
      />
      <Tile label={t.profitFactor} info={t.info.profitFactor} value={formatNumber(s.profitFactor)} visual={<ProfitFactorScale value={s.profitFactor} />} />
      <Tile
        label={t.winRate}
        info={t.info.winRate}
        value={formatPercent(s.winRate)}
        foot={
          <>
            <span className="text-buy">↑ {s.wins}</span> <span className="text-sell">↓ {s.losses}</span>
            {s.breakevens > 0 && <span> · {s.breakevens} BE</span>}
          </>
        }
        visual={<WinRateArc wins={s.wins} losses={s.losses} />}
      />
      <Tile
        label={t.avgWinLoss}
        info={t.info.avgWinLoss}
        value={formatNumber(ratio)}
        visual={<WinLossBar win={s.avgWin} loss={s.avgLoss} currency={currency} />}
      />
    </div>
  );
}

/** Cumulative result as a small area chart, green when it ends in profit, red otherwise. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 150;
  const h = 56;
  const points = [0, ...values];
  const x = scaleLinear().domain([0, points.length - 1]).range([2, w - 2]);
  const y = scaleLinear()
    .domain([Math.min(0, ...points), Math.max(0, ...points)])
    .range([h - 2, 2]);
  const color = points.at(-1)! >= 0 ? 'var(--buy)' : 'var(--sell)';
  const lineD = line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(points) ?? '';
  const areaD =
    area<number>()
      .x((_, i) => x(i))
      .y0(h)
      .y1((v) => y(v))
      .curve(curveMonotoneX)(points) ?? '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className="h-14 max-w-[150px] min-w-12 flex-1">
      <path d={areaD} fill={color} fillOpacity={0.14} />
      <path d={lineD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/** Bar from 0 to 3+: red below 1, amber to 1.5, then greens; the marker shows the value. */
function ProfitFactorScale({ value }: { value: number | null }) {
  const MAX = 3;
  const zones = [
    { to: 1, color: 'bg-sell' },
    { to: 1.5, color: 'bg-warn' },
    { to: 2, color: 'bg-buy/60' },
    { to: MAX, color: 'bg-buy' },
  ];
  return (
    <div className="relative mb-1.5 h-2.5 w-36 shrink-0" aria-hidden>
      <div className="flex h-full gap-0.5 overflow-hidden rounded-full">
        {zones.map((z, i) => (
          <span key={z.to} className={z.color} style={{ width: `${((z.to - (zones[i - 1]?.to ?? 0)) / MAX) * 100}%` }} />
        ))}
      </div>
      {value != null && (
        <span
          className="absolute top-1/2 h-5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-ink"
          style={{ left: `${(Math.min(value, MAX) / MAX) * 100}%` }}
        />
      )}
    </div>
  );
}

/** Half ring: wins in green from the left, losses in red to the right. */
function WinRateArc({ wins, losses }: { wins: number; losses: number }) {
  const t = useT().dashboard;
  const r = 44;
  const cx = 54;
  const cy = 52;
  const share = wins + losses > 0 ? wins / (wins + losses) : null;
  const point = (fraction: number) => {
    const angle = Math.PI * (1 - fraction);
    return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const gap = 0.025;
  return (
    <div className="flex shrink-0 flex-col items-center" aria-hidden>
      <svg width={108} height={60} viewBox="0 0 108 60">
        {share == null ? (
          <path d={arc(0, 1)} fill="none" stroke="var(--grid)" strokeWidth={9} strokeLinecap="round" />
        ) : (
          <>
            {share > 0 && <path d={arc(0, Math.max(0, share - (share < 1 ? gap : 0)))} fill="none" stroke="var(--buy)" strokeWidth={9} strokeLinecap="round" />}
            {share < 1 && <path d={arc(Math.min(1, share + (share > 0 ? gap : 0)), 1)} fill="none" stroke="var(--sell)" strokeWidth={9} strokeLinecap="round" />}
          </>
        )}
      </svg>
      <div className="flex w-full justify-between text-[11px] text-dim">
        <span>{t.wins}</span>
        <span>{t.losses}</span>
      </div>
    </div>
  );
}

/** Average win (green) against average loss (red), as shares of one bar. */
function WinLossBar({ win, loss, currency }: { win: number | null; loss: number | null; currency: string }) {
  const w = win ?? 0;
  const l = Math.abs(loss ?? 0);
  const total = w + l;
  return (
    <div className="mb-0.5 flex max-w-40 min-w-24 flex-1 flex-col gap-1.5" aria-hidden>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-grid">
        {total > 0 && (
          <>
            <span className="bg-buy" style={{ width: `${(w / total) * 100}%` }} />
            <span className="bg-sell" style={{ width: `${(l / total) * 100}%` }} />
          </>
        )}
      </div>
      <div className="flex justify-between gap-2 font-mono text-[11px] whitespace-nowrap">
        <span className="text-buy">{formatAmount(win, currency, false)}</span>
        <span className="text-sell">{formatAmount(loss, currency)}</span>
      </div>
    </div>
  );
}
