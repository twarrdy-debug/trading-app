import { scaleLinear, scaleTime } from 'd3-scale';
import { area, line } from 'd3-shape';
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useT } from '../../i18n/index.tsx';
import { formatMoney, formatShortDate } from '../../lib/format.ts';

export interface EquityPoint {
  date: string;
  pnl: number;
  cumulative: number;
}

const MARGIN = { top: 12, right: 16, bottom: 26, left: 64 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Cumulative P&L by day: one accent line over a 10% wash, with a crosshair tooltip. */
export function EquityChart({ data, currency, height = 230 }: { data: EquityPoint[]; currency: string; height?: number }) {
  const t = useT().chart;
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div ref={ref} className="flex items-center justify-center text-sm text-dim" style={{ height }}>
        {t.empty}
      </div>
    );
  }

  // A single day still gets a line: start it from zero the day before.
  const points = [{ date: '', pnl: 0, cumulative: 0 }, ...data];
  const dates = points.map((p, i) => (i === 0 ? new Date(new Date(`${data[0]!.date}T12:00:00Z`).getTime() - 86_400_000) : new Date(`${p.date}T12:00:00Z`)));
  const values = points.map((p) => p.cumulative);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const x = scaleTime().domain([dates[0]!, dates.at(-1)!]).range([0, innerW]);
  const y = scaleLinear()
    .domain([Math.min(0, ...values), Math.max(0, ...values)])
    .nice(4)
    .range([innerH, 0]);

  const lineD = line<number>().x((_, i) => x(dates[i]!)).y((v) => y(v))(values) ?? '';
  const areaD =
    area<number>()
      .x((_, i) => x(dates[i]!))
      .y0(y(0))
      .y1((v) => y(v))(values) ?? '';

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
  const tooltipX = active == null ? 0 : x(dates[active]!) + MARGIN.left;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={t.aria}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {y.ticks(4).map((t) => (
              <g key={t}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line)' : 'var(--grid)'} strokeDasharray={t === 0 ? undefined : '3 4'} strokeWidth={1} />
                <text x={-10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-dim font-mono text-[11px]">
                  {formatMoney(t, false)}
                </text>
              </g>
            ))}
            {x.ticks(Math.max(2, Math.min(data.length, Math.floor(innerW / 90)))).map((t) => (
              <text key={t.toISOString()} x={x(t)} y={innerH + 18} textAnchor="middle" className="fill-dim font-mono text-[11px]">
                {formatShortDate(t.toISOString().slice(0, 10))}
              </text>
            ))}
            <path d={areaD} fill="var(--accent)" fillOpacity={0.16} />
            <path d={lineD} fill="none" stroke="var(--accent-ink)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(dates[last]!)} cy={y(values[last]!)} r={4} fill="var(--accent-ink)" stroke="var(--panel)" strokeWidth={2} />
            {active != null && (
              <>
                <line x1={x(dates[active]!)} x2={x(dates[active]!)} y1={0} y2={innerH} stroke="var(--line)" strokeWidth={1} />
                <circle cx={x(dates[active]!)} cy={y(values[active]!)} r={5} fill="var(--accent-ink)" stroke="var(--panel)" strokeWidth={2} />
              </>
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      {active != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col gap-0.5 rounded-(--radius-control) bg-panel px-3 py-2 font-mono text-xs whitespace-nowrap shadow-(--shadow-pop)"
          style={{ left: Math.min(Math.max(tooltipX, 90), width - 90) }}
        >
          <span className="text-dim">{formatShortDate(points[active]!.date)}</span>
          <span>
            {t.day}: {formatMoney(points[active]!.pnl)} {currency}
          </span>
          <span className="font-semibold">
            {t.total}: {formatMoney(values[active]!)} {currency}
          </span>
        </div>
      )}
    </div>
  );
}
