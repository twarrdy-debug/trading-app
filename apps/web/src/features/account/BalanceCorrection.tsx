import type { AccountSummary } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAccountDayBalance, useAdjustments, useDeleteAdjustment, useMe, useSetAdjustment } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatAmount, formatDate, parseDecimal } from '../../lib/format.ts';

/**
 * Correcting an account's balance at the end of a day: the balance the broker shows (with fees and
 * commissions the trade reports leave out) is saved, and the difference counts in the account's
 * balance, drawdown and target only.
 */
export function BalanceCorrection({ account, currency, onDone }: { account: AccountSummary; currency: string; onDone: () => void }) {
  const all = useT();
  const t = all.corrections;
  const { data: me } = useMe();
  const today = toLocalDate(new Date(), me?.settings.timezone ?? 'Europe/Warsaw');
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const day = useAccountDayBalance(account.id, date);
  const { data: list = [] } = useAdjustments(account.id);
  const save = useSetAdjustment();
  const remove = useDeleteAdjustment();
  const entered = parseDecimal(balance);
  const computed = day.data?.computed ?? null;
  const difference = entered != null && computed != null ? Math.round((entered - computed) * 100) / 100 : null;

  const submit = () => {
    if (entered == null) return;
    setErrors([]);
    save.mutate(
      { accountId: account.id, date, balance: entered, note: note.trim() || null },
      {
        onSuccess: () => {
          setBalance('');
          setNote('');
        },
        onError: (err) => setErrors(err instanceof ApiError ? err.lines : [String(err)]),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-(--radius-control) border border-line bg-panel p-3.5">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t.title}</span>
        <span className="text-xs text-dim">{t.help}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t.day}>
          <DateTimePicker mode="date" value={date} onChange={(v) => setDate(v || today)} />
        </Field>
        <Field label={t.brokerBalance}>
          <Input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={computed != null ? String(computed) : ''} />
        </Field>
        <Field label={t.note}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t.notePlaceholder} className="font-sans" />
        </Field>
      </div>
      <span className="font-mono text-xs text-dim">
        {computed != null && t.appBalance(formatAmount(computed, currency, false))}
        {difference != null && ` · ${t.correction(formatAmount(difference, currency))}`}
        {day.data?.adjustment && ` · ${t.replaces(formatAmount(day.data.adjustment.amount, currency))}`}
      </span>
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
        <Button size="sm" variant="primary" disabled={entered == null || save.isPending} onClick={submit}>
          {t.save}
        </Button>
      </div>
      {list.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <span className="eyebrow">{t.list}</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-control) bg-raised px-3 py-2">
                <span className="font-mono">{formatDate(a.date)}</span>
                <span className="font-mono text-dim">{t.brokerShort(formatAmount(a.balance, currency, false))}</span>
                <span className={`font-mono font-bold ${a.amount < 0 ? 'text-sell' : a.amount > 0 ? 'text-buy' : 'text-dim'}`}>{formatAmount(a.amount, currency)}</span>
                {a.note && <span className="min-w-0 truncate text-dim">{a.note}</span>}
                <span className="grow" />
                <button
                  type="button"
                  className="text-xs font-semibold text-sell hover:underline"
                  disabled={remove.isPending}
                  onClick={() => window.confirm(t.confirmDelete(formatDate(a.date))) && remove.mutate({ accountId: account.id, date: a.date })}
                >
                  {t.delete}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
