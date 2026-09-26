import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const control =
  'w-full border border-line bg-bg px-3 font-mono text-sm text-ink placeholder:text-dim/70 hover:border-dim focus:border-accent';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Label above a control; `hint` renders on the right of the label. */
export function Field({ label, hint, className = '', children }: FieldProps) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {hint && <span className="font-mono text-[11px] text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`h-11 ${control} ${className}`} {...props} />
);

export const Select = ({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`h-11 ${control} font-sans ${className}`} {...props} />
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
    <div role="group" aria-label={label} className="chamfer-sm inline-flex gap-0.5 bg-chip p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-8 px-3 text-xs font-semibold tracking-[0.1em] uppercase transition ${
            o.value === value ? 'bg-panel text-ink' : 'text-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
