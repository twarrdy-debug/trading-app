import type { HTMLAttributes, ReactNode } from 'react';

interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  as?: 'section' | 'div' | 'aside';
}

export function Panel({ title, actions, as: Tag = 'section', className = '', children, ...props }: PanelProps) {
  return (
    <Tag className={`card relative ${className}`} {...props}>
      {(title || actions) && (
        <header className="flex min-h-14 items-center gap-4 px-5 pt-1">
          {title && <h2 className="m-0 text-[15px] font-bold">{title}</h2>}
          <div className="grow" />
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}
