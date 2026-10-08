import type { CalendarEvent, EventHistory } from '@trading/api/types';
import { EVENT_CATEGORY_LABELS, parseReleaseValue, releaseSurprise } from '@trading/shared';
import { useEffect, useRef } from 'react';
import { useEventHistory } from '../../api/hooks.ts';
import { CurrencyFlag, InstrumentLogo } from '../../components/ui/InstrumentBadge.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { formatDate } from '../../lib/format.ts';
import { ACTUAL_COLOR, formatTime, ImpactPill, isRelease, longDate, minutesUntil, surpriseOf } from './parts.tsx';

const SURPRISE_FILL = { better: 'var(--buy)', worse: 'var(--sell)', inline: 'var(--dim)' } as const;

/** Bars of earlier results to scale from zero, each with its forecast as a tick across it. */
function HistoryChart({ title, history }: { title: string; history: EventHistory['history'] }) {
  const points = history
    .map((h) => ({ ...h, number: parseReleaseValue(h.value), expected: parseReleaseValue(h.forecast) }))
    .filter((h): h is typeof h & { number: number } => h.number != null);
  if (points.length === 0) return null;
  const width = 340;
  const height = 150;
  const top = 18;
  const bottom = 22;
  const values = points.flatMap((p) => [p.number, p.expected ?? p.number]);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * (height - top - bottom);
  const slot = width / points.length;
  const bar = Math.min(34, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={points.map((p) => `${formatDate(p.eventTime.slice(0, 10))}: ${p.value}`).join(', ')}>
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      {points.map((p, i) => {
        const surprise = releaseSurprise({ name: title, actual: p.value, forecast: p.forecast, previous: null, revision: null }) ?? 'inline';
        const x = i * slot + (slot - bar) / 2;
        const y0 = y(Math.max(0, p.number));
        const h = Math.max(2, Math.abs(y(p.number) - y(0)));
        // Above the bar and its forecast tick (below both for negative values).
        const labelY = p.number >= 0 ? y(Math.max(p.number, p.expected ?? p.number)) - 5 : y(Math.min(p.number, p.expected ?? p.number)) + 12;
        return (
          <g key={p.id}>
            <rect x={x} y={y0} width={bar} height={h} rx="5" fill={SURPRISE_FILL[surprise]} opacity={surprise === 'inline' ? 0.35 : 0.8} />
            {p.expected != null && <line x1={x - 3} x2={x + bar + 3} y1={y(p.expected)} y2={y(p.expected)} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />}
            <text x={x + bar / 2} y={labelY} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink)">
              {p.value}
            </text>
            <text x={x + bar / 2} y={height - 6} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--dim)">
              {formatDate(p.eventTime.slice(0, 10)).slice(0, 5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Side panel with one event: big figures, the surprise, earlier releases and the instruments it moves. */
export function EventDetails({ event, timezone, now, onClose }: { event: CalendarEvent; timezone: string; now: number; onClose: () => void }) {
  const t = useT().calendar;
  const language = useLanguage();
  const close = useRef<HTMLButtonElement>(null);
  const release = isRelease(event);
  const { data } = useEventHistory(release ? event.id : null);
  const surprise = surpriseOf(event);
  const minutes = minutesUntil(event.eventTime, now);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const big = (label: string, value: string | null, tone = '') => (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-raised px-3 py-2.5">
      <span className="text-xs font-semibold text-dim">{label}</span>
      <span className={`truncate font-mono text-xl font-bold ${tone}`}>{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label={t.close} onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <aside role="dialog" aria-modal="true" aria-label={t.details} className="absolute inset-y-0 right-0 flex w-[min(28rem,100vw)] p-2 sm:p-3">
        <div className="card flex grow flex-col gap-5 overflow-y-auto p-5 shadow-(--shadow-pop)">
          <div className="flex flex-wrap items-center gap-2">
            <CurrencyFlag currency={event.currency} size={20} />
            <span className="text-sm font-bold">{event.currency}</span>
            <ImpactPill impact={event.impact} />
            <span className="rounded-lg bg-chip px-2 py-0.5 text-[11px] font-semibold text-dim">{EVENT_CATEGORY_LABELS[language][event.category]}</span>
            <span className="grow" />
            <button ref={close} type="button" onClick={onClose} aria-label={t.close} className="flex size-8 items-center justify-center rounded-[9px] text-dim hover:bg-chip hover:text-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl font-bold text-balance">{event.title}</h2>
            <span className="text-sm text-dim first-letter:uppercase">
              {longDate(event.localDate)}
              {event.impact !== 'holiday' && `, ${formatTime(event.eventTime, timezone)}`}
              {minutes >= 0 && event.impact !== 'holiday' && <span className="font-semibold text-accent-ink"> · {t.countdown(minutes)}</span>}
            </span>
          </div>

          {event.impact !== 'holiday' && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                {big(t.actual, event.actual, surprise ? ACTUAL_COLOR[surprise] : '')}
                {big(t.forecastLong, event.forecast)}
                {big(t.previousLong, event.previous)}
              </div>
              {surprise && (
                <span className={`text-[13px] font-semibold ${surprise === 'inline' ? 'text-dim' : ACTUAL_COLOR[surprise]}`}>
                  {surprise === 'better' ? '▲ ' : surprise === 'worse' ? '▼ ' : ''}
                  {t.surprise[surprise]}
                </span>
              )}
            </div>
          )}

          {release && (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-bold">{t.history}</h3>
              {data && data.history.length > 0 ? (
                <>
                  <HistoryChart title={event.title} history={data.history} />
                  <span className="text-xs text-dim">{t.historyLegend}</span>
                </>
              ) : data ? (
                <span className="text-[13px] text-dim">{t.noHistory}</span>
              ) : (
                <span className="h-36 animate-pulse rounded-xl bg-raised" />
              )}
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-bold">{t.affectsTitle}</h3>
            {event.instruments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {event.instruments.map((symbol) => (
                  <span key={symbol} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                    <InstrumentLogo symbol={symbol} size={18} />
                    {symbol}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[13px] text-dim">{t.noInstruments}</span>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
