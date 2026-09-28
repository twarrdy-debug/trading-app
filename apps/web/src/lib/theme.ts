import type { Theme } from '@trading/shared';

export const DEFAULT_ACCENT = '#FFB020';

/** Accent colors offered in the picker; any other #RRGGBB can be entered in settings. */
export const ACCENT_OPTIONS = ['#FFB020', '#3FD0FF', '#A78BFA', '#FF5CA8', '#E8EDF2'];

/** Perceived brightness 0–255 of a #RRGGBB colour. */
function brightness(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Dark or white text, whichever reads better on the given background. */
export function readableOn(hex: string): string {
  return brightness(hex) > 150 ? '#18202b' : '#ffffff';
}

/**
 * The accent as drawn in a theme: a near-white accent (the neutral option) would vanish on the
 * light background, so it becomes graphite there; a near-black one becomes light on dark.
 */
export function accentForTheme(hex: string, theme: 'light' | 'dark'): string {
  const level = brightness(hex);
  if (theme === 'light' && level > 215) return '#2a3340';
  if (theme === 'dark' && level < 45) return '#e8edf2';
  return hex;
}

const systemTheme = () => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

/** localStorage key read by the inline script in index.html, so the first paint already has the right theme. */
const STORED_THEME_KEY = 'theme';

export function applyTheme(theme: Theme, accent: string | null) {
  const root = document.documentElement;
  const resolved = theme === 'system' ? systemTheme() : theme;
  const color = accentForTheme(accent ?? DEFAULT_ACCENT, resolved);
  const onAccent = readableOn(color);
  root.dataset.theme = resolved;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--on-accent', onAccent);
  try {
    localStorage.setItem(STORED_THEME_KEY, JSON.stringify({ theme: resolved, accent: color, onAccent }));
  } catch {
    // Without storage the page just starts in the default theme.
  }
}
