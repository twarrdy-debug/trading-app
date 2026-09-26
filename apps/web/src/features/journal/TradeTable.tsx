import type { Instrument, Trade } from '@trading/api/types';
import { DIRECTIONS } from '@trading/shared';
import type { TradeQuery } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Select } from '../../components/ui/Field.tsx';
import { formatMoney, formatPrice, formatUnits } from '../../lib/format.ts';

const COLUMNS = 'grid grid-cols-[190px_104px_100px_minmax(180px,1fr)_110px_120px] gap-3 px-5';

export function TradeFilters({
  value,
  onChange,
  instruments,
}: {
  value: TradeQuery;
  onChange: (next: TradeQuery) => void;
  instruments: Instrument[];
}) {
  const set = (patch: Partial<TradeQuery>) => onChange({ ...value, ...patch });
  const num = (text: string) => (text === '' ? undefined : Number(text));
  const active = Object.values(value).some((v) => v !== undefined && v !== '');

  return (
    <div className="grid grid-cols-2 gap-3 border-b border-line p-5 md:grid-cols-4">
      <Field label="Instrument">
        <Select value={value.instrumentId ?? ''} onChange={(e) => set({ instrumentId: e.target.value || undefined })}>
          <option value="">Wszystkie</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kierunek">
        <Select
          value={value.direction ?? ''}
          onChange={(e) => set({ direction: (e.target.value || undefined) as TradeQuery['direction'] })}
        >
          <option value="">Oba</option>
          {DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d.toUpperCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Status">
        <Select value={value.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as TradeQuery['status'] })}>
          <option value="">Wszystkie</option>
          <option value="open">Otwarte</option>
          <option value="closed">Zamknięte</option>
        </Select>
      </Field>
      <Field label="Od dnia">
        <Input type="date" value={value.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
      </Field>
      <Field label="Do dnia">
        <Input type="date" value={value.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
      </Field>
      <Field label="Cena wejścia od / do">
        <div className="flex gap-1">
          <Input aria-label="Cena wejścia od" type="number" step="any" value={value.priceMin ?? ''} onChange={(e) => set({ priceMin: num(e.target.value) })} />
          <Input aria-label="Cena wejścia do" type="number" step="any" value={value.priceMax ?? ''} onChange={(e) => set({ priceMax: num(e.target.value) })} />
        </div>
      </Field>
      <Field label="Wielkość od / do">
        <div className="flex gap-1">
          <Input aria-label="Wielkość pozycji od" type="number" step="any" value={value.sizeMin ?? ''} onChange={(e) => set({ sizeMin: num(e.target.value) })} />
          <Input aria-label="Wielkość pozycji do" type="number" step="any" value={value.sizeMax ?? ''} onChange={(e) => set({ sizeMax: num(e.target.value) })} />
        </div>
      </Field>
      {active && (
        <div className="col-span-full flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            Wyczyść filtry
          </Button>
        </div>
      )}
    </div>
  );
}

function DirectionMark({ direction }: { direction: Trade['direction'] }) {
  return direction === 'long' ? (
    <span className="font-semibold text-buy">▲ LONG</span>
  ) : (
    <span className="font-semibold text-sell">▼ SHORT</span>
  );
}

export function TradeTable({
  trades,
  selectedId,
  onSelect,
}: {
  trades: Trade[];
  selectedId: string | null;
  onSelect: (trade: Trade) => void;
}) {
  if (trades.length === 0) {
    return <p className="m-0 px-5 py-10 text-center text-sm text-dim">Brak transakcji. Dodaj pierwszą w panelu obok.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className={`${COLUMNS} eyebrow border-b border-line py-3`} aria-hidden>
          <span>Nr dzienny</span>
          <span>Instrument</span>
          <span>Kierunek</span>
          <span>Wejście → wyjście</span>
          <span>Wynik</span>
          <span className="text-right">Waluta konta</span>
        </div>
        <ul className="m-0 list-none p-0">
          {trades.map((t) => {
            const tone = t.pnlAccount == null && t.resultUnits == null ? 'text-dim' : (t.resultUnits ?? 0) >= 0 ? 'text-buy' : 'text-sell';
            return (
              <li key={t.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(t)}
                  aria-current={t.id === selectedId}
                  className={`${COLUMNS} w-full items-center py-3.5 text-left font-mono text-sm text-ink transition hover:bg-raised ${
                    t.id === selectedId ? 'bg-raised' : t.overDailyLimit ? 'bg-warn-bg' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {t.dayLabel.split(' – ')[0]}
                    {t.overDailyLimit && (
                      <span className="bg-accent px-1.5 py-0.5 font-sans text-[10px] font-bold tracking-[0.1em] text-on-accent">LIMIT</span>
                    )}
                    {t.source === 'educator' && (
                      <span title="Sygnał edukatora" className="border border-line px-1 font-sans text-[10px] font-bold text-dim">
                        E
                      </span>
                    )}
                  </span>
                  <span className="font-sans font-semibold">{t.instrument.symbol}</span>
                  <DirectionMark direction={t.direction} />
                  <span className="truncate text-dim">
                    {formatPrice(t.entryPrice)} → {t.exitPrice == null ? 'otwarta' : formatPrice(t.exitPrice)}
                  </span>
                  <span className={tone}>{formatUnits(t.resultUnits, t.instrument.measureUnit)}</span>
                  <span className={`text-right ${tone}`}>
                    {t.pnlAccount != null ? formatMoney(t.pnlAccount) : t.pnlQuote != null ? '? kurs' : '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
