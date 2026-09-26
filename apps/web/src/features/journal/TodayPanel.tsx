import { useTrades } from '../../api/hooks.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segments } from '../../components/ui/Stat.tsx';

/** Trades taken today against the daily limit (overtrading guard). */
export function TodayPanel({ today, limit }: { today: string; limit: number | null }) {
  const { data } = useTrades({ dateFrom: today, dateTo: today, limit: 1 });
  const count = data?.total ?? 0;
  const over = limit != null && count > limit;

  return (
    <Panel className="flex flex-col gap-3 p-5" aria-label="Transakcje dziś">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Transakcje dziś</span>
        <span className="font-mono text-[22px] font-semibold">
          {count}
          {limit != null && <span className="text-dim"> / {limit}</span>}
        </span>
      </div>
      {limit != null ? (
        <>
          <Segments total={limit} filled={Math.min(count, limit)} over={Math.max(0, count - limit)} />
          <span className={`text-[13px] ${over ? 'text-sell' : 'text-dim'}`}>
            {over
              ? 'Przekroczony dzienny limit. Rozważ zakończenie sesji.'
              : count === limit
                ? 'Limit wykorzystany. Kolejna transakcja to overtrading.'
                : `Zostało ${limit - count} z ${limit} transakcji.`}
          </span>
        </>
      ) : (
        <span className="text-[13px] text-dim">Ustaw dzienny limit w ustawieniach, żeby pilnować overtradingu.</span>
      )}
    </Panel>
  );
}
