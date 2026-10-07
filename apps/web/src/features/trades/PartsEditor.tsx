import type { PartResult } from '@trading/shared';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Input, toggleClass } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatNumber, parseDecimal, toInputNumber } from '../../lib/format.ts';

/** One part of the position as edited. */
export interface PartDraft {
  sizeText: string;
  tpText: string;
  slText: string;
  result: PartResult;
  /** For `manual`. */
  priceText: string;
  /** Local "YYYY-MM-DDTHH:mm"; empty = when saved. */
  closedAt: string;
}

export const emptyPart = (patch: Partial<PartDraft> = {}): PartDraft => ({ sizeText: '', tpText: '', slText: '', result: 'open', priceText: '', closedAt: '', ...patch });

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Splits a position into two halves (rounded down to the step; the second takes the remainder). */
export function splitInTwo(total: number, step: number): [number, number] {
  const first = Math.floor(total / 2 / step + 1e-9) * step;
  return [round4(first), round4(total - first)];
}

export const partsTotal = (parts: PartDraft[]) => round4(parts.reduce((sum, p) => sum + (parseDecimal(p.sizeText) ?? 0), 0));

const RESULTS: PartResult[] = ['tp', 'sl', 'be', 'manual', 'open'];

interface Props {
  parts: PartDraft[];
  onChange: (parts: PartDraft[]) => void;
  /** Split into several parts, each with its own size; otherwise one part for the whole position. */
  split: boolean;
  /** The whole position, for "left to split". */
  total: number | null;
  unitLabel: string;
  isFutures: boolean;
}

/**
 * Take profit, stop loss and result of each part. A new part copies the previous part's stop loss.
 * Without a split there is one part (its size is the whole position).
 */
export function PartsEditor({ parts, onChange, split, total, unitLabel, isFutures }: Props) {
  const t = useT().composer;
  const update = (i: number, patch: Partial<PartDraft>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const left = total == null ? null : round4(total - partsTotal(parts));
  const addPart = () => {
    const previous = parts.at(-1);
    onChange([...parts, emptyPart({ slText: previous?.slText ?? '', sizeText: left && left > 0 ? toInputNumber(left) : '' })]);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((p, i) => (
        <div key={i} className="grid items-end gap-2.5 rounded-(--radius-control) border border-line bg-panel p-3 lg:grid-cols-[auto_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.4fr)]">
          <span className="self-center text-[13px] font-semibold whitespace-nowrap lg:w-16">{split ? t.part(i + 1) : t.position}</span>
          {split ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-dim">{unitLabel}</span>
              <Input
                aria-label={t.partSize(i + 1)}
                inputMode="decimal"
                value={p.sizeText}
                onChange={(e) => update(i, { sizeText: isFutures ? e.target.value.replace(/\D/g, '') : e.target.value })}
                className="h-10"
              />
            </label>
          ) : (
            <span className="hidden lg:block" />
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-dim">TP</span>
            <Input aria-label={split ? t.partTp(i + 1) : 'TP'} inputMode="decimal" value={p.tpText} onChange={(e) => update(i, { tpText: e.target.value })} placeholder="—" className="h-10" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-dim">SL</span>
            <Input aria-label={split ? t.partSl(i + 1) : 'SL'} inputMode="decimal" value={p.slText} onChange={(e) => update(i, { slText: e.target.value })} placeholder="—" className="h-10" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">{t.result}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <div role="radiogroup" aria-label={split ? t.partResult(i + 1) : t.result} className="flex gap-1">
                {RESULTS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={p.result === r}
                    onClick={() => update(i, { result: r })}
                    className={`h-10 rounded-(--radius-chip) px-2.5 text-xs font-semibold whitespace-nowrap ${toggleClass(p.result === r)}`}
                  >
                    {t.results[r]}
                  </button>
                ))}
              </div>
              {p.result === 'manual' && (
                <Input aria-label={t.closePrice} inputMode="decimal" value={p.priceText} onChange={(e) => update(i, { priceText: e.target.value })} placeholder={t.closePrice} className="h-10 w-28" />
              )}
              {p.result !== 'open' && (
                <div className="w-48">
                  <DateTimePicker value={p.closedAt} onChange={(v) => update(i, { closedAt: v })} clearable aria-label={t.closedAt} placeholder={t.closedNow} />
                </div>
              )}
              {split && parts.length > 1 && (
                <button
                  type="button"
                  aria-label={t.removePart(i + 1)}
                  onClick={() => onChange(parts.filter((_, j) => j !== i))}
                  className="ml-auto size-9 rounded-lg text-dim hover:bg-chip hover:text-sell"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {split && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={addPart} className={`h-9 rounded-(--radius-chip) px-3 text-[13px] font-semibold ${toggleClass(false)}`}>
            + {t.addPart}
          </button>
          {left != null && (
            <span className={`text-xs ${Math.abs(left) < 1e-6 ? 'text-dim' : 'text-warn'}`} aria-live="polite">
              {Math.abs(left) < 1e-6 ? t.allSplit : left > 0 ? t.leftToSplit(formatNumber(left), unitLabel) : t.overSplit(formatNumber(-left), unitLabel)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
