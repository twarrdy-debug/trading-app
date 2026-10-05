import type { AdminInstrument } from '@trading/api/types';
import { ASSET_CLASSES, MEASURE_UNITS, type AssetClass, type Market, type MeasureUnit } from '@trading/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAdminInstruments, useSaveInstrument } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { InstrumentBadge } from '../../components/ui/InstrumentBadge.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatPrice, parseDecimal, toInputNumber } from '../../lib/format.ts';

/** Every instrument (hidden ones too) with its specification; edit in place or add a new one. */
export function AdminInstruments() {
  const all = useT();
  const t = all.admin.instruments;
  const { data: instruments = [], isLoading } = useAdminInstruments();
  const save = useSaveInstrument();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">{t.warning}</p>
      {editing === 'new' ? (
        <InstrumentForm onDone={() => setEditing(null)} />
      ) : (
        <Button variant="primary" size="sm" className="self-start" onClick={() => setEditing('new')}>
          + {t.add}
        </Button>
      )}
      <section className="card overflow-x-auto">
        {isLoading ? (
          <p className="m-0 p-5 text-sm text-dim">{all.common.loading}</p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="bg-raised">
              <tr>
                {[t.symbol, t.market, t.measureUnit, t.unitValue, t.currencies, ''].map((label, i) => (
                  <th key={i} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-dim">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {instruments.map((i) =>
                editing === i.id ? (
                  <tr key={i.id} className="border-b border-line">
                    <td colSpan={6} className="p-3">
                      <InstrumentForm instrument={i} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={i.id} className={`border-b border-line last:border-b-0 ${i.active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <InstrumentBadge symbol={i.symbol} />
                        <span className="text-xs text-dim">
                          {i.name} · {t.trades(i.trades)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {i.market === 'cfd' ? 'CFD' : 'Futures'} · {t.assetClasses[i.assetClass] ?? i.assetClass}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {all.units.name[i.measureUnit]} · <span className="font-mono">{formatPrice(i.unitSize)}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                      {formatPrice(i.unitValue)} {i.quoteCurrency}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{i.currencies.join(', ') || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          aria-pressed={i.active}
                          disabled={save.isPending}
                          onClick={() => save.mutate({ id: i.id, input: { active: !i.active } })}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${i.active ? 'bg-buy-soft text-buy' : 'bg-chip text-dim'}`}
                        >
                          {i.active ? t.active : t.inactive}
                        </button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(i.id)}>
                          {t.edit}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Add (no `instrument`) or edit; symbol and market are fixed once created. */
function InstrumentForm({ instrument, onDone }: { instrument?: AdminInstrument; onDone: () => void }) {
  const all = useT();
  const t = all.admin.instruments;
  const save = useSaveInstrument();
  const [symbol, setSymbol] = useState(instrument?.symbol ?? '');
  const [name, setName] = useState(instrument?.name ?? '');
  const [market, setMarket] = useState<Market>(instrument?.market ?? 'cfd');
  const [assetClass, setAssetClass] = useState<AssetClass>(instrument?.assetClass ?? 'forex');
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>(instrument?.measureUnit ?? 'pip');
  const [unitSize, setUnitSize] = useState(toInputNumber(instrument?.unitSize));
  const [unitValue, setUnitValue] = useState(toInputNumber(instrument?.unitValue));
  const [quoteCurrency, setQuoteCurrency] = useState(instrument?.quoteCurrency ?? 'USD');
  const [currencies, setCurrencies] = useState(instrument?.currencies.join(', ') ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const size = parseDecimal(unitSize);
    const value = parseDecimal(unitValue);
    if (!name.trim() || (!instrument && !symbol.trim()) || size == null || value == null) {
      setErrors([[t.symbol, t.name, t.unitSize, t.unitValue].join(', ')]);
      return;
    }
    const codes = currencies
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const common = { name: name.trim(), assetClass, measureUnit, unitSize: size, unitValue: value, quoteCurrency: quoteCurrency.trim().toUpperCase(), currencies: codes };
    setErrors([]);
    save.mutate(
      instrument ? { id: instrument.id, input: common } : { input: { ...common, symbol: symbol.trim().toUpperCase(), market } },
      { onSuccess: onDone, onError: (err) => setErrors(err instanceof ApiError ? err.lines : [err.message]) },
    );
  };

  return (
    <div className="card flex flex-col gap-4 p-5">
      {instrument ? (
        <p className="m-0 text-xs text-dim">
          <span className="mr-2 font-mono font-bold text-ink">{instrument.symbol}</span>
          {t.fixed}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={t.symbol}>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={20} placeholder="GER40" className="font-mono" />
          </Field>
          <Field label={t.market}>
            <Segmented
              label={t.market}
              value={market}
              onChange={setMarket}
              options={[
                { value: 'cfd', label: 'CFD' },
                { value: 'futures', label: 'Futures' },
              ]}
            />
          </Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="font-sans" />
        </Field>
        <Field label={t.assetClass}>
          <Select value={assetClass} onChange={setAssetClass} options={ASSET_CLASSES.map((c) => ({ value: c, label: t.assetClasses[c] ?? c }))} />
        </Field>
        <Field label={t.measureUnit}>
          <Select value={measureUnit} onChange={setMeasureUnit} options={MEASURE_UNITS.map((u) => ({ value: u, label: all.units.name[u] }))} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.unitSize} help={t.unitSizeHelp}>
          <Input inputMode="decimal" value={unitSize} onChange={(e) => setUnitSize(e.target.value)} placeholder="0,0001" />
        </Field>
        <Field label={t.unitValue} help={t.unitValueHelp}>
          <Input inputMode="decimal" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} placeholder="10" />
        </Field>
        <Field label={t.quoteCurrency}>
          <Input value={quoteCurrency} onChange={(e) => setQuoteCurrency(e.target.value.toUpperCase())} maxLength={3} className="font-mono" />
        </Field>
        <Field label={t.currencies} help={t.currenciesHelp}>
          <Input value={currencies} onChange={(e) => setCurrencies(e.target.value)} placeholder="EUR, USD" className="font-mono" />
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
          {t.cancel}
        </Button>
        <Button size="sm" variant="primary" disabled={save.isPending} onClick={submit}>
          {t.save}
        </Button>
      </div>
    </div>
  );
}
