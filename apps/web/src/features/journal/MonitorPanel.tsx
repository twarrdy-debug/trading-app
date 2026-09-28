import type { TradingMonitor } from '@trading/api/types';
import { useTradingMonitor } from '../../api/hooks.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segments } from '../../components/ui/Stat.tsx';
import { useT, type Messages } from '../../i18n/index.tsx';
import { useSelectedAccount } from '../account/AccountSwitcher.tsx';

type MonitorGroup = TradingMonitor['groups'][number];

/** Warning text for the counted losses: in a row or all of the day. */
export const lossAlertMessage = (t: Messages, mode: 'streak' | 'day', count: number) =>
  mode === 'day' ? t.lossStreak.dayMessage(count) : t.lossStreak.message(count);

/**
 * Trading monitor, per account: today's trades against the limit and the counted losses. One
 * account (or "no account") gets the full view; "all accounts" gets one compact row per account.
 */
export function MonitorPanel() {
  const all = useT();
  const t = all.monitor;
  const { data: m } = useTradingMonitor();
  const { filter } = useSelectedAccount();
  if (!m) return null;

  const wanted = filter === '' ? undefined : filter === 'none' ? null : filter;
  const single = wanted !== undefined ? m.groups.find((g) => g.accountId === wanted) : m.groups.length === 1 ? m.groups[0] : undefined;

  return (
    <Panel title={t.title} className="flex flex-col" aria-label={t.title}>
      {single ? (
        <MonitorDetail monitor={m} group={single} />
      ) : wanted !== undefined ? (
        // "No account" selected but no such trades today.
        <MonitorDetail monitor={m} group={{ accountId: null, name: null, tradesToday: 0, overLimit: false, lossCount: 0, alert: false, alertKey: '', lossLabels: [] }} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 px-5 pt-1 pb-5">
          {m.groups.map((g) => (
            <li
              key={g.accountId ?? 'none'}
              className={`flex flex-col gap-1 rounded-(--radius-control) px-3.5 py-2.5 ${g.alert ? 'bg-sell-soft' : 'bg-raised'}`}
            >
              <span className="truncate text-[13px] font-semibold">{g.name ?? all.accounts.none}</span>
              <span className="flex flex-wrap gap-x-3 font-mono text-xs">
                <span className={g.overLimit ? 'text-sell' : 'text-dim'}>{t.compactTrades(g.tradesToday, m.maxTradesPerDay)}</span>
                <span className={g.alert ? 'font-semibold text-sell' : 'text-dim'}>{t.compactLosses(g.lossCount, m.lossLimit, m.lossMode === 'day')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MonitorDetail({ monitor: m, group: g }: { monitor: TradingMonitor; group: MonitorGroup }) {
  const all = useT();
  const t = all.monitor;
  const limit = m.maxTradesPerDay;
  const daily = m.lossMode === 'day';

  return (
    <div className="flex flex-col gap-5 px-5 pt-1 pb-5">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">{t.tradesToday}</span>
          <span className="font-mono text-lg font-medium">
            {g.tradesToday}
            {limit != null && <span className="text-dim"> / {limit}</span>}
          </span>
        </div>
        {limit != null ? (
          <>
            <Segments total={limit} filled={Math.min(g.tradesToday, limit)} over={Math.max(0, g.tradesToday - limit)} />
            <span className={`text-[13px] ${g.overLimit ? 'text-sell' : 'text-dim'}`}>
              {g.overLimit ? t.overLimit : g.tradesToday === limit ? t.limitUsed : t.left(limit - g.tradesToday, limit)}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-dim">{t.noLimit}</span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">{daily ? t.lossesToday : t.lossStreak}</span>
          <span className={`font-mono text-lg font-medium ${g.alert ? 'text-sell' : ''}`}>
            {g.lossCount}
            <span className="text-dim"> / {m.lossLimit}</span>
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: Math.max(m.lossLimit, g.lossCount) }, (_, i) => (
            <span key={i} className={`h-2 grow rounded-full ${i < g.lossCount ? 'bg-sell' : 'bg-grid'}`} />
          ))}
        </div>
        <span className={`text-[13px] ${g.alert ? 'text-sell' : 'text-dim'}`}>
          {g.alert
            ? lossAlertMessage(all, m.lossMode, g.lossCount)
            : g.lossCount > 0
              ? daily
                ? t.dayInfo(m.lossLimit)
                : t.streakInfo(m.lossLimit)
              : daily
                ? t.noLosses
                : t.noStreak}
        </span>
      </div>
    </div>
  );
}
