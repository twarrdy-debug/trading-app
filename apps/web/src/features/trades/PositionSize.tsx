import { useState } from 'react';
import { Input, toggleClass } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatNumber, parseDecimal, toInputNumber } from '../../lib/format.ts';

/** One-click sizes. */
const CFD_SIZES = [0.01, 0.1, 0.5, 1];
const FUTURES_SIZES = [1, 2, 3, 5];

/**
 * Step of the "+" button, from the size chosen before any "+" clicks: under 0.1 lot → 0.01, under
 * 1 → 0.1, from 1 → 1 (futures always 1). So 0.05 grows by 0.01, 0.3 by 0.1 and 2 by 1.
 */
const plusStep = (base: number, futures: boolean) => (futures || base >= 1 ? 1 : base >= 0.1 ? 0.1 : 0.01);
const round2 = (n: number) => Math.round(n * 100) / 100;

export type RiskMode = 'pct' | 'money';

interface Props {
  value: string;
  onChange: (text: string) => void;
  isFutures: boolean;
  unitLabel: string;
  /** The risk helper: risk typed as % of the balance or an amount, and the size it gives. */
  riskText: string;
  onRiskText: (text: string) => void;
  riskMode: RiskMode;
  onRiskMode: (mode: RiskMode) => void;
  /** Size that risks that much between entry and stop; null with `riskBlocker` saying why. */
  sizedFromRisk: number | null;
  riskBlocker: string | null;
  currencySymbol: string;
}

/**
 * The position size: typed, or from presets, ×2 and "+step"; under it the risk helper, which fills
 * the size from the risk and the stop loss. The size field stays the one source of truth.
 */
export function PositionSize({ value, onChange, isFutures, unitLabel, riskText, onRiskText, riskMode, onRiskMode, sizedFromRisk, riskBlocker, currencySymbol }: Props) {
  const t = useT().composer;
  const current = parseDecimal(value) ?? null;
  // The size the "+" step is based on; "+" clicks leave it as it was.
  const [base, setBase] = useState<number | null>(current);
  const set = (n: number, keepBase = false) => {
    onChange(toInputNumber(n));
    if (!keepBase) setBase(n);
  };
  const step = plusStep(base ?? current ?? 0, isFutures);
  const chip = `h-11 min-w-12 px-3 font-mono text-[13px] disabled:opacity-40 ${toggleClass(false)}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-36">
          <Input
            aria-label={t.size}
            inputMode={isFutures ? 'numeric' : 'decimal'}
            value={value}
            onChange={(e) => {
              const text = isFutures ? e.target.value.replace(/\D/g, '') : e.target.value;
              onChange(text);
              setBase(parseDecimal(text) ?? null);
            }}
            placeholder={isFutures ? '1' : '0,10'}
            className="pr-14 text-base font-semibold"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-dim">{unitLabel}</span>
        </div>
        <div role="group" aria-label={t.quickSize} className="flex gap-1.5">
          {(isFutures ? FUTURES_SIZES : CFD_SIZES).map((preset) => {
            const active = current === preset;
            return (
              <button key={preset} type="button" aria-pressed={active} onClick={() => set(preset)} className={`h-11 min-w-12 px-3 font-mono text-[13px] ${toggleClass(active)}`}>
                {formatNumber(preset)}
              </button>
            );
          })}
        </div>
        <button type="button" aria-label={t.double} title={t.double} disabled={!current} onClick={() => current && set(round2(current * 2))} className={chip}>
          ×2
        </button>
        <button
          type="button"
          aria-label={t.addStep(formatNumber(step))}
          title={t.addStep(formatNumber(step))}
          disabled={!current}
          onClick={() => current && set(round2(current + step), true)}
          className={chip}
        >
          +{formatNumber(step)}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-dim">{t.fromRisk}</span>
        <div className="relative w-24">
          <Input
            aria-label={riskMode === 'pct' ? t.riskPct : t.riskMoney}
            inputMode="decimal"
            value={riskText}
            onChange={(e) => onRiskText(e.target.value)}
            className="h-9 pr-7"
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-dim">{riskMode === 'pct' ? '%' : currencySymbol}</span>
        </div>
        <div role="group" aria-label={t.riskIn} className="inline-flex gap-0.5 rounded-(--radius-chip) bg-chip p-[3px]">
          {(['pct', 'money'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={riskMode === mode}
              onClick={() => onRiskMode(mode)}
              className={`h-7 rounded-[8px] px-2.5 text-xs ${riskMode === mode ? 'bg-panel font-bold text-ink shadow-sm' : 'font-medium text-dim hover:text-ink'}`}
            >
              {mode === 'pct' ? '%' : currencySymbol}
            </button>
          ))}
        </div>
        <span aria-hidden className="text-dim">→</span>
        <span aria-live="polite" className={`font-mono ${sizedFromRisk != null ? 'font-semibold' : 'text-dim'}`}>
          {sizedFromRisk != null ? t.riskGives(formatNumber(sizedFromRisk), unitLabel) : riskBlocker}
        </span>
        <button
          type="button"
          disabled={sizedFromRisk == null || sizedFromRisk === current}
          onClick={() => sizedFromRisk != null && set(sizedFromRisk)}
          className={`h-9 px-3 text-[13px] font-semibold disabled:opacity-40 ${toggleClass(false)}`}
        >
          {t.apply}
        </button>
      </div>
    </div>
  );
}
