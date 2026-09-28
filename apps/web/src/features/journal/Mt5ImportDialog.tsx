import type { AccountSummary, Instrument, Mt5Import, Mt5ImportRow } from '@trading/api/types';
import { BROKER_TIMEZONES, type BrokerTimezone } from '@trading/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useMt5Import } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDateTime, formatMoney, formatNumber } from '../../lib/format.ts';

const TIMEZONE_KEY = 'mt5-timezone';
const SYMBOL_MAP_KEY = 'mt5-symbol-map';

/** Per-browser conveniences: the broker's server zone and symbol assignments are reused next time. */
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the import still works.
  }
}

const STATUS_TONE: Record<Mt5ImportRow['status'], string> = {
  ready: 'bg-buy-soft text-buy',
  imported: 'bg-buy-soft text-buy',
  duplicate: 'bg-chip text-dim',
  unknownSymbol: 'bg-warn-bg text-ink',
  invalidSize: 'bg-sell-soft text-sell',
  wrongMarket: 'bg-sell-soft text-sell',
};

export function Mt5ImportDialog({
  instruments,
  accounts,
  defaultAccountId,
  timezone: userTimezone,
  onClose,
  onImported,
}: {
  instruments: Instrument[];
  accounts: AccountSummary[];
  /** Account the imported trades go to ('' = none). */
  defaultAccountId: string;
  timezone: string;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const all = useT();
  const t = all.mt5;
  const ref = useRef<HTMLDialogElement>(null);
  const run = useMt5Import();
  const [file, setFile] = useState<File | null>(null);
  const [timezone, setTimezone] = useState<BrokerTimezone>(() => {
    const stored = load<string>(TIMEZONE_KEY, 'broker-ny7');
    return (BROKER_TIMEZONES as readonly string[]).includes(stored) ? (stored as BrokerTimezone) : 'broker-ny7';
  });
  const [symbolMap, setSymbolMap] = useState<Record<string, string>>(() => load(SYMBOL_MAP_KEY, {}));
  const [preview, setPreview] = useState<Mt5Import | null>(null);
  /** Remounts the file input, so choosing another file starts empty. */
  const [fileInputKey, setFileInputKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [accountId, setAccountId] = useState(defaultAccountId);

  useEffect(() => ref.current?.showModal(), []);

  const request = (commit: boolean, map = symbolMap, zone = timezone, account = accountId) => {
    if (!file) return;
    setErrors([]);
    // Only assignments for symbols in this report are sent.
    const relevant = Object.fromEntries(Object.entries(map).filter(([, id]) => instruments.some((i) => i.id === id)));
    run.mutate(
      { file, timezone: zone, symbolMap: relevant, commit, accountId: account || undefined },
      {
        onSuccess: (result) => {
          if (commit) {
            onImported(result.summary.imported);
            onClose();
          } else {
            setPreview(result);
          }
        },
        onError: (err) => setErrors(err instanceof ApiError ? err.lines : [err.message]),
      },
    );
  };

  const assign = (symbol: string, instrumentId: string) => {
    const next = { ...symbolMap };
    if (instrumentId) next[symbol] = instrumentId;
    else delete next[symbol];
    setSymbolMap(next);
    save(SYMBOL_MAP_KEY, next);
    request(false, next);
  };

  const changeTimezone = (zone: BrokerTimezone) => {
    setTimezone(zone);
    save(TIMEZONE_KEY, zone);
    if (preview) request(false, symbolMap, zone);
  };

  // Symbols that needed a manual assignment: unknown now, or assigned by hand earlier.
  const mappable = preview
    ? [...new Set(preview.positions.filter((p) => p.status === 'unknownSymbol' || symbolMap[p.symbol]).map((p) => p.symbol))]
    : [];
  const s = preview?.summary;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="mt5-title"
      className="m-auto max-h-[calc(100vh-32px)] w-[min(960px,calc(100vw-32px))] overflow-auto rounded-(--radius) border-0 bg-panel p-0 text-ink shadow-(--shadow-pop) backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-4">
          <div className="flex grow flex-col gap-1.5">
            <h2 id="mt5-title" className="m-0 text-lg font-bold">
              {t.title}
            </h2>
            <p className="m-0 max-w-2xl text-[13px] text-dim">{t.intro}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {all.common.close}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={t.file}>
            <input
              key={fileInputKey}
              type="file"
              accept=".html,.htm,.xlsx,text/html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setErrors([]);
              }}
              className="text-sm text-dim file:mr-3 file:h-9 file:cursor-pointer file:rounded-(--radius-chip) file:border file:border-line file:bg-panel file:px-3 file:font-sans file:text-[13px] file:font-semibold file:text-ink"
            />
          </Field>
          <Field label={t.serverTime}>
            <Select
              value={timezone}
              onChange={changeTimezone}
              options={BROKER_TIMEZONES.map((zone) => ({ value: zone, label: t.timezones[zone] }))}
            />
            <span className="text-xs text-dim">{t.serverTimeHint}</span>
          </Field>
          {accounts.length > 0 && (
            <Field label={t.targetAccount}>
              <Select
                value={accountId}
                onChange={(id) => {
                  setAccountId(id);
                  if (preview) request(false, symbolMap, timezone, id);
                }}
                options={[{ value: '', label: all.accounts.none }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
              />
            </Field>
          )}
        </div>

        {!preview && (
          <div className="flex justify-end">
            <Button variant="primary" disabled={!file || run.isPending} onClick={() => request(false)}>
              {run.isPending ? t.reading : t.preview}
            </Button>
          </div>
        )}

        {errors.length > 0 && (
          <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
            {errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {preview && s && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {preview.account && <span className="mr-2 font-semibold">{t.account(preview.account, preview.currency)}</span>}
              <span className="rounded-md bg-buy-soft px-2 py-1 font-semibold text-buy">{t.ready(s.ready)}</span>
              {s.duplicate > 0 && <span className="rounded-md bg-chip px-2 py-1 font-semibold text-dim">{t.duplicate(s.duplicate)}</span>}
              {s.unknownSymbol > 0 && <span className="rounded-md bg-warn-bg px-2 py-1 font-semibold">{t.unknown(s.unknownSymbol)}</span>}
              {s.invalidSize > 0 && <span className="rounded-md bg-sell-soft px-2 py-1 font-semibold text-sell">{t.invalid(s.invalidSize)}</span>}
              {s.wrongMarket > 0 && <span className="rounded-md bg-sell-soft px-2 py-1 font-semibold text-sell">{t.wrongMarket(s.wrongMarket)}</span>}
            </div>

            {preview.warnings.length > 0 && (
              <ul className="m-0 list-none rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            {mappable.length > 0 && (
              <div className="flex flex-col gap-3 rounded-(--radius-control) bg-raised p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">{t.mapTitle}</span>
                  <span className="text-xs text-dim">{t.mapHint}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mappable.map((symbol) => (
                    <Field key={symbol} label={symbol}>
                      <Select
                        value={symbolMap[symbol] ?? ''}
                        onChange={(v) => assign(symbol, v)}
                        disabled={run.isPending}
                        options={[{ value: '', label: t.skip }, ...instruments.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}` }))]}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-80 overflow-auto rounded-(--radius-control) border border-line">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead className="sticky top-0 bg-raised">
                  <tr className="eyebrow text-left">
                    <th className="px-3 py-2 font-medium">{t.position}</th>
                    <th className="px-3 py-2 font-medium">{t.symbol}</th>
                    <th className="px-3 py-2 font-medium">{t.side}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.volume}</th>
                    <th className="px-3 py-2 font-medium">{t.open}</th>
                    <th className="px-3 py-2 font-medium">{t.close}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.mt5Profit}</th>
                    <th className="px-3 py-2 font-medium">{t.status}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {preview.positions.map((p) => (
                    <tr key={p.externalId} className="border-t border-grid">
                      <td className="px-3 py-2 text-dim">#{p.position}</td>
                      <td className="px-3 py-2 font-sans">
                        <span className="font-bold">{p.instrumentSymbol ?? p.symbol}</span>
                        {p.instrumentSymbol && p.instrumentSymbol !== p.symbol && <span className="ml-1.5 text-xs text-dim">{p.symbol}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 font-sans text-[11px] font-bold ${
                            p.direction === 'long' ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'
                          }`}
                        >
                          {p.direction === 'long' ? all.table.long : all.table.short}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{formatNumber(p.volume)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(p.openedAt, userTimezone)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(p.closedAt, userTimezone)}</td>
                      <td className={`px-3 py-2 text-right ${p.profit >= 0 ? 'text-buy' : 'text-sell'}`}>{formatMoney(p.profit)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-md px-2 py-0.5 font-sans text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[p.status]}`}>
                          {t.statuses[p.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="m-0 text-xs text-dim">{t.feesNote}</p>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                  setFileInputKey((k) => k + 1);
                }}
              >
                {t.otherFile}
              </Button>
              <Button onClick={onClose}>{all.common.cancel}</Button>
              <Button variant="primary" disabled={s.ready === 0 || run.isPending} onClick={() => request(true)}>
                {run.isPending ? t.importing : t.importN(s.ready)}
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
