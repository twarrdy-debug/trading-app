import { APP_NAME } from '@trading/shared';

/**
 * The AlphaLogFX logo (concept A, chosen 2026-10-15 from https://claude.ai/artifact/VMDWhyPjeN9LE2hyT5MJkz):
 * an alpha whose tail turns into an arrow up, on the accent. The same drawing is in
 * public/favicon.svg and public/logo-mail.png (e-mails).
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  // Below 24 px the arrowhead turns to mush; the alpha alone reads better.
  const small = size < 24;
  const stroke = small ? 5.5 : size < 40 ? 4.5 : 4;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <rect width="48" height="48" rx={small ? 11 : 13} fill="var(--accent)" />
      <path
        d="M35 35C31 31 28.5 15 20.5 15 14.5 15 12 20.5 12 25.5 12 31 15.5 34.5 20.5 34.5 27 34.5 30.5 23.5 36 13.5"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!small && <path d="M29.5 13.5H36V20" fill="none" stroke="var(--on-accent)" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** "AlphaLog" with "FX" in the accent. */
export function Wordmark({ className = '' }: { className?: string }) {
  const base = APP_NAME.replace(/FX$/, '');
  return (
    <span className={`font-extrabold tracking-[-0.02em] ${className}`}>
      {base}
      {base !== APP_NAME && <span className="text-accent-ink">FX</span>}
    </span>
  );
}
