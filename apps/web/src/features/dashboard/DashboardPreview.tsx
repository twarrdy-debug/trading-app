import type { TradeStats } from '@trading/api/types';
import { BarList } from '../../components/charts/BarList.tsx';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { DashboardTiles } from './DashboardTiles.tsx';

/** Invented figures for previews (landing page, locked screens); never a real user's results. */
export const SAMPLE_CURVE = [120, -80, 260, 410, 180, 520, 760, 690, 940, 1210, 1080, 1460, 1720, 1650, 2010].map((cumulative, i, all) => ({
  date: `2026-09-${String(i + 8).padStart(2, '0')}`,
  cumulative,
  pnl: cumulative - (all[i - 1] ?? 0),
}));

export const SAMPLE_STATS = {
  currency: 'USD',
  summary: { pnl: 2010, returnPct: 4.02, profitFactor: 2.31, winRate: 61.54, wins: 16, losses: 10, breakevens: 4, avgWin: 214.5, avgLoss: -142.2 },
  equityCurve: SAMPLE_CURVE,
} as unknown as TradeStats;

const SAMPLE_BARS = [
  { key: 'XAUUSD', label: 'XAUUSD', value: 1240, display: '+$1240,00' },
  { key: 'US100', label: 'US100', value: 610, display: '+$610,00' },
  { key: 'EURUSD', label: 'EURUSD', value: 260, display: '+$260,00' },
  { key: 'NQ1', label: 'NQ1', value: -100, display: '−$100,00' },
];

/** What a filled dashboard looks like, on sample data (under the lock of an empty account). */
export function DashboardPreview() {
  return (
    <>
      <DashboardTiles stats={SAMPLE_STATS} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card px-3 py-4 xl:col-span-2">
          <EquityChart data={SAMPLE_CURVE} currency="USD" height={260} polarity />
        </div>
        <Panel title="XAUUSD · US100 · EURUSD">
          <BarList polarity rows={SAMPLE_BARS} />
        </Panel>
      </div>
    </>
  );
}

/** What the statistics look like, on sample data. */
export function StatsPreview() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Win rate" value="61,54%" visual={<Gauge percent={61.54} />} foot="16 W · 10 L" />
        <Stat label="P&L" value="+$2010,00" tone="buy" />
        <Stat label="R" value="+0,42 R" foot="1 : 2,1" />
        <Stat label="Profit factor" value="2,31" />
      </div>
      <div className="card px-3 py-4">
        <EquityChart data={SAMPLE_CURVE} currency="USD" height={280} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="XAUUSD · US100">
          <BarList polarity rows={SAMPLE_BARS} />
        </Panel>
        <Panel title="1 · 2 · 3">
          <BarList max={100} rows={SAMPLE_BARS.map((b, i) => ({ ...b, value: [72, 58, 44, 31][i]!, display: `${[72, 58, 44, 31][i]}%` }))} />
        </Panel>
      </div>
    </>
  );
}
