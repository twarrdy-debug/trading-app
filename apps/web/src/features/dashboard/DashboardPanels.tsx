import type { Trade, TradeStats } from '@trading/api/types';
import { DISCIPLINE_CHECKS, exitReason, type TradeOutcome } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Segmented } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { addDays, currentLocale, formatAmount, formatDate, formatNumber, formatPercent } from '../../lib/format.ts';
import { InstrumentLogo } from '../../components/ui/InstrumentBadge.tsx';
import { InfoTip, type InfoContent } from '../../components/ui/InfoTip.tsx';

type Day = TradeStats['equityCurve'][number];

/** Card with a title row; `actions` sit on the right of the title. */
export function DashboardCard({ title, info, actions, children, className = '' }: { title: string; info?: InfoContent; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // A size container: links in the title row shrink to icons when the card itself is narrow.
    <section className={`card @container flex min-w-0 flex-col ${className}`}>
      {/* The title wraps within itself; the info and actions stay on its line. */}
      <header className="flex min-h-15 items-center gap-x-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="m-0 min-w-0 text-base font-bold text-balance">{title}</h2>
        {info && <InfoTip info={info} />}
        <div className="grow" />
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function CardLink({ to, children }: { to: '/transakcje' | '/statystyki'; children: string }) {
  return (
    <Link to={to} title={children} aria-label={children} className="flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] font-semibold text-dim no-underline hover:bg-chip hover:text-ink">
      {/* In a narrow card only the icon stays, so the title keeps its row. */}
      <span className="hidden @[27rem]:inline">{children}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </Link>
  );
}

const pnlTone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-dim' : v > 0 ? 'text-buy' : 'text-sell');

// --- Recent trades --------------------------------------------------------------------------

export function RecentTrades({ trades, currency, timezone }: { trades: Trade[]; currency: string; timezone: string }) {
  const t = useT().dashboard;
  const when = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return (
    <DashboardCard title={t.recentTrades} info={t.info.recentTrades} actions={<CardLink to="/transakcje">{t.viewAll}</CardLink>}>
      {trades.length === 0 ? (
        <p className="m-0 p-5 text-sm text-dim">{t.noTrades}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-4">
          {trades.map((trade) => {
            const long = trade.direction === 'long';
            const reason = exitReason(trade);
            return (
              <li key={trade.id} className="flex items-center gap-3 rounded-(--radius-control) border border-line bg-raised px-3.5 py-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${long ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'}`}
                  aria-label={long ? 'Long' : 'Short'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {long ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="M7 7l10 10M17 8v9H8" />}
                  </svg>
                </span>
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <InstrumentLogo symbol={trade.instrument.symbol} size={18} />
                    <span className="truncate text-[15px] font-semibold">{trade.instrument.symbol}</span>
                    {reason && (
                      <span
                        title={t.exitName[reason]}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          reason === 'tp' ? 'bg-buy-soft text-buy' : reason === 'sl' ? 'bg-sell-soft text-sell' : 'bg-chip text-dim'
                        }`}
                      >
                        {t.exit[reason]}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-dim">{when.format(new Date(trade.closedAt ?? trade.openedAt))}</span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`font-mono text-[15px] font-semibold tabular-nums ${pnlTone(trade.pnlAccount)}`}>{formatAmount(trade.pnlAccount, currency)}</span>
                  <span className="font-mono text-[11px] text-dim">{trade.rMultiple == null ? '—' : `${formatNumber(trade.rMultiple, true)}R`}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

// --- Progress tracker -----------------------------------------------------------------------

export const TRACKER_WEEKS = 12;

/** First day of the week containing `date` (Monday, or Sunday when `sundayFirst`). */
export const weekStart = (date: string, sundayFirst: boolean) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -(sundayFirst ? weekday : (weekday + 6) % 7));
};

const keptCount = (day: Day) => DISCIPLINE_CHECKS.filter((c) => day.discipline[c]).length;

/** Heat map of trading days (result or discipline) and today's discipline checks. */
export function ProgressTracker({ days, today, start, currency }: { days: Day[]; today: string; start: string; currency: string }) {
  const all = useT();
  const t = all.dashboard;
  const [mode, setMode] = useState<'result' | 'discipline'>('result');
  const byDate = new Map(days.map((d) => [d.date, d]));
  const maxAbs = Math.max(1e-9, ...days.map((d) => Math.abs(d.pnl)));
  const total = DISCIPLINE_CHECKS.length;
  const todayDay = byDate.get(today);

  const weekdayName = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' });
  const monthName = new Intl.DateTimeFormat(currentLocale(), { month: 'short', timeZone: 'UTC' });
  const columns = Array.from({ length: TRACKER_WEEKS }, (_, w) => addDays(start, w * 7));

  const cellClass = (day: Day | undefined, date: string) => {
    if (date > today) return 'bg-transparent';
    if (!day) return 'bg-grid';
    if (mode === 'discipline') {
      const kept = keptCount(day);
      return kept === total ? 'bg-buy' : kept === total - 1 ? 'bg-buy/50' : kept >= total / 2 ? 'bg-warn/70' : 'bg-sell/80';
    }
    const strength = Math.abs(day.pnl) / maxAbs;
    if (day.pnl === 0) return 'bg-dim/40';
    // Full class names, so Tailwind finds them.
    const level = strength > 0.66 ? 2 : strength > 0.33 ? 1 : 0;
    return day.pnl > 0 ? ['bg-buy/45', 'bg-buy/70', 'bg-buy'][level] : ['bg-sell/45', 'bg-sell/70', 'bg-sell'][level];
  };
  const cellLabel = (day: Day | undefined, date: string) =>
    !day
      ? `${formatDate(date)}: ${t.noTradesDay}`
      : mode === 'discipline'
        ? t.dayDiscipline(formatDate(date), keptCount(day), total)
        : t.dayResult(formatDate(date), formatAmount(day.pnl, currency), all.common.trades(day.trades));

  return (
    <DashboardCard
      title={t.progress}
      info={t.info.progress}
      actions={
        <Segmented
          label={t.progress}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'result', label: t.modes.result },
            { value: 'discipline', label: t.modes.discipline },
          ]}
        />
      }
    >
      <div className="flex grow items-center px-5 py-4">
        <div className="grid w-full max-w-md gap-1" style={{ gridTemplateColumns: `auto repeat(${TRACKER_WEEKS}, minmax(0, 1fr))` }}>
          <span />
          {columns.map((col, i) => {
            const days7 = Array.from({ length: 7 }, (_, d) => addDays(col, d));
            const first = days7.find((d) => d.endsWith('-01'));
            const label = i === 0 ? col : first;
            return (
              <span key={col} className="h-4 overflow-visible text-[10px] whitespace-nowrap text-dim">
                {label ? monthName.format(new Date(`${label}T12:00:00Z`)) : ''}
              </span>
            );
          })}
          {Array.from({ length: 7 }, (_, row) => (
            <Row key={row}>
              <span className="pr-1.5 text-right text-[10px] leading-none text-dim">{weekdayName.format(new Date(`${addDays(start, row)}T12:00:00Z`))}</span>
              {columns.map((col) => {
                const date = addDays(col, row);
                const day = byDate.get(date);
                const label = cellLabel(day, date);
                return (
                  <span
                    key={date}
                    role="img"
                    aria-label={date > today ? undefined : label}
                    aria-hidden={date > today || undefined}
                    title={date > today ? undefined : label}
                    className={`aspect-square rounded-[6px] ${cellClass(day, date)} ${date === today ? 'ring-2 ring-ink ring-offset-1 ring-offset-panel' : ''}`}
                  />
                );
              })}
            </Row>
          ))}
        </div>
      </div>
      <footer className="flex flex-col gap-2.5 border-t border-line px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-dim">
            {t.todayScore}
            <InfoTip info={t.info.todayScore} />
          </span>
          <span className={`font-mono text-xl font-bold ${todayDay ? (keptCount(todayDay) === total ? 'text-buy' : 'text-ink') : 'text-dim'}`}>
            {todayDay ? keptCount(todayDay) : '—'}/{total}
          </span>
        </div>
        {todayDay ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {DISCIPLINE_CHECKS.map((check) => {
              const kept = todayDay.discipline[check];
              return (
                <li key={check} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${kept ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'}`}>
                  <span aria-hidden>{kept ? '✓' : '✕'}</span>
                  {t.checks[check]}
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-xs text-dim">{t.todayNone}</span>
        )}
      </footer>
    </DashboardCard>
  );
}

/** A grid row of the heat map (the grid itself lays out the cells). */
const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

// --- Streaks --------------------------------------------------------------------------------

const OUTCOME_CLASS: Record<TradeOutcome, string> = {
  win: 'border-buy/40 bg-buy-soft text-buy',
  loss: 'border-sell/40 bg-sell-soft text-sell',
  breakeven: 'border-line bg-raised text-dim',
};

export function Streaks({ streaks }: { streaks: TradeStats['streaks'] }) {
  const t = useT().dashboard;
  const stats = [
    { label: t.maxWin, value: String(streaks.maxWin), tone: 'text-buy' },
    { label: t.maxLoss, value: String(streaks.maxLoss), tone: 'text-sell' },
    { label: t.maxBreakeven, value: String(streaks.maxBreakeven), tone: 'text-ink' },
    {
      label: t.current,
      value: streaks.current ? `${streaks.current.count} ${t.outcomeShort[streaks.current.outcome]}` : '—',
      tone: streaks.current ? OUTCOME_CLASS[streaks.current.outcome].split(' ').at(-1)! : 'text-dim',
    },
  ];
  return (
    <DashboardCard title={t.streaks} info={t.info.streaks} actions={<span className="text-[13px] text-dim">{t.lastTrades(streaks.recent.length)}</span>}>
      <div className="flex flex-col gap-5 p-5">
        {streaks.recent.length === 0 ? (
          <p className="m-0 text-sm text-dim">{t.noTrades}</p>
        ) : (
          <ol className="m-0 grid list-none grid-cols-6 gap-2 p-0 sm:grid-cols-10">
            {streaks.recent.map((outcome, i) => (
              <li
                key={i}
                title={t.outcomeName[outcome]}
                className={`flex aspect-square items-center justify-center rounded-[10px] border text-xs font-bold ${OUTCOME_CLASS[outcome]}`}
              >
                <span aria-hidden>{t.outcomeShort[outcome]}</span>
                <span className="sr-only">{t.outcomeName[outcome]}</span>
              </li>
            ))}
          </ol>
        )}
        <dl className="m-0 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          {stats.map((s) => (
            // Labels may take two lines; the values stay on one baseline.
            <div key={s.label} className="flex flex-col justify-between gap-1">
              <dt className="text-[11px] text-dim">{s.label}</dt>
              <dd className={`m-0 font-mono text-lg font-bold ${s.tone}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </DashboardCard>
  );
}

// --- Performance by instrument --------------------------------------------------------------

type Metric = 'pnl' | 'winRate' | 'trades';

export function PerformanceBySymbol({ rows, currency }: { rows: TradeStats['byInstrument']; currency: string }) {
  const t = useT().dashboard;
  const all = useT();
  const [metric, setMetric] = useState<Metric>('pnl');
  const valueOf = (r: (typeof rows)[number]) => (metric === 'pnl' ? r.pnl : metric === 'winRate' ? (r.winRate ?? 0) : r.trades);
  const sorted = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
  const max = Math.max(1e-9, ...sorted.map((r) => Math.abs(valueOf(r))));
  const display = (r: (typeof rows)[number]) =>
    metric === 'pnl' ? formatAmount(r.pnl, currency) : metric === 'winRate' ? formatPercent(r.winRate) : String(r.trades);

  return (
    <DashboardCard
      title={t.bySymbol}
      info={t.info.bySymbol}
      actions={
        <>
          <div className="w-40">
            <Select
              aria-label={t.metric}
              value={metric}
              onChange={setMetric}
              options={(['pnl', 'winRate', 'trades'] as const).map((m) => ({ value: m, label: t.metrics[m] }))}
            />
          </div>
          <CardLink to="/statystyki">{t.reports}</CardLink>
        </>
      }
    >
      {sorted.length === 0 ? (
        <p className="m-0 p-5 text-sm text-dim">{t.noTrades}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-5">
          {sorted.map((r) => {
            const value = valueOf(r);
            const color = metric === 'pnl' ? (value < 0 ? 'bg-sell' : 'bg-buy') : 'bg-accent';
            const dot = r.pnl < 0 ? 'bg-sell' : 'bg-buy';
            return (
              <li key={r.key} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className={`size-1.5 shrink-0 self-center rounded-full ${dot}`} aria-hidden />
                  <span className="self-center">
                    <InstrumentLogo symbol={r.key} size={20} />
                  </span>
                  <span className="text-[15px] font-semibold">{r.key}</span>
                  <span className="text-xs text-dim">{all.common.trades(r.trades)}</span>
                  <span className={`ml-auto font-mono text-[15px] font-semibold tabular-nums ${metric === 'pnl' ? pnlTone(r.pnl) : ''}`}>{display(r)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-grid" aria-hidden>
                  <span className={`block h-full rounded-full ${color}`} style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
