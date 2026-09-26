import { useTradingMonitor } from '../../api/hooks.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segments } from '../../components/ui/Stat.tsx';

/** "3 transakcje", "5 transakcji" – Polish plural for the streak message. */
export const tradesWord = (n: number) =>
  n === 1 ? 'transakcja' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'transakcje' : 'transakcji';

/** Trading monitor: today's trades against the limit and the losing streak. */
export function MonitorPanel() {
  const { data: m } = useTradingMonitor();
  if (!m) return null;
  const limit = m.maxTradesPerDay;

  return (
    <Panel title="Monitor tradingu" className="flex flex-col" aria-label="Monitor tradingu">
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Transakcje dziś</span>
            <span className="font-mono text-xl font-semibold">
              {m.tradesToday}
              {limit != null && <span className="text-dim"> / {limit}</span>}
            </span>
          </div>
          {limit != null ? (
            <>
              <Segments total={limit} filled={Math.min(m.tradesToday, limit)} over={Math.max(0, m.tradesToday - limit)} />
              <span className={`text-[13px] ${m.overLimit ? 'text-sell' : 'text-dim'}`}>
                {m.overLimit
                  ? 'Przekroczony dzienny limit. Rozważ zakończenie sesji.'
                  : m.tradesToday === limit
                    ? 'Limit wykorzystany. Kolejna transakcja to overtrading.'
                    : `Zostało ${limit - m.tradesToday} z ${limit} transakcji.`}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-dim">Ustaw dzienny limit w ustawieniach, żeby pilnować overtradingu.</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Straty z rzędu dziś</span>
            <span className={`font-mono text-xl font-semibold ${m.alert ? 'text-sell' : ''}`}>
              {m.lossStreak}
              <span className="text-dim"> / {m.lossStreakAlert}</span>
            </span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: Math.max(m.lossStreakAlert, m.lossStreak) }, (_, i) => (
              <span key={i} className={`h-2.5 grow ${i < m.lossStreak ? 'bg-sell' : 'bg-grid'}`} />
            ))}
          </div>
          <span className={`text-[13px] ${m.alert ? 'text-sell' : 'text-dim'}`}>
            {m.alert
              ? `${m.lossStreak} ${tradesWord(m.lossStreak)} z rzędu skończyły się niepowodzeniem. Trzymaj się zasad i nie overtraduj!`
              : m.lossStreak > 0
                ? `Po ${m.lossStreakAlert} stratach z rzędu pojawi się ostrzeżenie.`
                : 'Brak serii strat. Tak trzymaj.'}
          </span>
        </div>
      </div>
    </Panel>
  );
}
