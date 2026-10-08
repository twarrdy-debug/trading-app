import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/index.tsx';

/**
 * A screen that has nothing to show yet: what it will look like (sample content, blurred and faded,
 * out of reach for the mouse, keyboard and screen readers) under a card with a lock that says how
 * to unlock it.
 */
export function LockedPreview({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  const t = useT().locked;
  return (
    <div className="relative isolate min-h-[34rem] overflow-hidden rounded-(--radius)">
      <div aria-hidden inert className="pointer-events-none flex select-none flex-col gap-4 opacity-55 blur-[7px] saturate-[.6] [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">
        {children}
      </div>
      {/* A soft accent glow behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_22rem_at_50%_35%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_70%)]" />
      <div className="absolute inset-0 flex items-start justify-center px-4 pt-16 sm:pt-24">
        <section className="card flex max-w-md flex-col items-center gap-4 px-6 py-8 text-center shadow-(--shadow-pop) ring-1 ring-line sm:px-8">
          <span className="relative flex size-16 items-center justify-center rounded-[20px] bg-accent/15 text-accent-ink ring-1 ring-accent/35">
            <span aria-hidden className="absolute inset-0 animate-pulse rounded-[20px] bg-accent/10 blur-md" />
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="relative">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              <path d="M12 14.5v2.5" />
            </svg>
          </span>
          <span className="eyebrow">{t.preview}</span>
          <h2 className="m-0 text-xl font-bold tracking-tight text-balance">{title}</h2>
          <p className="m-0 text-sm text-dim text-pretty">{text}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Link to="/transakcje" className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-5 text-sm font-bold text-on-accent no-underline hover:brightness-105">
              + {t.add}
            </Link>
            <Link to="/transakcje" search={{ import: 'mt5' }} className="inline-flex h-11 items-center rounded-(--radius-control) border border-line bg-panel px-5 text-sm font-semibold text-ink no-underline hover:bg-raised">
              {t.import}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
