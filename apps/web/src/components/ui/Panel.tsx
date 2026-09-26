import type { HTMLAttributes, ReactNode } from 'react';

/** HUD corner marks in the accent color. */
export function Brackets({ bottom = true }: { bottom?: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-px -left-px size-(--bracket) border-t-2 border-l-2 border-accent"
      />
      {bottom && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-px -bottom-px size-(--bracket) border-r-2 border-b-2 border-accent"
        />
      )}
    </>
  );
}

interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  brackets?: boolean;
  as?: 'section' | 'div' | 'aside';
}

export function Panel({ title, actions, brackets = false, as: Tag = 'section', className = '', children, ...props }: PanelProps) {
  return (
    <Tag className={`relative border border-line bg-panel ${className}`} {...props}>
      {brackets && <Brackets />}
      {(title || actions) && (
        <header className="flex min-h-12 items-center gap-4 border-b border-line px-5">
          {title && <h2 className="m-0 text-[13px] font-semibold tracking-[0.16em] uppercase">{title}</h2>}
          <div className="grow" />
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}
