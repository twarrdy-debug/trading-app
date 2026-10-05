import type { PublicUser } from '@trading/api/types';
import { ACCOUNT_CURRENCY_CHOICES } from '@trading/shared';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAccounts, useInstruments, useOnboarding, useSaveStrategy, useStrategies, useUpdateSettings } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, toggleClass } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { Segments } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { APP_NAME } from '../../layout/AppShell.tsx';
import { AccountsManager } from '../account/AccountsManager.tsx';
import { FavoriteInstrumentsPicker } from '../settings/FavoriteInstruments.tsx';

const STEPS = ['currency', 'favorites', 'account', 'strategy', 'done'] as const;
type Step = (typeof STEPS)[number];
const ZONES = ['Europe/Warsaw', 'Europe/London', 'America/New_York', 'America/Chicago', 'Asia/Tokyo', 'UTC'];

/**
 * First-run introduction after signing up: account currency and time zone, favourite instruments,
 * a trading account and a first strategy. Every step saves right away; finishing (or skipping)
 * marks the user as onboarded.
 */
export function Onboarding({ user }: { user: PublicUser }) {
  const all = useT();
  const t = all.onboarding;
  const [step, setStep] = useState<Step>('currency');
  const onboarding = useOnboarding();
  const { data: accounts = [] } = useAccounts();
  const index = STEPS.indexOf(step);
  const go = (by: 1 | -1) => setStep(STEPS[index + by]!);
  const finish = () => onboarding.mutate('finish');

  const content: Record<Step, { title: string; text: string; body: ReactNode; optional?: boolean; canContinue?: boolean }> = {
    currency: { title: t.currency.title(user.displayName), text: t.currency.text, body: <CurrencyStep user={user} /> },
    favorites: { title: t.favorites.title, text: t.favorites.text, body: <FavoritesStep />, optional: true },
    account: {
      title: t.account.title,
      text: t.account.text,
      body: (
        <div className="flex flex-col gap-3">
          <AccountsManager currency={user.settings.accountCurrency} />
          {accounts.length === 0 && <p className="m-0 rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">{t.account.required}</p>}
        </div>
      ),
      optional: accounts.length === 0,
      canContinue: accounts.length > 0,
    },
    strategy: { title: t.strategy.title, text: t.strategy.text, body: <StrategyStep />, optional: true },
    done: { title: t.done.title, text: t.done.text, body: <DoneStep user={user} /> },
  };
  const current = content[step];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 px-4 pt-5 md:px-8">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 14h8l3-8 4 16 3-8h6" />
          </svg>
        </span>
        <span className="text-[15px] font-bold">{APP_NAME}</span>
        <div className="grow" />
        {step !== 'done' && (
          <Button size="sm" variant="ghost" onClick={finish} disabled={onboarding.isPending}>
            {t.skipAll}
          </Button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl grow flex-col gap-6 px-4 py-8 md:py-12">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-dim">{t.stepOf(index + 1, STEPS.length)}</span>
          <Segments total={STEPS.length} filled={index + 1} />
        </div>
        <section className="card flex flex-col gap-6 p-6 md:p-8" aria-labelledby="onboarding-title">
          <div className="flex flex-col gap-2">
            <h1 id="onboarding-title" className="m-0 text-2xl font-extrabold tracking-tight text-balance">
              {current.title}
            </h1>
            <p className="m-0 max-w-2xl text-sm text-dim">{current.text}</p>
          </div>
          {current.body}
        </section>
        <div className="flex flex-wrap items-center gap-3">
          {index > 0 && (
            <Button onClick={() => go(-1)} variant="ghost">
              ← {t.back}
            </Button>
          )}
          <div className="grow" />
          {current.optional && step !== 'done' && (
            <Button variant="ghost" onClick={() => go(1)}>
              {t.later}
            </Button>
          )}
          {step === 'done' ? (
            <Button variant="primary" size="lg" onClick={finish} disabled={onboarding.isPending}>
              {t.finish} →
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(1)} disabled={current.canContinue === false}>
              {t.next} →
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function CurrencyStep({ user }: { user: PublicUser }) {
  const t = useT().onboarding.currency;
  const update = useUpdateSettings();
  const { accountCurrency: currency, timezone } = user.settings;
  const [other, setOther] = useState((ACCOUNT_CURRENCY_CHOICES as readonly string[]).includes(currency) ? '' : currency);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([timezone, browserZone, ...ZONES])];
  const saveOther = () => {
    const code = other.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && code !== currency) update.mutate({ accountCurrency: code });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold">{t.currency}</span>
        <div className="flex flex-wrap items-center gap-2">
          {ACCOUNT_CURRENCY_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => {
                setOther('');
                if (currency !== c) update.mutate({ accountCurrency: c });
              }}
              className={`h-11 min-w-20 px-4 font-mono text-sm ${toggleClass(currency === c)}`}
            >
              {c}
            </button>
          ))}
          <label className="flex items-center gap-2 text-xs whitespace-nowrap text-dim">
            {t.other}
            <Input
              value={other}
              onChange={(e) => setOther(e.target.value.toUpperCase())}
              onBlur={saveOther}
              onKeyDown={(e) => e.key === 'Enter' && saveOther()}
              maxLength={3}
              placeholder="CHF"
              className="w-20! text-center"
            />
          </label>
        </div>
        <span className="text-xs text-dim">{t.currencyHelp}</span>
      </div>
      <Field label={t.timezone} help={t.timezoneHelp}>
        <Select value={timezone} onChange={(tz) => tz !== timezone && update.mutate({ timezone: tz })} options={zones.map((tz) => ({ value: tz, label: tz }))} />
      </Field>
    </div>
  );
}

function FavoritesStep() {
  const t = useT().onboarding.favorites;
  const { data: instruments = [] } = useInstruments();
  const count = instruments.filter((i) => i.favorite).length;
  return (
    <div className="flex flex-col gap-3">
      <FavoriteInstrumentsPicker />
      <span className="font-mono text-xs text-dim" aria-live="polite">
        {t.count(count)}
      </span>
    </div>
  );
}

function StrategyStep() {
  const t = useT().onboarding.strategy;
  const save = useSaveStrategy();
  const { data: strategies = [] } = useStrategies();
  const [name, setName] = useState('');
  const [rules, setRules] = useState<string[]>([]);
  const [rule, setRule] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const addRule = () => {
    const label = rule.trim();
    if (!label) return;
    setRules([...rules, label]);
    setRule('');
  };
  const submit = () => {
    if (!name.trim()) return;
    const all = rule.trim() ? [...rules, rule.trim()] : rules;
    setErrors([]);
    save.mutate(
      { input: { name: name.trim(), rules: all } },
      {
        onSuccess: (strategy) => {
          setSaved(strategy.name);
          setName('');
          setRules([]);
          setRule('');
        },
        onError: (err) => setErrors(err instanceof ApiError ? err.lines : [err.message]),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {strategies.length > 0 && !saved && <p className="m-0 text-[13px] text-dim">{t.existing(strategies.length)}</p>}
      {saved && (
        <p role="status" className="m-0 rounded-(--radius-control) bg-buy-soft p-3 text-[13px] text-buy">
          {t.saved(saved)}
        </p>
      )}
      <Field label={t.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} maxLength={80} className="font-sans" />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">{t.rules}</span>
        {rules.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {rules.map((label, i) => (
              <li key={`${i}-${label}`} className="flex items-center gap-2.5 rounded-(--radius-control) bg-raised px-3 py-2 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-[11px] font-semibold text-dim">{i + 1}</span>
                <span className="grow">{label}</span>
                <button
                  type="button"
                  aria-label={t.removeRule(label)}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  className="size-7 rounded-[8px] text-dim hover:bg-chip hover:text-sell"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            addRule();
          }}
        >
          <Input aria-label={t.addRule} value={rule} onChange={(e) => setRule(e.target.value)} placeholder={t.rulePlaceholder} maxLength={200} className="grow font-sans" />
          <Button type="submit" disabled={!rule.trim()} className="shrink-0 whitespace-nowrap">
            + {t.addRule}
          </Button>
        </form>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={submit} disabled={!name.trim() || save.isPending} className="self-start">
        {t.save}
      </Button>
    </div>
  );
}

function DoneStep({ user }: { user: PublicUser }) {
  const t = useT().onboarding.done;
  const { data: instruments = [] } = useInstruments();
  const { data: accounts = [] } = useAccounts();
  const { data: strategies = [] } = useStrategies();
  const favorites = instruments.filter((i) => i.favorite).map((i) => i.symbol);
  const rows = [
    { label: t.currency, value: user.settings.accountCurrency },
    { label: t.favorites, value: favorites.join(', ') || t.none },
    { label: t.accounts, value: accounts.map((a) => a.name).join(', ') || t.none },
    { label: t.strategies, value: strategies.map((s) => s.name).join(', ') || t.none },
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 flex flex-col">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className="text-sm text-dim">{r.label}</dt>
            <dd className={`m-0 text-sm font-semibold ${r.value === t.none ? 'text-dim' : ''}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 rounded-(--radius-control) bg-raised p-3 text-[13px]">{t.tip}</p>
    </div>
  );
}
