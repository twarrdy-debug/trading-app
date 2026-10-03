import type { AccountSummary } from '@trading/api/types';
import type { ChartLevel } from '../../components/charts/EquityChart.tsx';
import type { Messages } from '../../i18n/index.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { currencyLabel, formatAmount, formatNumber } from '../../lib/format.ts';

export type AccountOverview = AccountSummary;

/** Reference lines for the balance chart: the starting balance, and for prop accounts the limit and target. */
export const accountLevels = (t: Messages, account: AccountOverview | null | undefined): ChartLevel[] =>
  !account
    ? []
    : [
        { value: account.size, label: t.chart.start, tone: 'dim' },
        ...(account.prop ? [{ value: account.prop.floor, label: t.chart.floor, tone: 'sell' as const }] : []),
        ...(account.prop?.target ? [{ value: account.prop.target.balance, label: t.chart.target, tone: 'buy' as const }] : []),
      ];

/** "Prop · CFD · $10 000" – type, market and size in one line (whole amounts without ",00"). */
export const accountKind = (t: Messages, account: Pick<AccountOverview, 'type' | 'market' | 'size'>, currency: string) =>
  t.accounts.summary(
    t.accounts[account.type],
    account.market ? t.accounts[account.market] : null,
    formatAmount(account.size, currency, false).replace(/[.,]00(?= |$)/, ''),
  );

const pct = (value: number, signed = false) => `${formatNumber(value, signed)}%`;
/** Drawdown usage from which the prop limit is shown in red. */
const DANGER_PCT = 80;

/** Account tiles on the statistics page: balance, drawdown and, for prop accounts, the limit. */
export function AccountTiles({ account, currency }: { account: AccountOverview; currency: string }) {
  const t = useT().account;
  const money = (value: number, signed = false) => formatAmount(value, currency, signed);
  const prop = account.prop;
  const danger = prop != null && (prop.breached || prop.usedPct >= DANGER_PCT);
  const balanceTiles = (
    <>
      <Stat
        label={`${t.balance} · ${account.name}`}
        value={money(account.balance)}
        foot={[currencyLabel(currency), t.startBalance(money(account.size))].filter(Boolean).join(' · ')}
      />
      <Stat
        label={t.returnAll}
        value={pct(account.returnPct, true)}
        tone={account.pnl > 0 ? 'buy' : account.pnl < 0 ? 'sell' : 'ink'}
        foot={money(account.pnl, true)}
      />
      <Stat
        label={t.currentDrawdown}
        value={pct(account.currentDrawdownPct)}
        tone={account.currentDrawdown > 0 ? 'sell' : 'ink'}
        foot={t.maxDrawdown(pct(account.maxDrawdownPct), money(account.maxDrawdown))}
      />
    </>
  );
  const propTiles = prop && (
    <>
      <Stat
        label={t.limitUsed(`${pct(prop.maxDrawdownPct)}${prop.drawdownType === 'eod' ? ` ${t.eod}` : ''}`)}
        value={pct(prop.usedPct)}
        tone={danger ? 'sell' : 'ink'}
        visual={<Gauge percent={prop.usedPct} tone={danger ? 'sell' : 'accent'} />}
        foot={prop.breached ? t.breached : t.remaining(money(prop.remaining), money(prop.floor))}
      />
      {prop.target && (
        <Stat
          label={t.target(pct(prop.target.pct))}
          value={pct(prop.target.progressPct)}
          tone={prop.target.reached ? 'buy' : 'ink'}
          visual={<Gauge percent={prop.target.progressPct} tone={prop.target.reached ? 'buy' : 'accent'} />}
          foot={prop.target.reached ? t.targetReached : t.targetRemaining(money(prop.target.remaining), money(prop.target.balance))}
        />
      )}
    </>
  );

  // Live: 3 tiles. Prop: 4 in one row. Prop with a target: 3, then limit and target side by side.
  if (prop?.target) {
    return (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{balanceTiles}</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{propTiles}</div>
      </>
    );
  }
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${prop ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
      {balanceTiles}
      {propTiles}
    </div>
  );
}

/** Compact account summary in the journal's side column. */
export function AccountPanel({ account, currency }: { account: AccountOverview; currency: string }) {
  const all = useT();
  const money = (value: number, signed = false) => formatAmount(value, currency, signed);
  const t = all.account;
  const prop = account.prop;
  const danger = prop != null && (prop.breached || prop.usedPct >= DANGER_PCT);
  return (
    <Panel
      title={account.name}
      actions={<span className="font-mono text-xs text-dim">{accountKind(all, account, currency)}</span>}
    >
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="eyebrow">{t.balance}</span>
            <span className="text-2xl font-bold tracking-tight tabular-nums">{money(account.balance)}</span>
          </div>
          <span className={`font-mono text-sm ${account.pnl > 0 ? 'text-buy' : account.pnl < 0 ? 'text-sell' : 'text-dim'}`}>
            {money(account.pnl, true)} · {pct(account.returnPct, true)}
          </span>
        </div>
        {prop ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold">{`${t.ddLimit} · ${pct(prop.maxDrawdownPct)}${prop.drawdownType === 'eod' ? ` ${t.eod}` : ''}`}</span>
              <span className={`font-mono ${danger ? 'text-sell' : ''}`}>{pct(prop.usedPct)}</span>
            </div>
            <div className="h-2 rounded-full bg-grid" role="meter" aria-valuenow={prop.usedPct} aria-valuemin={0} aria-valuemax={100} aria-label={t.ddLimit}>
              <div className={`h-2 rounded-full ${danger ? 'bg-sell' : 'bg-accent'}`} style={{ width: `${Math.max(prop.usedPct, prop.usedPct > 0 ? 2 : 0)}%` }} />
            </div>
            <span className={`text-[13px] ${prop.breached ? 'font-semibold text-sell' : 'text-dim'}`}>
              {prop.breached ? t.breached : t.remaining(money(prop.remaining), money(prop.floor))}
            </span>
            {prop.target && (
              <>
                <div className="mt-2 flex items-baseline justify-between text-[13px]">
                  <span className="font-semibold">{t.target(pct(prop.target.pct))}</span>
                  <span className={`font-mono ${prop.target.reached ? 'text-buy' : ''}`}>{pct(prop.target.progressPct)}</span>
                </div>
                <div className="h-2 rounded-full bg-grid" role="meter" aria-valuenow={prop.target.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={t.target(pct(prop.target.pct))}>
                  <div className="h-2 rounded-full bg-buy" style={{ width: `${prop.target.progressPct}%` }} />
                </div>
                <span className={`text-[13px] ${prop.target.reached ? 'font-semibold text-buy' : 'text-dim'}`}>
                  {prop.target.reached
                    ? t.targetReached
                    : t.targetRemaining(money(prop.target.remaining), money(prop.target.balance))}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-[13px] text-dim">
            {t.currentDrawdown}: {pct(account.currentDrawdownPct)} · {t.maxDrawdown(pct(account.maxDrawdownPct), money(account.maxDrawdown))}
          </span>
        )}
      </div>
    </Panel>
  );
}

/** One card per account, for the "all accounts" view of the statistics. */
export function AccountCards({ accounts, currency }: { accounts: AccountOverview[]; currency: string }) {
  const all = useT();
  const t = all.account;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {accounts.map((a) => {
        const danger = a.prop != null && (a.prop.breached || a.prop.usedPct >= DANGER_PCT);
        return (
          <div key={a.id} className="card flex flex-col gap-3 px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[15px] font-bold">{a.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-dim">{accountKind(all, a, currency)}</span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <span className="text-2xl font-bold tracking-tight tabular-nums">
                {formatAmount(a.balance, currency, false)}
                {currencyLabel(currency) && <span className="text-xs font-medium text-dim"> {currencyLabel(currency)}</span>}
              </span>
              <span className={`font-mono text-sm ${a.pnl > 0 ? 'text-buy' : a.pnl < 0 ? 'text-sell' : 'text-dim'}`}>{pct(a.returnPct, true)}</span>
            </div>
            {a.prop ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-dim">{t.limitUsed(`${pct(a.prop.maxDrawdownPct)}${a.prop.drawdownType === 'eod' ? ` ${t.eod}` : ''}`)}</span>
                  <span className={`font-mono ${danger ? 'text-sell' : ''}`}>{pct(a.prop.usedPct)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-grid">
                  <div className={`h-1.5 rounded-full ${danger ? 'bg-sell' : 'bg-accent'}`} style={{ width: `${a.prop.usedPct}%` }} />
                </div>
                {a.prop.target && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">{t.target(pct(a.prop.target.pct))}</span>
                      <span className={`font-mono ${a.prop.target.reached ? 'text-buy' : ''}`}>{pct(a.prop.target.progressPct)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-grid">
                      <div className="h-1.5 rounded-full bg-buy" style={{ width: `${a.prop.target.progressPct}%` }} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <span className="text-xs text-dim">
                {t.currentDrawdown}: {pct(a.currentDrawdownPct)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
