import { isWholeSteps, type PartResult } from '@trading/shared';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Input, toggleClass } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatNumber, parseDecimal, toInputNumber } from '../../lib/format.ts';

/** One part of the position as edited. Without a split there is one part for the whole position. */
export interface PartDraft {
  sizeText: string;
  tpText: string;
  /** Empty: the stop of the part before (the first part: the trade's stop loss). */
  slText: string;
  result: PartResult;
  /** For `manual`. */
  priceText: string;
  /** Local "YYYY-MM-DDTHH:mm"; empty = when saved. */
  closedAt: string;
}

export const emptyPart = (patch: Partial<PartDraft> = {}): PartDraft => ({ sizeText: '', tpText: '', slText: '', result: 'open', priceText: '', closedAt: '', ...patch });

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Splits a position into `n` parts of whole steps; the last part takes the remainder. */
export function splitEqually(total: number, n: number, step: number): number[] {
  const each = Math.floor(total / n / step + 1e-9) * step;
  return Array.from({ length: n }, (_, i) => round4(i < n - 1 ? each : total - each * (n - 1)));
}

export const partsTotal = (parts: PartDraft[]) => round4(parts.reduce((sum, p) => sum + (parseDecimal(p.sizeText) ?? 0), 0));

const RESULTS: PartResult[] = ['open', 'tp', 'sl', 'be', 'manual'];

/** One grid for the header and every row, so the columns line up (the result toggles need ~17 rem). */
const COLUMNS = 'md:grid-cols-[1.25rem_7.5rem_minmax(0,1fr)_minmax(0,1fr)_17.5rem_11.5rem_2.25rem]';

/** Open / TP / SL / BE / other price, as one row of toggles. */
export function ResultPicker({ value, onChange, label, compact = false }: { value: PartResult; onChange: (r: PartResult) => void; label: string; compact?: boolean }) {
  const t = useT().composer;
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {RESULTS.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`${compact ? 'h-10 px-2.5' : 'h-11 px-3.5'} text-xs font-semibold whitespace-nowrap ${toggleClass(value === r)}`}
        >
          {t.results[r]}
        </button>
      ))}
    </div>
  );
}

interface Props {
  parts: PartDraft[];
  onChange: (parts: PartDraft[]) => void;
  /** The whole position, for "left to split" and the equal split. */
  total: number | null;
  step: number;
  unitLabel: string;
  isFutures: boolean;
  /** The trade's stop loss, shown where a part's stop is inherited. */
  tradeStop: string;
}

/**
 * The parts of a position closed in parts, as a table: size, take profit, stop loss (empty copies the
 * part before), result and close time. A new part takes what is left to split and the last stop.
 */
export function PartsEditor({ parts, onChange, total, step, unitLabel, isFutures, tradeStop }: Props) {
  const t = useT().composer;
  const update = (i: number, patch: Partial<PartDraft>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const left = total == null ? null : round4(total - partsTotal(parts));
  const canAdd = total != null && parts.length * step + step <= total + 1e-9;
  const addPart = () => onChange([...parts, emptyPart({ sizeText: left != null && left >= step ? toInputNumber(left) : '' })]);
  const equal = () => {
    if (total == null) return;
    const sizes = splitEqually(total, parts.length, step);
    onChange(parts.map((p, i) => ({ ...p, sizeText: toInputNumber(sizes[i]) })));
  };
  // The stop each part inherits when its own is empty.
  const inherited: string[] = [];
  parts.reduce((previous, p) => {
    inherited.push(previous);
    return p.slText.trim() || previous;
  }, tradeStop.trim());

  const head = 'hidden text-[11px] font-semibold text-dim md:block';
  const cellLabel = 'text-[11px] font-semibold text-dim md:hidden';
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-x-2.5 ${COLUMNS} md:items-center`}>
        <span className={head}>{t.partNo}</span>
        <span className={head}>{unitLabel}</span>
        <span className={head}>TP</span>
        <span className={head}>SL</span>
        <span className={head}>{t.outcome}</span>
        <span className={head}>{t.closedAt}</span>
        <span />
      </div>
      {parts.map((p, i) => {
        const size = parseDecimal(p.sizeText);
        const badSize = size != null && (size < step || !isWholeSteps(size, step));
        return (
          <div
            key={i}
            className={`relative grid items-center gap-2.5 rounded-(--radius-control) border border-line bg-panel p-2.5 ${COLUMNS} md:border-0 md:bg-transparent md:p-0`}
          >
            <span className="font-mono text-[13px] font-semibold text-dim">{i + 1}</span>
            <label className="flex flex-col gap-1">
              <span className={cellLabel}>{unitLabel}</span>
              <Input
                aria-label={t.partSize(i + 1)}
                aria-invalid={badSize || undefined}
                inputMode={isFutures ? 'numeric' : 'decimal'}
                value={p.sizeText}
                onChange={(e) => update(i, { sizeText: isFutures ? e.target.value.replace(/\D/g, '') : e.target.value })}
                className={`h-10 font-semibold ${badSize ? 'border-sell' : ''}`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cellLabel}>TP</span>
              <Input aria-label={t.partTp(i + 1)} inputMode="decimal" value={p.tpText} onChange={(e) => update(i, { tpText: e.target.value })} placeholder="—" className="h-10" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cellLabel}>SL</span>
              <Input
                aria-label={t.partSl(i + 1)}
                inputMode="decimal"
                value={p.slText}
                onChange={(e) => update(i, { slText: e.target.value })}
                placeholder={inherited[i] ? `${inherited[i]} · ${t.slInherited}` : '—'}
                className="h-10"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className={cellLabel}>{t.outcome}</span>
              <ResultPicker compact label={t.partResult(i + 1)} value={p.result} onChange={(result) => update(i, { result })} />
            </div>
            <div className={`flex flex-col gap-1.5 ${p.result === 'open' ? 'max-md:hidden' : ''}`}>
              {p.result === 'manual' && (
                <Input aria-label={t.closePrice} inputMode="decimal" value={p.priceText} onChange={(e) => update(i, { priceText: e.target.value })} placeholder={t.closePrice} className="h-10" />
              )}
              {p.result !== 'open' && (
                <DateTimePicker value={p.closedAt} onChange={(v) => update(i, { closedAt: v })} clearable aria-label={t.partClosedAt(i + 1)} placeholder={t.closedNow} className="[&>button]:h-10" />
              )}
            </div>
            <button
              type="button"
              aria-label={t.removePart(i + 1)}
              disabled={parts.length <= 2}
              onClick={() => onChange(parts.filter((_, j) => j !== i))}
              className="absolute top-1.5 right-1.5 flex size-9 items-center justify-center justify-self-end rounded-lg text-dim hover:bg-chip hover:text-sell disabled:invisible md:static"
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={addPart} disabled={!canAdd} className={`h-9 px-3 text-[13px] font-semibold disabled:opacity-40 ${toggleClass(false)}`}>
          + {t.addPart}
        </button>
        <button type="button" onClick={equal} disabled={total == null} className={`h-9 px-3 text-[13px] font-semibold disabled:opacity-40 ${toggleClass(false)}`}>
          {t.splitEqually}
        </button>
        {left != null && (
          <span className={`ml-1 text-xs ${Math.abs(left) < 1e-6 ? 'text-buy' : 'text-warn'}`} aria-live="polite">
            {Math.abs(left) < 1e-6 ? `✓ ${t.allSplit}` : left > 0 ? t.leftToSplit(formatNumber(left), unitLabel) : t.overSplit(formatNumber(-left), unitLabel)}
          </span>
        )}
      </div>
    </div>
  );
}
