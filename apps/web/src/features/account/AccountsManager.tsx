import type { AccountSummary } from '@trading/api/types';
import { LEVERAGE_OPTIONS, type AccountType, type DrawdownType, type Market } from '@trading/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAccounts, useDeleteAccount, useSaveAccount } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { parseDecimal, toInputNumber } from '../../lib/format.ts';
import { accountKind } from './AccountViews.tsx';

/**
 * Add, edit and delete trading accounts. Lives inside the settings form, so it uses plain
 * buttons (no nested <form>) and saves each account right away.
 */
export function AccountsManager({ currency }: { currency: string }) {
  const all = useT();
  const t = all.accounts;
  const { data: accounts = [] } = useAccounts();
  const remove = useDeleteAccount();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-control) bg-raised p-4" aria-labelledby="accounts-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="accounts-title" className="m-0 text-sm font-bold">
            {t.title}
          </h3>
          <span className="text-xs text-dim">{t.intro}</span>
        </div>
        {editing !== 'new' && (
          <Button size="sm" onClick={() => setEditing('new')} className="shrink-0 whitespace-nowrap">
            {t.add}
          </Button>
        )}
      </div>

      {accounts.length === 0 && editing !== 'new' && <span className="text-[13px] text-dim">{t.empty}</span>}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {accounts.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AccountForm account={a} currency={currency} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id} className="flex items-center gap-3 rounded-(--radius-control) bg-panel px-3.5 py-2.5">
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm font-semibold">{a.name}</span>
                <span className="truncate font-mono text-[11px] text-dim">
                  {accountKind(all, a)} {currency}
                  {a.prop ? ` · DD ${toInputNumber(a.prop.maxDrawdownPct)}%${a.prop.drawdownType === 'eod' ? ' EOD' : ''}` : ''}
                  {a.prop?.target ? ` · ${all.accounts.profitTarget} ${toInputNumber(a.prop.target.pct)}%` : ''}
                  {a.leverage ? ` · 1:${a.leverage}` : ''}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)}>
                {t.edit}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => window.confirm(t.confirmDelete(a.name)) && remove.mutate(a.id)}
                className="text-sell!"
              >
                {t.delete}
              </Button>
            </li>
          ),
        )}
      </ul>

      {editing === 'new' && <AccountForm currency={currency} onDone={() => setEditing(null)} />}
    </section>
  );
}

function AccountForm({ account, currency, onDone }: { account?: AccountSummary; currency: string; onDone: () => void }) {
  const all = useT();
  const t = all.accounts;
  const save = useSaveAccount();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'live');
  const [market, setMarket] = useState<Market>(account?.market ?? 'cfd');
  const [size, setSize] = useState(toInputNumber(account?.size));
  const [maxDrawdown, setMaxDrawdown] = useState(toInputNumber(account?.prop?.maxDrawdownPct));
  const [drawdownType, setDrawdownType] = useState<DrawdownType>(account?.prop?.drawdownType ?? 'static');
  const [target, setTarget] = useState(toInputNumber(account?.prop?.target?.pct));
  const [leverage, setLeverage] = useState(account?.leverage ? String(account.leverage) : '');
  const [errors, setErrors] = useState<string[]>([]);

  const prop = type === 'prop';
  // Leverage only matters for CFD: live accounts and prop accounts on CFD.
  const showLeverage = !prop || market === 'cfd';

  const submit = () => {
    setErrors([]);
    const sizeValue = parseDecimal(size);
    if (!name.trim() || sizeValue == null) {
      setErrors([`${t.name}, ${t.size.toLowerCase()}`]);
      return;
    }
    save.mutate(
      {
        id: account?.id,
        input: {
          name: name.trim(),
          type,
          market: prop ? market : null,
          size: sizeValue,
          maxDrawdownPct: prop ? (parseDecimal(maxDrawdown) ?? null) : null,
          ...(prop ? { drawdownType } : {}),
          profitTargetPct: prop ? (parseDecimal(target) ?? null) : null,
          leverage: showLeverage && leverage ? Number(leverage) : null,
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
        <Field label={t.size} hint={currency}>
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
          <Field label={t.maxDrawdown} hint="%" help={t.maxDrawdownHelp}>
            <Input inputMode="decimal" value={maxDrawdown} onChange={(e) => setMaxDrawdown(e.target.value)} placeholder="10" />
          </Field>
        )}
        {prop && (
          <Field label={t.profitTarget} hint="%" help={t.profitTargetHelp}>
            <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="8" />
          </Field>
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
