import { createContext, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

/** Id of the enclosing field label, so custom controls (Select) can be named by it. */
export const FieldLabelContext = createContext<string | undefined>(undefined);

const control =
  'w-full rounded-(--radius-control) border border-line bg-raised px-3 font-mono text-sm text-ink placeholder:text-dim/70 transition hover:border-dim/40 focus:border-accent-ink focus:bg-panel';

/** Pill toggle (size presets, emotions, filters): neutral chip, accent-tinted when active. */
export const toggleClass = (active: boolean) =>
  `rounded-(--radius-chip) border transition ${
    active ? 'border-accent bg-accent/15 text-ink font-semibold' : 'border-line bg-panel text-dim hover:text-ink hover:bg-raised'
  }`;

/** Small filter pill (currencies, categories, impacts). */
export function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 px-2.5 text-xs ${toggleClass(active)}`}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: ReactNode;
  /** Short note on the right of the label (a few words). */
  hint?: ReactNode;
  /** Longer explanation under the control. */
  help?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Label above a control; `hint` renders on the right of the label. */
export function Field({ label, hint, help, className = '', children }: FieldProps) {
  const labelId = useId();
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="eyebrow min-w-0 truncate">
          {label}
        </span>
        {hint && <span className="shrink-0 text-[11px] whitespace-nowrap text-dim">{hint}</span>}
      </span>
      <FieldLabelContext.Provider value={labelId}>{children}</FieldLabelContext.Provider>
      {help && <span className="text-xs text-dim">{help}</span>}
    </label>
  );
}

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`h-11 ${control} ${className}`} {...props} />
);

export const Textarea = ({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={`min-h-20 py-2 ${control} ${className}`} {...props} />
);

/** Row of mutually exclusive options (theme, date range, source). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-(--radius-control) bg-chip p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-[9px] px-3 text-xs transition ${
            o.value === value ? 'bg-panel font-bold text-ink shadow-sm' : 'font-medium text-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
