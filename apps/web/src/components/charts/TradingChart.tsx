import {
  CandlestickSeries,
  createChart,
  createTextWatermark,
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
import type { ChartSync } from './chart-sync.ts';

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
  /** Where the label goes: inside at the right end (default) or just above the top left corner, clear of the candles. */
  labelAt?: 'right' | 'above';
  /** One candle wide around `from` (`to` is ignored): a highlighted candle. */
  bar?: boolean;
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

/** A level the user moves by dragging it (entry, stop loss, take profits in the trade form). */
export interface EditableLine {
  id: string;
  price: number;
  label: string;
  /** A colour token name (without "--"). */
  color: string;
  dashed?: boolean;
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
/** A token colour at an opacity ("#26a69a" → "rgba(38, 166, 154, 0.5)"). */
const fade = (name: string, alpha: number) => {
  const hex = token(name).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return token(name);
  const n = parseInt(hex, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
/** The app's typeface on the axes and labels, so the chart reads as part of the app. */
const FONT = 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
/** Pixels per candle on first view: slim bodies with room between them, as on TradingView. */
const BAR_PX = 5.5;

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
          const labels: { x: number; y: number; w: number; text: string; color: string }[] = [];
          ctx.font = `700 10px ${FONT}`;
          for (const b of this.boxes) {
            const center = b.bar ? x(b.from) : null;
            const half = (ts.options().barSpacing ?? BAR_PX) / 2 + 1;
            const x1 = b.bar ? (center == null ? null : center - half) : (x(b.from) ?? (toTime(b.from) < (ts.getVisibleRange()?.from as number) ? 0 : null));
            if (x1 == null) continue;
            const x2 = b.bar ? center! + half : b.to ? (x(b.to) ?? mediaSize.width) : mediaSize.width;
            const y1 = y(b.top);
            const y2 = y(b.bottom);
            if (y1 == null || y2 == null) continue;
            const color = token(b.color);
            ctx.globalAlpha = b.fill ?? 0.16;
            ctx.fillStyle = color;
            ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
            ctx.globalAlpha = b.dashed ? 0.45 : 0.6;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            if (b.dashed) ctx.setLineDash([4, 3]);
            ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(1, x2 - x1 - 1), Math.max(1, y2 - y1 - 1));
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            if (b.label) {
              const w = ctx.measureText(b.label).width;
              const top = Math.min(y1, y2);
              labels.push(
                b.labelAt === 'above'
                  ? { x: Math.max(2, x1 + 2), y: top - 4, w, text: b.label, color }
                  : { x: Math.max(x1 + 4, x2 - w - 6), y: (y1 + y2) / 2 + 3.5, w, text: b.label, color },
              );
            }
          }
          for (const s of this.segments) {
            const x1 = x(s.from);
            const x2 = x(s.to);
            const yy = y(s.price);
            if (x1 == null || x2 == null || yy == null) continue;
            const color = token(s.color);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x1, yy);
            ctx.lineTo(x2, yy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(s.label, (x1 + x2) / 2, s.above ? yy - 4 : yy + 11);
            ctx.textAlign = 'start';
          }
          // A label that would touch one already drawn is left out (its zone is still drawn).
          labels.sort((a, b) => a.y - b.y);
          const placed: { x: number; y: number; w: number }[] = [];
          for (const l of labels) {
            if (placed.some((p) => Math.abs(p.y - l.y) < 11 && l.x < p.x + p.w + 6 && p.x < l.x + l.w + 6)) continue;
            placed.push(l);
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
  height,
  watermark,
  resetKey,
  ariaLabel,
  sync,
  focus,
  periodMs,
  followNewest = false,
  editLines,
  onLineDrag,
}: {
  candles: ChartCandle[];
  overlays: ChartLineSeries[];
  boxes: ChartBox[];
  segments: ChartSegment[];
  lines: ChartLine[];
  panes: ChartPane[];
  decimals: number;
  timeZone: string;
  /** Fixed height; by default the chart takes most of the window (520–920 px). */
  height?: number;
  /** Large faint text behind the candles, e.g. "US100 · H1". */
  watermark?: string;
  /** A new value rebuilds the chart and resets the view (instrument, timeframe, indicator set). */
  resetKey: string;
  ariaLabel: string;
  /** Scrolling, zoom and the crosshair shared with other charts of the same moments. */
  sync?: ChartSync;
  /** Centres the view on this candle whenever `key` changes. */
  focus?: { time: string; key: string } | null;
  /** Length of one candle: a countdown to the last candle's close sits under its price on the axis. */
  periodMs?: number;
  /** Always bring a newly added candle into view (a replay), even after the user scrolled away. */
  followNewest?: boolean;
  /** Levels drawn bold with their label, moved by dragging (mouse or finger); `onLineDrag` gets the new price. */
  editLines?: EditableLine[];
  onLineDrag?: (id: string, price: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  /** Index of the candle under the cursor (null: the last one). */
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<{ chart: IChartApi; candles: ISeriesApi<'Candlestick'>; zones: ZonesPrimitive; fresh: boolean; count: number } | null>(null);
  /** The candles the legend reads (the change against the previous close). */
  const data = useRef<ChartCandle[]>(candles);
  data.current = candles;
  // The theme and the user's candle colours: a change of either redraws the chart.
  const look = () => `${document.documentElement.dataset.theme ?? 'dark'}|${token('chart-up')}|${token('chart-down')}|${token('chart-hollow')}`;
  const [theme, setTheme] = useState(look);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(look()));
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
    const crosshairLine = { color: fade('chart-text', 0.35), width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: token('chart-label') };
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: token('chart-bg') },
        textColor: fade('chart-text', 0.7),
        fontFamily: FONT,
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: token('chart-border'), separatorHoverColor: fade('chart-accent', 0.4), enableResize: true },
      },
      // Horizontal lines only, and faint: the candles and levels carry the picture.
      grid: { vertLines: { visible: false }, horzLines: { color: fade('chart-grid', 0.9) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderVisible: false, timeVisible: true, rightOffset: 10, barSpacing: BAR_PX, minBarSpacing: 1.5 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: crosshairLine, horzLine: crosshairLine },
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
    // The user's choice (Settings → Appearance): rising candles as outlines.
    const hollow = token('chart-hollow') === '1';
    const series = chart.addSeries(CandlestickSeries, {
      upColor: hollow ? token('chart-bg') : up,
      downColor: down,
      borderVisible: hollow,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
    });
    if (watermark) {
      createTextWatermark(chart.panes()[0]!, {
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [{ text: watermark, color: fade('chart-text', 0.06), fontSize: 64, fontStyle: '800', fontFamily: FONT }],
      });
    }
    const zones = new ZonesPrimitive();
    series.attachPrimitive(zones);
    chartRef.current = { chart, candles: series, zones, fresh: true, count: 0 };

    const leave = sync?.join(
      {
        chart,
        series,
        closes: () => new Map(data.current.map((c) => [toTime(c.time), c.close])),
      },
      el,
    );
    chart.subscribeCrosshairMove((param) => {
      const list = data.current;
      const index = param.logical != null && param.seriesData.get(series) ? Math.round(param.logical) : list.length - 1;
      setHover(index >= 0 && index < list.length ? index : list.length - 1);
    });
    return () => {
      leave?.();
      chart.remove();
      chartRef.current = null;
    };
  }, [resetKey, theme, timeZone, decimals, watermark, sync]);

  // Data, indicators and overlays: replaced in place, keeping the view.
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || candles.length === 0) return;
    const { chart } = ref;
    const times = candles.map((c) => toTime(c.time));
    // Following the newest candle (it was in view): keep following when one is added (live, replay).
    const before = chart.timeScale().getVisibleLogicalRange();
    const grew = !ref.fresh && ref.count > 0 && candles.length > ref.count;
    const follow = grew && (followNewest || (before != null && before.to >= ref.count - 1));
    ref.count = candles.length;
    ref.candles.setData(candles.map((c, i) => ({ time: times[i]!, open: c.open, high: c.high, low: c.low, close: c.close })));

    const added: ISeriesApi<'Line' | 'Histogram'>[] = [];
    const series = (values: (number | null)[]) => values.map((v, i) => (v == null ? { time: times[i]! } : { time: times[i]!, value: v }));
    for (const o of overlays) {
      // Their values are in the legend: labels on the price axis would pile onto the levels there.
      const s = chart.addSeries(LineSeries, { color: fade(o.color, 0.85), lineWidth: (o.width ?? 1) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(series(o.values));
      added.push(s);
    }
    panes.forEach((pane, index) => {
      const paneIndex = index + 1;
      if (pane.histogram) {
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex);
        // Strong while the bar grows away from zero, faded while it shrinks back, as on TradingView.
        const hist = pane.histogram;
        h.setData(
          hist.map((v, i) => {
            if (v == null) return { time: times[i]! };
            const prev = hist[i - 1] ?? 0;
            const growing = Math.abs(v) >= Math.abs(prev);
            return { time: times[i]!, value: v, color: fade(v >= 0 ? 'chart-up' : 'chart-down', growing ? 0.9 : 0.4) };
          }),
        );
        added.push(h);
      }
      pane.lines.forEach((line, k) => {
        const s = chart.addSeries(
          LineSeries,
          { color: token(line.color), lineWidth: 1, priceLineVisible: false, lastValueVisible: k === 0, crosshairMarkerRadius: 3, title: k === 0 ? line.label : '' },
          paneIndex,
        );
        s.setData(series(line.values));
        for (const level of k === 0 ? (pane.levels ?? []) : [])
          s.createPriceLine({ price: level, color: fade('chart-text', 0.3), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        added.push(s);
      });
    });
    // The price pane gets most of the height; indicator panes are slim strips under it.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 6 : 1));

    const priceLines: IPriceLine[] = lines.map((l) =>
      ref.candles.createPriceLine({ price: l.price, color: fade(l.color, 0.75), lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: l.label }),
    );
    ref.zones.set(boxes, segments);
    if (follow) chart.timeScale().scrollToRealTime();
    if (ref.fresh) {
      // As many candles as fit at BAR_PX each, so wide screens show more history, not fatter candles.
      const fit = Math.round((box.current?.clientWidth ?? 900) / BAR_PX) - 10;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - fit), to: candles.length + 10 });
      ref.fresh = false;
    }
    return () => {
      if (chartRef.current !== ref) return;
      for (const s of added) chart.removeSeries(s);
      for (const l of priceLines) ref.candles.removePriceLine(l);
    };
  }, [candles, overlays, boxes, segments, lines, panes, resetKey, theme, followNewest]);

  // Centre on the focused candle once per focus (and again after a rebuild).
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || !focus || candles.length === 0) return;
    const mark = `${focus.key}|${resetKey}|${theme}`;
    if (focused.current === mark) return;
    const index = candles.findIndex((c) => c.time >= focus.time);
    if (index < 0) return;
    focused.current = mark;
    const half = Math.round((box.current?.clientWidth ?? 900) / BAR_PX / 2);
    ref.chart.timeScale().setVisibleLogicalRange({ from: index - half, to: index + half });
  }, [focus, candles, resetKey, theme]);

  // Editable levels: drawn on the candles, dragged with the pointer while the chart holds still.
  const edit = useRef({ lines: editLines ?? [], onDrag: onLineDrag });
  edit.current = { lines: editLines ?? [], onDrag: onLineDrag };
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || !editLines?.length) return;
    const drawn = editLines.map((l) =>
      ref.candles.createPriceLine({
        price: l.price,
        color: token(l.color),
        lineWidth: 2,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.label,
      }),
    );
    return () => {
      if (chartRef.current !== ref) return;
      for (const l of drawn) ref.candles.removePriceLine(l);
    };
  }, [editLines, resetKey, theme]);

  // Bound once per chart, not per `onLineDrag`: the form re-renders on every move, and rebinding
  // then dropped the drag after its first step.
  const draggable = onLineDrag != null;
  useEffect(() => {
    const el = box.current;
    const ref = chartRef.current;
    if (!el || !ref || !draggable) return;
    let dragging: string | null = null;
    const yOf = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top;
    // The line under the pointer, within a few pixels (more for a finger).
    const hit = (e: PointerEvent) => {
      const reach = e.pointerType === 'touch' ? 14 : 6;
      const y = yOf(e);
      return edit.current.lines.find((l) => {
        const ly = ref.candles.priceToCoordinate(l.price);
        return ly != null && Math.abs(ly - y) <= reach;
      });
    };
    const hold = (still: boolean) => ref.chart.applyOptions({ handleScroll: !still, handleScale: !still });
    const down = (e: PointerEvent) => {
      const line = hit(e);
      if (!line) return;
      dragging = line.id;
      hold(true);
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) {
        el.style.cursor = hit(e) ? 'ns-resize' : '';
        return;
      }
      const price = ref.candles.coordinateToPrice(yOf(e));
      if (price != null) edit.current.onDrag?.(dragging, price);
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = null;
      hold(false);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    // A finger on a line must not scroll the page: once the browser takes the gesture over it sends
    // pointercancel and the drag stops after a step or two. Cancelling the touch keeps it ours.
    const touchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) return;
      const y = t.clientY - el.getBoundingClientRect().top;
      const onLine = edit.current.lines.some((l) => {
        const ly = ref.candles.priceToCoordinate(l.price);
        return ly != null && Math.abs(ly - y) <= 14;
      });
      if (!onLine) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const touchMove = (e: TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture phase: the chart's own panning never sees a drag that starts on a line.
    el.addEventListener('pointerdown', down, { capture: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('touchstart', touchStart, { capture: true, passive: false });
    el.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    return () => {
      el.removeEventListener('touchstart', touchStart, { capture: true });
      el.removeEventListener('touchmove', touchMove, { capture: true });
      el.removeEventListener('pointerdown', down, { capture: true });
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.style.cursor = '';
      if (dragging && chartRef.current === ref) hold(false);
    };
  }, [draggable, resetKey, theme]);

  // Time left until the last candle closes, under its price label on the axis (as on TradingView).
  const [countdown, setCountdown] = useState<{ y: number; width: number; text: string; up: boolean } | null>(null);
  useEffect(() => {
    if (!periodMs) {
      setCountdown(null);
      return;
    }
    const update = () => {
      const ref = chartRef.current;
      const last = data.current.at(-1);
      if (!ref || !last) return setCountdown(null);
      const left = Date.parse(last.time) + periodMs - Date.now();
      const y = ref.candles.priceToCoordinate(last.close);
      // A closed market (the last candle long over) has nothing to count down.
      if (left <= 0 || y == null) return setCountdown(null);
      const total = Math.ceil(left / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const sec = total % 60;
      const two = (n: number) => String(n).padStart(2, '0');
      setCountdown({ y, width: ref.chart.priceScale('right').width(), text: h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`, up: last.close >= last.open });
    };
    update();
    const timer = setInterval(update, 1000);
    const ref = chartRef.current;
    ref?.chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    return () => {
      clearInterval(timer);
      ref?.chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
    };
  }, [periodMs, candles, resetKey, theme]);

  // The hovered candle (or the last one): OHLC and its change against the previous close.
  const at = hover ?? candles.length - 1;
  const bar = candles[at];
  const prev = candles[at - 1];
  const fmt = (p: number) => p.toLocaleString(currentLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const change = bar && prev ? bar.close - prev.close : null;
  const tone = bar && bar.close >= bar.open ? 'var(--chart-up)' : 'var(--chart-down)';
  return (
    <div className="relative" style={{ height: height ?? 'clamp(520px, 74vh, 920px)' }}>
      <div ref={box} role="img" aria-label={ariaLabel} className="absolute inset-0" />
      {countdown && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 z-10 flex justify-center font-mono text-[10.5px] leading-4 font-semibold text-white"
          // Just under the last price's label, in the candle's colour like the label itself.
          style={{ top: countdown.y + 7, width: countdown.width, borderRadius: '0 0 3px 3px', background: countdown.up ? 'var(--chart-up)' : 'var(--chart-down)' }}
        >
          {countdown.text}
        </div>
      )}
      {/* Like the legend line on TradingView. */}
      {bar && (
        <div
          className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-col gap-0.5 rounded-md px-1.5 py-1 font-mono text-[11.5px] font-semibold"
          // A backdrop in the chart's colour, so level lines do not run through the text.
          style={{ color: 'var(--chart-text)', background: 'color-mix(in srgb, var(--chart-bg) 85%, transparent)' }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            {(['O', 'H', 'L', 'C'] as const).map((k) => (
              <span key={k}>
                <span className="opacity-55">{k}</span> <span style={{ color: tone }}>{fmt({ O: bar.open, H: bar.high, L: bar.low, C: bar.close }[k])}</span>
              </span>
            ))}
            {change != null && prev && (
              <span style={{ color: change >= 0 ? 'var(--chart-up)' : 'var(--chart-down)' }}>
                {change >= 0 ? '+' : '−'}
                {fmt(Math.abs(change))} ({change >= 0 ? '+' : '−'}
                {Math.abs((change / prev.close) * 100).toLocaleString(currentLocale(), { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%)
              </span>
            )}
          </div>
          {overlays.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              {overlays.map((o) => {
                const v = o.values[at];
                return (
                  <span key={o.key}>
                    <span className="opacity-55">{o.label}</span> <span style={{ color: `var(--${o.color})` }}>{v != null ? fmt(v) : '—'}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
