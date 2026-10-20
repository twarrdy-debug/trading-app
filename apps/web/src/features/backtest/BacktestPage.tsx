import { analysisSource, ANALYSIS_RESOLUTIONS, toLocalDate, zonedTimeToUtc, type AnalysisResolution } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useBacktestAccounts, useBacktestSessions, useCreateBacktestSession, useDeleteBacktestSession, useInstruments, useMe, useStrategies } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Field, Segmented } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatNumber } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';
import { AnalysisTabs } from '../analysis/AnalysisTabs.tsx';
import { ReplayView } from './ReplayView.tsx';
import { PlanGate } from '../plans/PlanLocked.tsx';

const SESSION_KEY = 'backtest-session';
const read = () => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};
const write = (id: string | null) => {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // The open session is forgotten on reload.
  }
};

/** Backtesting (`/analiza/backtesting`): the sessions and a new one, or the open session's replay. */
export function BacktestPage() {
  const all = useT();
  const t = all.backtest;
  const [sessionId, setSessionId] = useState<string | null>(read);
  const open = (id: string | null) => {
    setSessionId(id);
    write(id);
  };
  return (
    <main className="page">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <AnalysisTabs />
      </div>
      <PlanGate feature="backtest" demo={{ title: all.demo.analysisTitle, text: all.demo.analysisText }} plan={{ title: all.plans.analysisTitle, text: all.plans.analysisText }}>
        {sessionId ? (
          <ReplayView sessionId={sessionId} onExit={() => open(null)} />
        ) : (
          <>
            <p className="m-0 -mt-2 max-w-3xl text-sm text-dim">{t.intro}</p>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <NewSession onCreated={open} />
              <Sessions onOpen={open} />
            </div>
          </>
        )}
      </PlanGate>
    </main>
  );
}

function NewSession({ onCreated }: { onCreated: (id: string) => void }) {
  const all = useT();
  const t = all.backtest;
  const { data: me } = useMe();
  const { data: accounts = [] } = useBacktestAccounts();
  const { data: instruments = [] } = useInstruments();
  const { data: strategies = [] } = useStrategies();
  const create = useCreateBacktestSession();
  const timeZone = me?.settings.timezone ?? 'Europe/Warsaw';
  // Instruments with their own candles: futures are replayed on their CFD.
  const choices = instruments.filter((i) => i.active !== false && analysisSource(i.symbol) && !analysisSource(i.symbol)!.via);
  const [accountId, setAccountId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [resolution, setResolution] = useState<AnalysisResolution>('M5');
  // A week ago at 08:00 in the user's zone.
  const [start, setStart] = useState(() => `${toLocalDate(new Date(Date.now() - 7 * 86_400_000), timeZone)}T08:00`);
  const [strategyId, setStrategyId] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const account = accountId || accounts[0]?.id || '';
  const instrument = instrumentId || choices.find((i) => i.favorite)?.id || choices[0]?.id || '';

  const submit = () => {
    setErrors([]);
    create.mutate(
      { accountId: account, instrumentId: instrument, resolution, startAt: zonedTimeToUtc(`${start}:00`, timeZone).toISOString(), strategyId: strategyId || null },
      { onSuccess: (s) => onCreated(s.id), onError: (err) => setErrors(err instanceof ApiError ? err.lines : [String(err)]) },
    );
  };

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label={t.newSession}>
      <h2 className="m-0 text-[15px] font-bold">{t.newSession}</h2>
      {accounts.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-(--radius-control) bg-raised p-3.5 text-[13px] text-dim">
          {t.noAccounts}
          <Link to="/ustawienia/$section" params={{ section: 'konta' }} className="font-semibold text-accent-ink">
            {t.addAccount}
          </Link>
        </div>
      ) : (
        <>
          <Field label={t.account}>
            <Select value={account} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${formatAmount(a.balance, me?.settings.accountCurrency ?? 'USD', false)}` }))} />
          </Field>
          <Field label={t.instrument} help={t.futuresNote}>
            <Select
              value={instrument}
              onChange={setInstrumentId}
              options={instrumentOptions(choices, { label: (i) => `${i.symbol} · ${i.name}`, favorites: all.instruments.favorites, others: all.instruments.others })}
            />
          </Field>
          <Field label={t.resolution}>
            <div className="max-w-full overflow-x-auto">
              <Segmented label={t.resolution} value={resolution} onChange={setResolution} options={ANALYSIS_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
            </div>
          </Field>
          <Field label={t.start} help={t.startHelp}>
            <DateTimePicker value={start} onChange={setStart} />
          </Field>
          <Field label={t.strategy} help={t.strategyHelp}>
            <Select value={strategyId} onChange={setStrategyId} options={[{ value: '', label: t.noStrategy }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          {errors.length > 0 && (
            <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
              {errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <Button variant="primary" onClick={submit} disabled={!account || !instrument || !start || create.isPending}>
            {t.startButton}
          </Button>
        </>
      )}
    </section>
  );
}

function Sessions({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT().backtest;
  const { data: me } = useMe();
  const { data: sessions = [] } = useBacktestSessions();
  const remove = useDeleteBacktestSession();
  const timeZone = me?.settings.timezone ?? 'Europe/Warsaw';
  const currency = me?.settings.accountCurrency ?? 'USD';
  const date = (at: string) => new Date(at).toLocaleString(currentLocale(), { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="card flex flex-col gap-3 p-5" aria-label={t.sessions}>
      <h2 className="m-0 text-[15px] font-bold">{t.sessions}</h2>
      {sessions.length === 0 && <span className="text-[13px] text-dim">{t.noSessions}</span>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sessions.map((s) => {
          const r = s.summary.totalR;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--radius-control) bg-raised px-3.5 py-3">
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {s.symbol} · {s.resolution}
                  {s.finishedAt && <span className="rounded-full bg-chip px-2 py-0.5 text-[10.5px] font-bold text-dim">{t.finished}</span>}
                </span>
                <span className="text-xs text-dim">
                  {t.since(date(s.startAt))}
                  {s.strategyName ? ` · ${s.strategyName}` : ''}
                </span>
              </div>
              <span className="font-mono text-[13px]">
                {s.summary.trades} · {s.summary.winRate == null ? '—' : `${formatNumber(s.summary.winRate)}%`} ·{' '}
                <span className={r > 0 ? 'text-buy' : r < 0 ? 'text-sell' : ''}>{`${formatNumber(r, true)}R`}</span> · {formatAmount(s.summary.pnl, currency)}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => onOpen(s.id)}>
                  {t.continue}
                </Button>
                <Button size="sm" variant="ghost" className="text-sell!" onClick={() => window.confirm(t.deleteConfirm) && remove.mutate(s.id)}>
                  {t.delete}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
