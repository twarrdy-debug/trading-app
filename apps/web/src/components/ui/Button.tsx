import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'buy' | 'sell' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-bold hover:brightness-105',
  buy: 'border-[1.5px] border-buy bg-buy-soft text-buy font-bold',
  sell: 'border-[1.5px] border-sell bg-sell-soft text-sell font-bold',
  secondary: 'border border-line bg-panel text-ink font-semibold hover:bg-raised',
  ghost: 'bg-transparent text-dim font-semibold hover:bg-chip hover:text-ink',
  danger: 'border border-sell/40 bg-transparent text-sell font-semibold hover:bg-sell-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
  xl: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Toggle buttons (BUY/SELL, filters): the unselected state turns neutral. */
  selected?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', selected, className = '', type = 'button', ...props }: ButtonProps) {
  const off = selected === false ? 'border-transparent! bg-chip! text-dim! hover:text-ink!' : '';
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex items-center justify-center gap-2 rounded-(--radius-control) transition ${VARIANTS[variant]} ${SIZES[size]} ${off} ${className}`}
      {...props}
    />
  );
}
