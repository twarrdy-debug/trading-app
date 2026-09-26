import type { Theme } from '@trading/shared';

export const DEFAULT_ACCENT = '#FFB020';

/** Accent colors offered in the picker; any other #RRGGBB can be entered in settings. */
export const ACCENT_OPTIONS = ['#FFB020', '#3FD0FF', '#A78BFA', '#FF5CA8', '#E8EDF2'];

/** Black or white text, whichever reads better on the given background. */
export function readableOn(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a0c10' : '#ffffff';
}

const systemTheme = () => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

export function applyTheme(theme: Theme, accent: string | null) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'system' ? systemTheme() : theme;
  const color = accent ?? DEFAULT_ACCENT;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--on-accent', readableOn(color));
}
