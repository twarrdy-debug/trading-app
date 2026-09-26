import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'buy' | 'sell' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary: 'chamfer bg-accent text-on-accent hover:brightness-110',
  buy: 'chamfer bg-buy text-on-side hover:brightness-110',
  sell: 'chamfer bg-sell text-on-side hover:brightness-110',
  secondary: 'border border-line bg-transparent text-ink hover:border-ink',
  ghost: 'bg-transparent text-dim hover:text-ink',
  danger: 'border border-sell bg-transparent text-sell hover:bg-sell hover:text-on-side',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-11 px-4 text-[13px]',
  lg: 'h-13 px-5 text-[15px]',
  xl: 'h-16 px-6 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Toggle buttons (BUY/SELL, filters): dims the unselected state. */
  selected?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', selected, className = '', type = 'button', ...props }: ButtonProps) {
  const dimmed = selected === false ? 'opacity-35 saturate-50 hover:opacity-70' : '';
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex items-center justify-center gap-2 font-bold uppercase tracking-[0.14em] transition ${VARIANTS[variant]} ${SIZES[size]} ${dimmed} ${className}`}
      {...props}
    />
  );
}
