import { scaleLinear, scaleTime } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useT } from '../../i18n/index.tsx';
import { formatAmount, formatNumber, formatShortDate } from '../../lib/format.ts';

export interface EquityPoint {
  date: string;
  pnl: number;
  cumulative: number;
}

/** Account balance before the first day and after each day (from the stats API). */
export interface BalanceCurve {
  start: number;
  points: { date: string; balance: number }[];
}

/** Horizontal reference line, e.g. the starting balance, a prop drawdown floor or a profit target. */
export interface ChartLevel {
  value: number;
  label: string;
  tone: 'dim' | 'sell' | 'buy';
}

const MARGIN = { top: 14, right: 16, bottom: 26 };
const TONE: Record<ChartLevel['tone'], string> = { dim: 'var(--dim)', sell: 'var(--sell)', buy: 'var(--buy)' };

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry!.contentRect.width, height: entry!.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Result over time with a crosshair tooltip. Without `balance` it is the cumulative result from
 * zero; with it, the account balance, scaled to the account and drawn against `levels`.
 */
export function EquityChart({
  data,
  currency,
  height: minHeight = 230,
  fill = false,
  balance,
  levels = [],
  polarity = false,
}: {
  data: EquityPoint[];
  currency: string;
  height?: number;
  /** Grow to the free height of a flex column (at least `height`), so the card has no empty space. */
  fill?: boolean;
  balance?: BalanceCurve | null;
  levels?: ChartLevel[];
  /** Smooth line, green above the baseline and red below it, with a dashed baseline (dashboard). */
  polarity?: boolean;
}) {
  const t = useT().chart;
  // useId contains characters that are not valid in url(#…).
  const clipId = `eq${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [ref, size] = useSize();
  const width = size.width;
  const height = fill ? Math.max(minHeight, size.height) : minHeight;
  // In fill mode the box takes the free space and the drawing sits inside it, so it never pushes it.
  const box = fill ? { flex: '1 1 auto', minHeight } : { height };
  const [hover, setHover] = useState<number | null>(null);

  const days = balance ? balance.points.map((p) => p.date) : data.map((p) => p.date);
  if (days.length === 0) {
    return (
      <div ref={ref} className="flex items-center justify-center text-sm text-dim" style={box}>
        {t.empty}
      </div>
    );
  }

  // The line starts the day before the first day: at zero, or at the balance before it.
  const values = balance ? [balance.start, ...balance.points.map((p) => p.balance)] : [0, ...data.map((p) => p.cumulative)];
  const pnlOf = (date: string) => data.find((p) => p.date === date)?.pnl ?? 0;
  const dates = [
    new Date(new Date(`${days[0]}T12:00:00Z`).getTime() - 86_400_000),
    ...days.map((d) => new Date(`${d}T12:00:00Z`)),
  ];

  const base = balance ? balance.start : 0;
  const extent = [...values, ...levels.map((l) => l.value), ...(balance ? [] : [0])];
  const y = scaleLinear()
    .domain([Math.min(...extent), Math.max(...extent)])
    .nice(5)
    .range([height - MARGIN.top - MARGIN.bottom, 0]);
  const ticks = y.ticks(5);
  const tickLabel = (v: number) => (balance ? formatNumber(v) : formatAmount(v, currency, false));
  // Room for the longest axis label.
  const left = Math.max(44, Math.max(...ticks.map((v) => tickLabel(v).length)) * 7 + 14);
  const innerW = Math.max(0, width - left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const x = scaleTime().domain([dates[0]!, dates.at(-1)!]).range([0, innerW]);

  const lineGen = line<number>().x((_, i) => x(dates[i]!)).y((v) => y(v));
  const areaGen = area<number>()
    .x((_, i) => x(dates[i]!))
    .y0(y(base))
    .y1((v) => y(v));
  if (polarity) {
    lineGen.curve(curveMonotoneX);
    areaGen.curve(curveMonotoneX);
  }
  const lineD = lineGen(values) ?? '';
  const areaD = areaGen(values) ?? '';
  const baseY = y(base);
  // With polarity the parts above and below the baseline are drawn separately, clipped at it.
  const parts = polarity
    ? [
        { key: 'up', color: 'var(--buy)', clip: { y: -MARGIN.top, height: baseY + MARGIN.top } },
        { key: 'down', color: 'var(--sell)', clip: { y: baseY, height: innerH - baseY + MARGIN.bottom } },
      ]
    : [{ key: 'all', color: 'var(--accent-ink)', clip: null }];
  const lastColor = polarity ? (values.at(-1)! < base ? 'var(--sell)' : 'var(--buy)') : 'var(--accent-ink)';

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let nearest = 1;
    for (let i = 1; i < dates.length; i++) {
      if (Math.abs(x(dates[i]!) - px) < Math.abs(x(dates[nearest]!) - px)) nearest = i;
    }
    setHover(nearest);
  };

  const active = hover ?? null;
  const last = values.length - 1;
  const tooltipX = active == null ? 0 : x(dates[active]!) + left;

  return (
    <div ref={ref} className="relative" style={box}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={t.aria} className={fill ? 'absolute inset-0' : undefined}>
          <g transform={`translate(${left},${MARGIN.top})`}>
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={0}
                  x2={innerW}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={v === base ? (polarity ? 'var(--dim)' : 'var(--line)') : 'var(--grid)'}
                  strokeWidth={1}
                  strokeDasharray={v === base ? (polarity ? '4 4' : undefined) : '3 4'}
                />
                <text x={-10} y={y(v)} dy="0.32em" textAnchor="end" className="fill-dim font-mono text-[11px]">
                  {tickLabel(v)}
                </text>
              </g>
            ))}
            {x.ticks(Math.max(2, Math.min(days.length, Math.floor(innerW / 90)))).map((d) => (
              <text key={d.toISOString()} x={x(d)} y={innerH + 18} textAnchor="middle" className="fill-dim font-mono text-[11px]">
                {formatShortDate(d.toISOString().slice(0, 10))}
              </text>
            ))}
            {parts.map((part) =>
              part.clip ? (
                <clipPath key={part.key} id={`${clipId}-${part.key}`}>
                  <rect x={-1} width={innerW + 2} y={part.clip.y} height={Math.max(0, part.clip.height)} />
                </clipPath>
              ) : null,
            )}
            {parts.map((part) => (
              <path
                key={part.key}
                d={areaD}
                fill={polarity ? part.color : 'var(--accent)'}
                fillOpacity={polarity ? 0.12 : 0.16}
                clipPath={part.clip ? `url(#${clipId}-${part.key})` : undefined}
              />
            ))}
            {levels.map((level) => (
              <g key={level.label}>
                <line x1={0} x2={innerW} y1={y(level.value)} y2={y(level.value)} stroke={TONE[level.tone]} strokeWidth={1.2} strokeDasharray="6 4" />
                <text x={innerW - 4} y={y(level.value) - 5} textAnchor="end" className="font-sans text-[11px] font-semibold" fill={TONE[level.tone]}>
                  {level.label} · {formatNumber(level.value)}
                </text>
              </g>
            ))}
            {parts.map((part) => (
              <path
                key={part.key}
                d={lineD}
                fill="none"
                stroke={part.color}
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                clipPath={part.clip ? `url(#${clipId}-${part.key})` : undefined}
              />
            ))}
            <circle cx={x(dates[last]!)} cy={y(values[last]!)} r={4} fill={lastColor} stroke="var(--panel)" strokeWidth={2} />
            {active != null && (
              <>
                <line x1={x(dates[active]!)} x2={x(dates[active]!)} y1={0} y2={innerH} stroke="var(--line)" strokeWidth={1} />
                <circle
                  cx={x(dates[active]!)}
                  cy={y(values[active]!)}
                  r={5}
                  fill={polarity ? (values[active]! < base ? 'var(--sell)' : 'var(--buy)') : 'var(--accent-ink)'}
                  stroke="var(--panel)"
                  strokeWidth={2}
                />
              </>
            )}
            <rect width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {active != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col gap-0.5 rounded-(--radius-control) bg-panel px-3 py-2 font-mono text-xs whitespace-nowrap shadow-(--shadow-pop)"
          style={{ left: Math.min(Math.max(tooltipX, 90), width - 90) }}
        >
          <span className="text-dim">{formatShortDate(days[active - 1]!)}</span>
          <span>
            {t.day}: {formatAmount(pnlOf(days[active - 1]!), currency)}
          </span>
          <span className="font-semibold">
            {balance ? t.balance : t.total}: {formatAmount(values[active]!, currency, !balance)}
          </span>
        </div>
      )}
    </div>
  );
}
