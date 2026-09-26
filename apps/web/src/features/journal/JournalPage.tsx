import type { PublicUser, TradeMutation } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { useInstruments, useMe, useTrades, useTradeStats, type TradeQuery } from '../../api/hooks.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { formatMoney, formatNumber, formatPercent } from '../../lib/format.ts';
import { TodayPanel } from './TodayPanel.tsx';
import { TradeForm } from './TradeForm.tsx';
import { TradeFilters, TradeTable } from './TradeTable.tsx';

const PAGE = 50;
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

function MonthOverview({ user, today }: { user: PublicUser; today: string }) {
  const monthStart = `${today.slice(0, 8)}01`;
  const { data: stats } = useTradeStats({ dateFrom: monthStart, dateTo: today });
  const s = stats?.summary;
  const currency = user.settings.accountCurrency;
  const month = MONTHS[Number(today.slice(5, 7)) - 1];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat brackets label="Win rate" value={formatPercent(s?.winRate)} visual={<Gauge percent={s?.winRate ?? null} />} foot={s ? `${s.wins} W · ${s.losses} L` : undefined} />
        <Stat label="Średni R" value={s?.avgR == null ? '—' : `${formatNumber(s.avgR, true)} R`} foot={s?.avgPlannedRR != null ? `plan R:R ${formatNumber(s.avgPlannedRR)}` : undefined} />
        <Stat
          label={`Wynik · ${month}`}
          value={formatMoney(s?.pnl)}
          tone={s && s.pnl < 0 ? 'sell' : s && s.pnl > 0 ? 'buy' : 'ink'}
          foot={s ? `${currency} · ${s.trades} transakcji` : undefined}
        />
        <Stat label="Profit factor" value={formatNumber(s?.profitFactor)} foot={s ? `max seria strat: ${s.maxLossStreak}` : undefined} />
      </div>
      <Panel brackets title="Krzywa wyniku" actions={<span className="font-mono text-xs text-dim">{month}</span>}>
        <div className="px-3 py-4">
          <EquityChart data={stats?.equityCurve ?? []} currency={currency} height={220} />
        </div>
      </Panel>
    </>
  );
}

export function JournalPage() {
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const [filters, setFilters] = useState<TradeQuery>({});
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<{ title: string; warnings: string[] } | null>(null);
  const trades = useTrades({ ...filters, limit });

  if (!me || !instruments) {
    return <main className="grow p-8 text-dim">Ładowanie…</main>;
  }

  const today = toLocalDate(new Date(), me.settings.timezone);
  const items = trades.data?.items ?? [];
  const selected = items.find((t) => t.id === selectedId);

  const closeForm = () => {
    setSelectedId(null);
    setFormKey((k) => k + 1);
  };
  const onSaved = (result: TradeMutation, mode: 'created' | 'updated') => {
    setNotice({ title: `${mode === 'created' ? 'Dodano' : 'Zapisano'} ${result.trade.dayLabel}`, warnings: result.warnings });
    closeForm();
  };

  return (
    <div className="flex grow flex-col gap-6 p-4 md:px-8 md:py-6 lg:flex-row">
      <main className="flex min-w-0 grow flex-col gap-5">
        <MonthOverview user={me} today={today} />

        <Panel
          title="Transakcje"
          actions={<span className="font-mono text-xs text-dim">{trades.data ? `${items.length} z ${trades.data.total}` : ''}</span>}
        >
          <TradeFilters
            value={filters}
            onChange={(next) => {
              setFilters(next);
              setLimit(PAGE);
            }}
            instruments={instruments}
          />
          <TradeTable trades={items} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} />
          {trades.data && items.length < trades.data.total && (
            <div className="flex justify-center border-t border-line p-4">
              <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Pokaż więcej
              </Button>
            </div>
          )}
        </Panel>
      </main>

      <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-[380px]">
        <TodayPanel today={today} limit={me.settings.maxTradesPerDay} />
        {notice && (
          <div role="status" className="flex flex-col gap-1.5 border border-accent p-4 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{notice.title}</span>
              <button type="button" aria-label="Zamknij komunikat" onClick={() => setNotice(null)} className="size-7 text-dim hover:text-ink">
                ✕
              </button>
            </div>
            {notice.warnings.map((w) => (
              <span key={w} className="text-dim">
                {w}
              </span>
            ))}
          </div>
        )}
        <TradeForm
          key={selected ? selected.id : `new-${formKey}`}
          user={me}
          instruments={instruments}
          defaultInstrumentId={items[0]?.instrumentId}
          trade={selected}
          onSaved={onSaved}
          onDeleted={() => {
            setNotice({ title: 'Usunięto transakcję', warnings: [] });
            closeForm();
          }}
          onCancel={closeForm}
        />
      </aside>
    </div>
  );
}
