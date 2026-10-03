import { ACCENT_COLORS, type Theme } from '@trading/shared';

/** Orange is the app's default accent. */
export const DEFAULT_ACCENT = ACCENT_COLORS.orange;

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

/** Monochrome draws with the theme's own ink: black details on white, white details on black. */
const MONO_BY_THEME = { light: '#18202b', dark: '#ffffff' } as const;

/** The accent as drawn in a theme (anything but monochrome is used as it is). */
export function accentForTheme(hex: string, theme: 'light' | 'dark'): string {
  return hex.toUpperCase() === ACCENT_COLORS.mono ? MONO_BY_THEME[theme] : hex;
}

export const systemTheme = () => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

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
