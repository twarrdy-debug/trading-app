import { useTradingMonitor } from '../../api/hooks.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segments } from '../../components/ui/Stat.tsx';
import { useT, type Messages } from '../../i18n/index.tsx';

/** Warning text for the counted losses: in a row or all of the day. */
export const lossAlertMessage = (t: Messages, mode: 'streak' | 'day', count: number) =>
  mode === 'day' ? t.lossStreak.dayMessage(count) : t.lossStreak.message(count);

/** Trading monitor: today's trades against the limit and the losing streak. */
export function MonitorPanel() {
  const all = useT();
  const t = all.monitor;
  const { data: m } = useTradingMonitor();
  if (!m) return null;
  const limit = m.maxTradesPerDay;
  const daily = m.lossMode === 'day';

  return (
    <Panel title={t.title} className="flex flex-col" aria-label={t.title}>
      <div className="flex flex-col gap-5 px-5 pt-1 pb-5">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">{t.tradesToday}</span>
            <span className="font-mono text-lg font-medium">
              {m.tradesToday}
              {limit != null && <span className="text-dim"> / {limit}</span>}
            </span>
          </div>
          {limit != null ? (
            <>
              <Segments total={limit} filled={Math.min(m.tradesToday, limit)} over={Math.max(0, m.tradesToday - limit)} />
              <span className={`text-[13px] ${m.overLimit ? 'text-sell' : 'text-dim'}`}>
                {m.overLimit ? t.overLimit : m.tradesToday === limit ? t.limitUsed : t.left(limit - m.tradesToday, limit)}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-dim">{t.noLimit}</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">{daily ? t.lossesToday : t.lossStreak}</span>
            <span className={`font-mono text-lg font-medium ${m.alert ? 'text-sell' : ''}`}>
              {m.lossCount}
              <span className="text-dim"> / {m.lossLimit}</span>
            </span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: Math.max(m.lossLimit, m.lossCount) }, (_, i) => (
              <span key={i} className={`h-2 grow rounded-full ${i < m.lossCount ? 'bg-sell' : 'bg-grid'}`} />
            ))}
          </div>
          <span className={`text-[13px] ${m.alert ? 'text-sell' : 'text-dim'}`}>
            {m.alert
              ? lossAlertMessage(all, m.lossMode, m.lossCount)
              : m.lossCount > 0
                ? daily
                  ? t.dayInfo(m.lossLimit)
                  : t.streakInfo(m.lossLimit)
                : daily
                  ? t.noLosses
                  : t.noStreak}
          </span>
        </div>
      </div>
    </Panel>
  );
}
