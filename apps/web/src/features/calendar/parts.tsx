import type { CalendarEvent } from '@trading/api/types';
import { EVENT_IMPACT_LABELS, findPairBySymbol, releaseSurprise, type EventImpact, type Language } from '@trading/shared';
import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/index.tsx';
import { currentLocale } from '../../lib/format.ts';

/** Actual against the forecast, from the currency's point of view (green better, red worse). */
export const ACTUAL_COLOR = { better: 'text-buy', worse: 'text-sell', inline: '' } as const;

/** Impact in the Chmura colours: red high, amber medium, grey low and holidays. */
export const IMPACT_TONE: Record<EventImpact, { pill: string; dot: string }> = {
  high: { pill: 'bg-sell-soft text-sell', dot: 'bg-sell' },
  medium: { pill: 'bg-warn-bg text-warn', dot: 'bg-warn' },
  low: { pill: 'bg-chip text-dim', dot: 'bg-dim' },
  holiday: { pill: 'bg-chip text-dim', dot: 'bg-dim/50' },
};

/** Soft-tinted pill with a dot: "● Wysoki", optionally with a count. */
export function ImpactPill({ impact, count }: { impact: EventImpact; count?: number }) {
  const label = EVENT_IMPACT_LABELS[useLanguage()][impact];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${IMPACT_TONE[impact].pill}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
      {count != null && <span className="font-mono">{count}</span>}
    </span>
  );
}

/** Forex pairs ("EURUSD"): six letters and not one of the CFD/futures pairs (XAUUSD is gold). */
const isForexPair = (symbol: string) => /^[A-Z]{6}$/.test(symbol) && !findPairBySymbol(symbol);

/**
 * "XAUUSD, GC1, MGC1, NQ1…" → "Gold, Nasdaq 100…": one chip per market instead of per contract.
 * More than two forex pairs (every USD event moves all majors) become one "Forex · 7" chip.
 */
export function markets(symbols: string[], language: Language): { label: string; title: string }[] {
  const forex = symbols.filter(isForexPair);
  const others = [...new Set(symbols.filter((s) => !isForexPair(s)).map((s) => findPairBySymbol(s)?.pair.label[language] ?? s))];
  const chips = others.map((label) => ({ label, title: symbols.filter((s) => (findPairBySymbol(s)?.pair.label[language] ?? s) === label).join(', ') }));
  if (forex.length > 2) chips.push({ label: `Forex · ${forex.length}`, title: forex.join(', ') });
  else chips.push(...forex.map((s) => ({ label: s, title: s })));
  return chips;
}

export function MarketChips({ symbols }: { symbols: string[] }) {
  const language = useLanguage();
  return markets(symbols, language).map((m) => (
    <span key={m.label} title={m.title} className="rounded-lg bg-chip px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-dim">
      {m.label}
    </span>
  ));
}

/** How the released actual compares to the forecast; null before the release. */
export const surpriseOf = (event: Pick<CalendarEvent, 'title' | 'actual' | 'forecast' | 'previous'>) =>
  event.actual ? releaseSurprise({ name: event.title, actual: event.actual, forecast: event.forecast, previous: event.previous, revision: null }) : null;

/** Data releases (with numbers) as opposed to speeches, meetings and holidays. */
export const isRelease = (event: CalendarEvent) => event.impact !== 'holiday' && (event.forecast != null || event.previous != null);

export const formatTime = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(iso));

export const longDate = (date: string) =>
  new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export const weekdayName = (date: string, width: 'long' | 'short' = 'long') =>
  new Intl.DateTimeFormat(currentLocale(), { weekday: width, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** Minutes until an event, rounded down. */
export const minutesUntil = (iso: string, now: number) => Math.floor((new Date(iso).getTime() - now) / 60_000);

/** The current time, refreshed every `every` ms (countdowns and the "now" line). */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
