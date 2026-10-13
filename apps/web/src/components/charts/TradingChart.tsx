import {
  CandlestickSeries,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { currentLocale } from '../../lib/format.ts';

export interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A shaded zone from a candle to `to` (or the right edge), with an optional label. */
export interface ChartBox {
  from: string;
  to: string | null;
  top: number;
  bottom: number;
  /** A colour token name (without "--"), e.g. "chart-fvg". */
  color: string;
  label?: string;
  /** Fill opacity (0–1). */
  fill?: number;
  dashed?: boolean;
}

/** A labelled dashed segment at a price between two candles (BOS / CHoCH). */
export interface ChartSegment {
  from: string;
  to: string;
  price: number;
  color: string;
  label: string;
  above: boolean;
}

export interface ChartLine {
  price: number;
  label: string;
  color: string;
}

export interface ChartLineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  width?: number;
}

export interface ChartPane {
  key: string;
  /** Lines and an optional histogram (MACD) aligned with the candles; reference levels (RSI 70/30). */
  lines: ChartLineSeries[];
  histogram?: (number | null)[];
  levels?: number[];
}

const toTime = (iso: string) => Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || '#888';

/** Zones and segments drawn under the candles, labelled at the right without overlapping. */
class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private boxes: ChartBox[] = [];
  private segments: ChartSegment[] = [];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
  }

  set(boxes: ChartBox[], segments: ChartSegment[]) {
    this.boxes = boxes;
    this.segments = segments;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          if (!this.chart || !this.series) return;
          const ts = this.chart.timeScale();
          const x = (iso: string) => ts.timeToCoordinate(toTime(iso));
          const y = (p: number) => this.series!.priceToCoordinate(p);
          const labels: { x: number; y: number; text: string; color: string }[] = [];
          ctx.font = '700 10px -apple-system, "Trebuchet MS", Roboto, sans-serif';
          for (const b of this.boxes) {
            const x1 = x(b.from) ?? (toTime(b.from) < (ts.getVisibleRange()?.from as number) ? 0 : null);
            if (x1 == null) continue;
            const x2 = b.to ? (x(b.to) ?? mediaSize.width) : mediaSize.width;
            const y1 = y(b.top);
            const y2 = y(b.bottom);
            if (y1 == null || y2 == null) continue;
            const color = token(b.color);
            ctx.globalAlpha = b.fill ?? 0.16;
            ctx.fillStyle = color;
            ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            if (b.dashed) ctx.setLineDash([4, 3]);
            ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(1, x2 - x1 - 1), Math.max(1, y2 - y1 - 1));
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            if (b.label) labels.push({ x: Math.max(x1 + 4, x2 - ctx.measureText(b.label).width - 6), y: (y1 + y2) / 2 + 3.5, text: b.label, color });
          }
          for (const s of this.segments) {
            const x1 = x(s.from);
            const x2 = x(s.to);
            const yy = y(s.price);
            if (x1 == null || x2 == null || yy == null) continue;
            const color = token(s.color);
            ctx.strokeStyle = color;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x1, yy);
            ctx.lineTo(x2, yy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(s.label, (x1 + x2) / 2, s.above ? yy - 4 : yy + 11);
            ctx.textAlign = 'start';
          }
          // A label that would touch one already drawn is left out (its zone is still drawn).
          labels.sort((a, b) => a.y - b.y);
          const placed: number[] = [];
          for (const l of labels) {
            if (placed.some((p) => Math.abs(p - l.y) < 11)) continue;
            placed.push(l.y);
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, l.x, l.y);
          }
        }),
    };
    return [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }
}

/**
 * TradingView-style chart (Lightweight Charts by TradingView, Apache 2.0; it shows the TradingView
 * logo the licence asks for): candles with EMA lines, price lines, zones and structure on the main
 * pane, and indicator panes (RSI, MACD) below. Colours come from the --chart-* tokens of the theme.
 * The view (zoom and scroll) is kept when only the data refreshes.
 */
export function TradingChart({
  candles,
  overlays,
  boxes,
  segments,
  lines,
  panes,
  decimals,
  timeZone,
  height = 640,
  resetKey,
  ariaLabel,
}: {
  candles: ChartCandle[];
  overlays: ChartLineSeries[];
  boxes: ChartBox[];
  segments: ChartSegment[];
  lines: ChartLine[];
  panes: ChartPane[];
  decimals: number;
  timeZone: string;
  height?: number;
  /** A new value rebuilds the chart and resets the view (instrument, timeframe, indicator set). */
  resetKey: string;
  ariaLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; candles: ISeriesApi<'Candlestick'>; zones: ZonesPrimitive; fresh: boolean } | null>(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);

  // Build the chart: once per instrument, timeframe, indicator set and theme.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const locale = currentLocale();
    const zoned = (seconds: number, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(seconds * 1000));
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: token('chart-bg') },
        textColor: token('chart-text'),
        fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
        fontSize: 11,
        panes: { separatorColor: token('chart-border'), separatorHoverColor: token('chart-accent') },
      },
      grid: { vertLines: { color: token('chart-grid') }, horzLines: { color: token('chart-grid') } },
      rightPriceScale: { borderColor: token('chart-border') },
      timeScale: { borderColor: token('chart-border'), timeVisible: true, rightOffset: 8, barSpacing: 7 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale,
        priceFormatter: (p: number) => p.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
        // Times in the user's zone, not the browser's.
        timeFormatter: (t: Time) => zoned(t as number, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
      },
    });
    chart.applyOptions({
      timeScale: {
        tickMarkFormatter: (t: Time, type: number) =>
          type === 0
            ? zoned(t as number, { year: 'numeric' })
            : type === 1
              ? zoned(t as number, { month: 'short' })
              : type === 2
                ? zoned(t as number, { day: 'numeric', month: 'short' })
                : zoned(t as number, { hour: '2-digit', minute: '2-digit' }),
      },
    });
    const up = token('chart-up');
    const down = token('chart-down');
    const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    const zones = new ZonesPrimitive();
    series.attachPrimitive(zones);
    chartRef.current = { chart, candles: series, zones, fresh: true };

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined;
      if (!legend.current) return;
      const fmt = (p: number) => p.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      legend.current.dataset.hover = bar ? 'true' : 'false';
      if (bar) legend.current.lastElementChild!.textContent = `O ${fmt(bar.open)}  H ${fmt(bar.high)}  L ${fmt(bar.low)}  C ${fmt(bar.close)}`;
    });
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [resetKey, theme, timeZone, decimals]);

  // Data, indicators and overlays: replaced in place, keeping the view.
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || candles.length === 0) return;
    const { chart } = ref;
    const times = candles.map((c) => toTime(c.time));
    ref.candles.setData(candles.map((c, i) => ({ time: times[i]!, open: c.open, high: c.high, low: c.low, close: c.close })));

    const added: ISeriesApi<'Line' | 'Histogram'>[] = [];
    const series = (values: (number | null)[]) => values.map((v, i) => (v == null ? { time: times[i]! } : { time: times[i]!, value: v }));
    for (const o of overlays) {
      const s = chart.addSeries(LineSeries, { color: token(o.color), lineWidth: (o.width ?? 2) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: o.label });
      s.setData(series(o.values));
      added.push(s);
    }
    panes.forEach((pane, index) => {
      const paneIndex = index + 1;
      if (pane.histogram) {
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex);
        h.setData(pane.histogram.map((v, i) => (v == null ? { time: times[i]! } : { time: times[i]!, value: v, color: v >= 0 ? token('chart-up') : token('chart-down') })));
        added.push(h);
      }
      pane.lines.forEach((line, k) => {
        const s = chart.addSeries(LineSeries, { color: token(line.color), lineWidth: 2, priceLineVisible: false, lastValueVisible: k === 0, title: k === 0 ? line.label : '' }, paneIndex);
        s.setData(series(line.values));
        for (const level of k === 0 ? (pane.levels ?? []) : []) s.createPriceLine({ price: level, color: token('chart-text'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        added.push(s);
      });
    });
    // The price pane gets four parts of the height, each indicator pane one.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 4 : 1));

    const priceLines: IPriceLine[] = lines.map((l) =>
      ref.candles.createPriceLine({ price: l.price, color: token(l.color), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.label }),
    );
    ref.zones.set(boxes, segments);
    if (ref.fresh) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 160), to: candles.length + 6 });
      ref.fresh = false;
    }
    return () => {
      if (chartRef.current !== ref) return;
      for (const s of added) chart.removeSeries(s);
      for (const l of priceLines) ref.candles.removePriceLine(l);
    };
  }, [candles, overlays, boxes, segments, lines, panes, resetKey, theme]);

  const last = candles.at(-1);
  return (
    <div className="relative" style={{ height }}>
      <div ref={box} role="img" aria-label={ariaLabel} className="absolute inset-0" />
      {/* Hovered candle's prices, like the legend line on TradingView. */}
      <div ref={legend} className="pointer-events-none absolute top-2 left-3 z-10 flex flex-col text-[11.5px] font-semibold" style={{ color: 'var(--chart-text)' }}>
        <span />
        <span className="font-mono">
          {last
            ? `O ${last.open.toFixed(decimals)}  H ${last.high.toFixed(decimals)}  L ${last.low.toFixed(decimals)}  C ${last.close.toFixed(decimals)}`
            : ''}
        </span>
      </div>
    </div>
  );
}
