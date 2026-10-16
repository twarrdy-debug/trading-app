import type { AccountListItem as AccountSummary } from '@trading/api/types';
import { LEVERAGE_OPTIONS, type AccountType, type DrawdownType, type Market } from '@trading/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAccounts, useDeleteAccount, useMe, useSaveAccount } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currencyLabel, formatAmount, formatNumber, parseDecimal, toInputNumber } from '../../lib/format.ts';
import { accountKind } from './AccountViews.tsx';

type Unit = 'pct' | 'amount';

/** "DD 4% EOD" or "DD $2,500 EOD", as the limit was entered. */
function propSummary(all: ReturnType<typeof useT>, a: AccountSummary, currency: string) {
  if (!a.prop) return '';
  const dd = a.prop.drawdownUnit === 'amount' ? formatAmount(a.prop.limit, currency, false) : `${toInputNumber(a.prop.maxDrawdownPct)}%`;
  const target = a.prop.target
    ? ` · ${all.accounts.profitTarget} ${a.prop.target.unit === 'amount' ? formatAmount(a.prop.target.amount, currency, false) : `${toInputNumber(a.prop.target.pct)}%`}`
    : '';
  return ` · DD ${dd}${a.prop.drawdownType === 'eod' ? ' EOD' : ''}${target}`;
}

/** Add, edit and delete trading accounts (settings page); each account saves right away. */
export function AccountsManager({ currency }: { currency: string }) {
  const all = useT();
  const t = all.accounts;
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 && editing !== 'new' && <span className="text-[13px] text-dim">{t.empty}</span>}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {accounts.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AccountForm account={a} currency={currency} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id} className="flex flex-col gap-3 rounded-(--radius-control) bg-raised px-3.5 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 grow flex-col">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <span className="truncate font-mono text-[11px] text-dim">
                    {accountKind(all, a, currency)}
                    {propSummary(all, a, currency)}
                    {a.leverage ? ` · 1:${a.leverage}` : ''}
                    {a.maxTradesPerDay != null || a.lossStreakAlert != null ? ` · ${t.ownLimits(a.maxTradesPerDay, a.lossStreakAlert)}` : ''}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)}>
                  {t.edit}
                </Button>
                <Button size="sm" variant="ghost" aria-expanded={deleting === a.id} onClick={() => setDeleting(deleting === a.id ? null : a.id)} className="text-sell!">
                  {t.delete}
                </Button>
              </div>
              {deleting === a.id && <DeleteAccount account={a} others={accounts.filter((o) => o.id !== a.id)} onDone={() => setDeleting(null)} />}
            </li>
          ),
        )}
      </ul>

      {editing === 'new' ? (
        <AccountForm currency={currency} onDone={() => setEditing(null)} />
      ) : (
        <Button size="sm" onClick={() => setEditing('new')} className="self-start whitespace-nowrap">
          {t.add}
        </Button>
      )}
    </div>
  );
}

/**
 * Deleting an account asks what happens to its trades: keep them without an account, move them to
 * another account, or delete them with it (cannot be undone).
 */
function DeleteAccount({ account, others, onDone }: { account: AccountSummary; others: AccountSummary[]; onDone: () => void }) {
  const all = useT();
  const t = all.accounts;
  const remove = useDeleteAccount();
  const [mode, setMode] = useState<'keep' | 'move' | 'delete'>('keep');
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '');
  const [error, setError] = useState<string[]>([]);
  const hasTrades = account.tradeCount > 0;

  const options: { value: 'keep' | 'move' | 'delete'; label: string; help?: string; disabled?: boolean }[] = [
    { value: 'keep', label: t.deleteKeep, help: t.deleteKeepHelp },
    { value: 'move', label: t.deleteMove, disabled: others.length === 0 },
    { value: 'delete', label: t.deleteRemove, help: t.deleteRemoveHelp },
  ];

  const submit = () => {
    setError([]);
    remove.mutate(
      { id: account.id, trades: hasTrades ? mode : 'keep', moveTo: mode === 'move' ? moveTo : undefined },
      { onSuccess: onDone, onError: (err) => setError(err instanceof ApiError ? err.lines : [err.message]) },
    );
  };

  return (
    <div role="group" aria-label={t.deleteTitle(account.name)} className="flex flex-col gap-3 rounded-(--radius-control) border border-sell/40 bg-panel p-3.5">
      <span className="text-sm font-bold">{t.deleteTitle(account.name)}</span>
      <span className="text-[13px] text-dim">{hasTrades ? t.deleteTrades(account.tradeCount) : t.deleteNoTrades}</span>
      {hasTrades && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">{t.deleteTrades(account.tradeCount)}</legend>
          {options.map((o) => (
            <div key={o.value} className="flex flex-col gap-2">
            <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2 ${mode === o.value ? 'bg-raised' : ''} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
              <input
                type="radio"
                name={`delete-${account.id}`}
                value={o.value}
                checked={mode === o.value}
                disabled={o.disabled}
                onChange={() => setMode(o.value)}
                className="mt-1 accent-(--accent)"
              />
              <span className="flex flex-col gap-0.5">
                <span className={`text-[13px] font-semibold ${o.value === 'delete' ? 'text-sell' : ''}`}>{o.label}</span>
                {o.help && <span className="text-xs text-dim">{o.help}</span>}
              </span>
            </label>
            {/* The target account right under its option. */}
            {o.value === 'move' && mode === 'move' && others.length > 0 && (
              <div className="pl-8 sm:w-80">
                <Field label={t.moveTarget}>
                  <Select value={moveTo} onChange={setMoveTo} options={others.map((other) => ({ value: other.id, label: other.name }))} />
                </Field>
              </div>
            )}
            </div>
          ))}
        </fieldset>
      )}
      {error.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {error.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {all.common.cancel}
        </Button>
        <Button size="sm" disabled={remove.isPending} onClick={submit} className="border-sell! bg-sell! text-on-side!">
          {t.deleteConfirm}
        </Button>
      </div>
    </div>
  );
}

/** A prop limit typed as % of the size or as an amount, with the other shown under it. */
function LimitField({
  label,
  help,
  unit,
  onUnit,
  value,
  onValue,
  size,
  currency,
  placeholder,
}: {
  label: string;
  help: string;
  unit: Unit;
  onUnit: (unit: Unit) => void;
  value: string;
  onValue: (value: string) => void;
  size: number | null;
  currency: string;
  placeholder: { pct: string; amount: string };
}) {
  const t = useT().accounts;
  const number = parseDecimal(value);
  const other =
    number != null && size
      ? unit === 'pct'
        ? formatAmount((size * number) / 100, currency, false)
        : `${formatNumber(Math.round((number / size) * 10_000) / 100)}%`
      : null;
  return (
    <Field label={label} help={other ? `${t.equals(other)} · ${help}` : help}>
      <div className="flex gap-2">
        <Input inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder[unit]} className="min-w-0 grow" />
        <Segmented
          label={t.unit}
          value={unit}
          onChange={onUnit}
          options={[
            { value: 'pct', label: '%' },
            { value: 'amount', label: currencyLabel(currency) || '$' },
          ]}
        />
      </div>
    </Field>
  );
}

function AccountForm({ account, currency, onDone }: { account?: AccountSummary; currency: string; onDone: () => void }) {
  const all = useT();
  const t = all.accounts;
  const save = useSaveAccount();
  const { data: me } = useMe();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'live');
  const [market, setMarket] = useState<Market>(account?.market ?? 'cfd');
  const [size, setSize] = useState(toInputNumber(account?.size));
  // Each limit keeps the unit it was entered in (prop firms often state them in money).
  const [ddUnit, setDdUnit] = useState<Unit>(account?.prop?.drawdownUnit ?? 'pct');
  const [maxDrawdown, setMaxDrawdown] = useState(
    account?.prop ? toInputNumber(account.prop.drawdownUnit === 'amount' ? account.prop.limit : account.prop.maxDrawdownPct) : '',
  );
  const [drawdownType, setDrawdownType] = useState<DrawdownType>(account?.prop?.drawdownType ?? 'static');
  const [targetUnit, setTargetUnit] = useState<Unit>(account?.prop?.target?.unit ?? 'pct');
  const [target, setTarget] = useState(
    account?.prop?.target ? toInputNumber(account.prop.target.unit === 'amount' ? account.prop.target.amount : account.prop.target.pct) : '',
  );
  const [leverage, setLeverage] = useState(account?.leverage ? String(account.leverage) : '');
  // Empty: the account follows the defaults from Settings → Discipline.
  const [tradeLimit, setTradeLimit] = useState(account?.maxTradesPerDay?.toString() ?? '');
  const [lossLimit, setLossLimit] = useState(account?.lossStreakAlert?.toString() ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  const prop = type === 'prop';
  // Leverage only matters for CFD: live accounts and prop accounts on CFD.
  // Futures margins are set by the exchange; CFD brokers and crypto exchanges use leverage.
  const showLeverage = !prop || market !== 'futures';
  const sizeValue = parseDecimal(size);

  const submit = () => {
    setErrors([]);
    if (!name.trim() || sizeValue == null) {
      setErrors([`${t.name}, ${t.size.toLowerCase()}`]);
      return;
    }
    const dd = prop ? (parseDecimal(maxDrawdown) ?? null) : null;
    const goal = prop ? (parseDecimal(target) ?? null) : null;
    save.mutate(
      {
        id: account?.id,
        input: {
          name: name.trim(),
          type,
          market: prop ? market : null,
          size: sizeValue,
          maxDrawdownPct: ddUnit === 'pct' ? dd : null,
          maxDrawdownAmount: ddUnit === 'amount' ? dd : null,
          ...(prop ? { drawdownType } : {}),
          profitTargetPct: targetUnit === 'pct' ? goal : null,
          profitTargetAmount: targetUnit === 'amount' ? goal : null,
          leverage: showLeverage && leverage ? Number(leverage) : null,
          maxTradesPerDay: tradeLimit.trim() ? Number(tradeLimit) : null,
          lossStreakAlert: lossLimit.trim() ? Number(lossLimit) : null,
        },
      },
      { onSuccess: onDone, onError: (err) => setErrors(err instanceof ApiError ? err.lines : [err.message]) },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-(--radius-control) border border-line bg-panel p-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} maxLength={60} className="font-sans" />
        </Field>
        <Field label={t.size} hint={currencyLabel(currency) || '$'}>
          <Input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="10000" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">{t.type}</span>
        <Segmented
          label={t.type}
          value={type}
          onChange={setType}
          options={[
            { value: 'live', label: t.live },
            { value: 'prop', label: t.prop },
          ]}
        />
        {prop && (
          <>
            <span className="eyebrow ml-2">{t.market}</span>
            <Segmented
              label={t.market}
              value={market}
              onChange={setMarket}
              options={[
                { value: 'cfd', label: t.cfd },
                { value: 'futures', label: t.futures },
                { value: 'crypto', label: t.crypto },
              ]}
            />
          </>
        )}
      </div>
      {prop && <span className="-mt-1 text-xs text-dim">{t.marketHelp}</span>}
      {prop && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow">{t.drawdownType}</span>
            <Segmented
              label={t.drawdownType}
              value={drawdownType}
              onChange={setDrawdownType}
              options={[
                { value: 'static', label: t.drawdownStatic },
                { value: 'eod', label: t.drawdownEod },
              ]}
            />
          </div>
          <span className="text-xs text-dim">{drawdownType === 'eod' ? t.drawdownEodHelp : t.drawdownStaticHelp}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prop && (
          <LimitField
            label={t.maxDrawdown}
            help={t.maxDrawdownHelp}
            unit={ddUnit}
            onUnit={setDdUnit}
            value={maxDrawdown}
            onValue={setMaxDrawdown}
            size={sizeValue ?? null}
            currency={currency}
            placeholder={{ pct: '10', amount: '2500' }}
          />
        )}
        {prop && (
          <LimitField
            label={t.profitTarget}
            help={t.profitTargetHelp}
            unit={targetUnit}
            onUnit={setTargetUnit}
            value={target}
            onValue={setTarget}
            size={sizeValue ?? null}
            currency={currency}
            placeholder={{ pct: '8', amount: '3000' }}
          />
        )}
        {showLeverage && (
          <Field label={t.leverage} help={t.leverageHelp}>
            <Select
              value={leverage}
              onChange={setLeverage}
              options={[{ value: '', label: t.leverageNone }, ...LEVERAGE_OPTIONS.map((v) => ({ value: String(v), label: `1:${v}` }))]}
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.tradeLimit} help={t.limitsHelp}>
          <Input type="number" inputMode="numeric" min={1} max={100} step={1} value={tradeLimit} onChange={(e) => setTradeLimit(e.target.value)} placeholder={t.byDefault(me?.settings.maxTradesPerDay ?? null)} />
        </Field>
        <Field label={t.lossLimit}>
          <Input type="number" inputMode="numeric" min={1} max={20} step={1} value={lossLimit} onChange={(e) => setLossLimit(e.target.value)} placeholder={t.byDefault(me?.settings.lossStreakAlert ?? null)} />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {all.common.cancel}
        </Button>
        <Button size="sm" variant="primary" disabled={save.isPending} onClick={submit}>
          {t.save}
        </Button>
      </div>
    </div>
  );
}
