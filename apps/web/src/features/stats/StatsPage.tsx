import type { TradeStats } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { useInstruments, useMe, useTradeStats } from '../../api/hooks.ts';
import { BarList, type BarRow } from '../../components/charts/BarList.tsx';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Segmented, Select } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { addDays, formatMoney, formatNumber, formatPercent } from '../../lib/format.ts';

type Range = '7' | '30' | '90' | 'all';

type Breakdown = TradeStats['byInstrument'][number];

const detail = (b: Breakdown) => `${b.trades} tr. · WR ${formatPercent(b.winRate)} · ${formatNumber(b.avgR, true)} R`;

const pnlRows = (list: Breakdown[], label: (b: Breakdown) => string = (b) => b.key): BarRow[] =>
  [...list]
    .sort((a, b) => b.pnl - a.pnl)
    .map((b) => ({ key: b.key, label: label(b), value: b.pnl, display: formatMoney(b.pnl), detail: detail(b) }));

const winRateRows = (list: (Breakdown & { label?: string })[], label: (b: Breakdown & { label?: string }) => string): BarRow[] =>
  list.map((b) => ({
    key: b.key,
    label: label(b),
    value: b.winRate,
    display: formatPercent(b.winRate),
    detail: `${b.trades} tr. · ${formatNumber(b.avgR, true)} R · ${formatMoney(b.pnl)}`,
  }));

export function StatsPage() {
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const [range, setRange] = useState<Range>('30');
  const [instrumentId, setInstrumentId] = useState('');

  const today = me ? toLocalDate(new Date(), me.settings.timezone) : undefined;
  const dateFrom = today && range !== 'all' ? addDays(today, -(Number(range) - 1)) : undefined;
  const { data: stats } = useTradeStats({ dateFrom, dateTo: range === 'all' ? undefined : today, instrumentId: instrumentId || undefined });

  if (!me || !stats) return <main className="grow p-8 text-dim">Ładowanie…</main>;

  const s = stats.summary;
  const currency = stats.currency;

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-lg font-semibold tracking-[0.14em] uppercase">Statystyki</h1>
        <div className="grow" />
        <div className="w-56">
          <Select aria-label="Instrument" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <option value="">Wszystkie instrumenty</option>
            {instruments?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol}
              </option>
            ))}
          </Select>
        </div>
        <Segmented
          label="Zakres dat"
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7D' },
            { value: '30', label: '30D' },
            { value: '90', label: '90D' },
            { value: 'all', label: 'Całość' },
          ]}
        />
      </div>

      {s.tradesWithoutPnl > 0 && (
        <p className="m-0 border border-accent p-3 text-[13px]">
          {s.tradesWithoutPnl} zamkniętych transakcji nie ma wyniku w {currency} (brak kursu waluty albo inna waluta konta). Nie są wliczone do kwot.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat brackets label="Win rate" value={formatPercent(s.winRate)} visual={<Gauge percent={s.winRate} />} foot={`${s.wins} W · ${s.losses} L · ${s.trades} razem`} />
        <Stat label="Wynik" value={formatMoney(s.pnl)} tone={s.pnl < 0 ? 'sell' : s.pnl > 0 ? 'buy' : 'ink'} foot={currency} />
        <Stat label="Średni R" value={s.avgR == null ? '—' : `${formatNumber(s.avgR, true)} R`} foot={`plan R:R ${formatNumber(s.avgPlannedRR)}`} />
        <Stat label="Profit factor" value={formatNumber(s.profitFactor)} foot={`max seria strat: ${s.maxLossStreak}`} />
        <Stat label="Średni zysk" value={formatMoney(s.avgWin)} tone="buy" foot={currency} />
        <Stat label="Średnia strata" value={formatMoney(s.avgLoss)} tone="sell" foot={currency} />
        <Stat label="Koszt spreadu" value={formatMoney(s.spreadCost, false)} foot={`${currency} · już w cenach`} />
        <Stat label="Transakcje" value={String(s.trades)} foot="zamknięte w okresie" />
      </div>

      <Panel brackets title="Krzywa wyniku" actions={<span className="font-mono text-xs text-dim">{currency}</span>}>
        <div className="px-3 py-4">
          <EquityChart data={stats.equityCurve} currency={currency} height={280} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title={`Wynik wg instrumentu · ${currency}`}>
          <BarList polarity rows={pnlRows(stats.byInstrument)} />
        </Panel>
        <Panel title={`Wynik wg źródła · ${currency}`}>
          <BarList polarity rows={pnlRows(stats.bySource)} />
        </Panel>
        <Panel title="Win rate wg numeru transakcji w dniu">
          <BarList max={100} rows={winRateRows(stats.byDayIndex, (b) => `${b.key}. transakcja`)} />
        </Panel>
        <Panel title="Win rate wg emocji">
          <BarList max={100} rows={winRateRows([...stats.byEmotion].sort((a, b) => b.trades - a.trades), (b) => b.label ?? b.key)} />
        </Panel>
      </div>
    </main>
  );
}
