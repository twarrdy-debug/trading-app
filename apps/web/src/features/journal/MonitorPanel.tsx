import type { TradingMonitor } from '@trading/api/types';
import { Link } from '@tanstack/react-router';
import { useMe, useTradingMonitor } from '../../api/hooks.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segments } from '../../components/ui/Stat.tsx';
import { useT, type Messages } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatNumber } from '../../lib/format.ts';
import { useSelectedAccount } from '../account/AccountSwitcher.tsx';

type MonitorGroup = TradingMonitor['groups'][number];
type TodayTrade = MonitorGroup['trades'][number];
type Status = 'ok' | 'near' | 'stop';

/** Warning text for the counted losses: in a row or all of the day. */
export const lossAlertMessage = (t: Messages, mode: 'streak' | 'day', count: number) =>
  mode === 'day' ? t.lossStreak.dayMessage(count) : t.lossStreak.message(count);

/**
 * Where an account stands today: over a limit or at the losses warning → stop; at the trade limit or
 * one loss from the warning → near; otherwise on track.
 */
function statusOf(g: MonitorGroup): Status {
  const limit = g.maxTradesPerDay;
  if (g.alert || g.overLimit) return 'stop';
  if ((limit != null && g.tradesToday >= limit) || (g.lossCount > 0 && g.lossCount >= g.lossLimit - 1)) return 'near';
  return 'ok';
}

const STATUS_RANK: Record<Status, number> = { ok: 0, near: 1, stop: 2 };

const STATUS_TONE: Record<Status, string> = {
  ok: 'bg-buy-soft text-buy',
  near: 'bg-warn-bg text-warn',
  stop: 'bg-sell-soft text-sell',
};

const STATUS_DOT: Record<Status, string> = { ok: 'bg-buy', near: 'bg-warn', stop: 'bg-sell' };

const OUTCOME_TONE = {
  win: { slot: 'bg-buy-soft', text: 'text-buy', bar: 'bg-buy' },
  loss: { slot: 'bg-sell-soft', text: 'text-sell', bar: 'bg-sell' },
  breakeven: { slot: 'bg-warn-bg', text: 'text-warn', bar: 'bg-warn' },
  open: { slot: 'bg-accent/15', text: 'text-accent-ink', bar: 'bg-accent' },
} as const;

function StatusPill({ status, label }: { status: Status; label?: string }) {
  const t = useT().monitor;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${STATUS_TONE[status]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label ?? t.status[status]}
    </span>
  );
}

/** One sentence under the verdict: what is left or what tripped the status, plus today's result. */
function reason(t: Messages['monitor'], m: TradingMonitor, g: MonitorGroup) {
  const limit = g.maxTradesPerDay;
  const daily = m.lossMode === 'day';
  if (g.alert) return t.lossesShort(g.lossCount, daily);
  if (g.overLimit) return t.overLimitShort;
  if (limit != null && g.tradesToday >= limit) return t.limitReached;
  if (g.lossCount > 0 && g.lossCount >= g.lossLimit - 1) return t.oneLossLeft;
  return limit == null ? t.tradesNoLimit(g.tradesToday) : t.tradesLeft(limit - g.tradesToday, limit);
}

/** A trade's figure for its slot: R when known, otherwise the money. */
function tradeFigure(trade: TodayTrade, currency: string, openLabel: string) {
  if (trade.outcome == null) return openLabel;
  if (trade.rMultiple != null) return `${formatNumber(trade.rMultiple, true)} R`;
  return formatAmount(trade.pnl, currency);
}

/**
 * The day as a tape: one slot per trade allowed today, filled in opening order with each trade's
 * outcome; trades over the limit get a hatched red slot, free slots stay dashed.
 */
function Tape({ trades, limit, timezone, currency }: { trades: TodayTrade[]; limit: number | null; timezone: string; currency: string }) {
  const t = useT().monitor;
  const time = new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  const slots = Math.max(limit ?? 0, trades.length);
  if (slots === 0) return null;
  return (
    <ol className="m-0 grid list-none gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${Math.min(slots, 4)}, minmax(0, 1fr))` }}>
      {Array.from({ length: slots }, (_, i) => {
        const trade = trades[i];
        const over = limit != null && i >= limit;
        if (!trade) {
          return (
            <li key={i} aria-label={t.freeSlot(i + 1)} className="flex min-h-13 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line text-xs font-bold text-dim">
              {i + 1}
            </li>
          );
        }
        const tone = OUTCOME_TONE[trade.outcome ?? 'open'];
        return (
          <li
            key={trade.id}
            className={`flex min-h-13 min-w-0 flex-col justify-center gap-px rounded-xl px-2.5 py-1.5 ${over ? 'border-[1.5px] border-sell/50 bg-[repeating-linear-gradient(135deg,var(--sell-soft)_0_6px,transparent_6px_12px)]' : tone.slot}`}
          >
            <span className="truncate text-[10.5px] font-bold text-dim">
              {over ? t.overSlot : `${time.format(new Date(trade.openedAt))} · ${trade.symbol}`}
            </span>
            <span className={`truncate font-mono text-[13px] font-bold ${tone.text}`}>{tradeFigure(trade, currency, t.open)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Counted losses against the warning threshold, as dots (a bar for long thresholds). */
function LossPips({ count, limit, label }: { count: number; limit: number; label: string }) {
  const alert = count >= limit;
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-dim">{label}</span>
      <span className="flex items-center gap-1.5">
        {limit <= 8 ? (
          Array.from({ length: limit }, (_, i) => (
            <span key={i} aria-hidden className={`size-3.5 rounded-full border-2 ${i < count ? 'border-sell bg-sell' : 'border-line'}`} />
          ))
        ) : (
          <span className="w-28">
            <Segments total={limit} filled={Math.min(count, limit)} tone="sell" />
          </span>
        )}
        <span className={`ml-1 font-mono text-xs font-semibold ${alert ? 'text-sell' : 'text-dim'}`}>
          {count} / {limit}
        </span>
      </span>
    </div>
  );
}

/**
 * Trading monitor, per account: a verdict for the day, today's trades as a tape against the daily
 * limit and the counted losses against the warning. One account (or "no account") gets the full
 * view; "all accounts" one compact row per account. The limits in force sit at the bottom.
 */
export function MonitorPanel() {
  const all = useT();
  const t = all.monitor;
  const { data: m } = useTradingMonitor();
  const { data: me } = useMe();
  const { filter } = useSelectedAccount();
  if (!m || !me) return null;
  const timezone = me.settings.timezone;
  const currency = me.settings.accountCurrency;

  const wanted = filter === '' ? undefined : filter === 'none' ? null : filter;
  const single =
    wanted !== undefined
      ? (m.groups.find((g) => g.accountId === wanted) ??
        // "No account" (or an account) selected but no such trades today.
        {
          accountId: wanted,
          name: null,
          maxTradesPerDay: m.maxTradesPerDay,
          lossLimit: m.lossLimit,
          ownLimits: false,
          tradesToday: 0,
          overLimit: false,
          lossCount: 0,
          alert: false,
          alertKey: '',
          lossLabels: [],
          pnlToday: 0,
          trades: [],
        })
      : m.groups.length === 1
        ? m.groups[0]
        : undefined;
  const daily = m.lossMode === 'day';
  const statuses = m.groups.map((g) => statusOf(g));
  const worst = statuses.reduce<Status>((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'ok');
  const pill = single ? (
    <StatusPill status={statusOf(single)} />
  ) : (
    <StatusPill status={worst} label={t.worstStatus(t.status[worst]!, statuses.filter((s) => s === worst).length)} />
  );
  const pnlTone = (v: number) => (v > 0 ? 'text-buy' : v < 0 ? 'text-sell' : 'text-dim');

  return (
    <Panel title={t.title} actions={pill} className="flex h-full flex-col" aria-label={t.title}>
      <div className="flex grow flex-col">
        {single ? (
          <div className="flex grow flex-col gap-3.5 px-5 pt-1 pb-4">
            <div className="flex flex-col gap-0.5">
              <span className={`text-xl font-bold tracking-tight ${statusOf(single) === 'stop' ? 'text-sell' : ''}`}>{t.verdict[statusOf(single)]}</span>
              <span className="text-[12.5px] text-dim">
                {reason(t, m, single)} · {t.resultToday} <span className={`font-mono font-semibold ${pnlTone(single.pnlToday)}`}>{formatAmount(single.pnlToday, currency)}</span>
              </span>
            </div>
            <Tape trades={single.trades} limit={single.maxTradesPerDay} timezone={timezone} currency={currency} />
            {single.alert && <p className="m-0 rounded-(--radius-control) bg-sell-soft px-3 py-2 text-[12.5px] text-sell">{lossAlertMessage(all, m.lossMode, single.lossCount)}</p>}
            <div className="mt-auto">
              <LossPips count={single.lossCount} limit={single.lossLimit} label={daily ? t.lossesToday : t.lossStreak} />
            </div>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 px-5 pt-1 pb-4">
            {m.groups.map((g, i) => {
              const status = statuses[i]!;
              const slots = Math.max(g.maxTradesPerDay ?? 0, g.trades.length);
              return (
                <li key={g.accountId ?? 'none'} className="flex flex-col gap-2 rounded-(--radius-control) bg-raised px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold">
                      <span aria-label={t.status[status]} className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                      <span className="truncate">{g.name ?? all.accounts.none}</span>
                    </span>
                    <span className={`font-mono text-[13px] font-bold ${pnlTone(g.pnlToday)}`}>{formatAmount(g.pnlToday, currency)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {slots > 0 && (
                      <span aria-hidden className="flex gap-1">
                        {Array.from({ length: slots }, (_, k) => {
                          const trade = g.trades[k];
                          const over = g.maxTradesPerDay != null && k >= g.maxTradesPerDay;
                          return <span key={k} className={`h-2 w-5 rounded-full ${trade ? OUTCOME_TONE[trade.outcome ?? 'open'].bar : 'bg-line'} ${over ? 'ring-2 ring-sell-soft' : ''}`} />;
                        })}
                      </span>
                    )}
                    <span className={`text-[11.5px] ${status === 'ok' ? 'text-dim' : status === 'near' ? 'font-semibold text-warn' : 'font-semibold text-sell'}`}>
                      {t.compactTrades(g.tradesToday, g.maxTradesPerDay)} · {t.compactLosses(g.lossCount, g.lossLimit, daily)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-xs text-dim">
        <span>
          {single ? t.limits(single.maxTradesPerDay, single.lossLimit, daily) : t.limits(m.maxTradesPerDay, m.lossLimit, daily)}
          {single?.ownLimits ? ` (${t.ownLimitsNote})` : !single && m.groups.some((g) => g.ownLimits) ? ` · ${t.someOwnLimits}` : ''}
        </span>
        {/* An account with its own limits is changed on the account; the defaults in Discipline. */}
        <Link to="/ustawienia/$section" params={{ section: single?.ownLimits ? 'konta' : 'dyscyplina' }} className="font-semibold text-accent-ink no-underline hover:underline">
          {t.changeLimits}
        </Link>
      </footer>
    </Panel>
  );
}
