import { LANGUAGES, type Language } from '@trading/shared';
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMe } from '../api/hooks.ts';
import { setFormatLocale } from '../lib/format.ts';
import { en } from './en.ts';
import { pl, type Messages } from './pl.ts';

export type { Messages };

const DICTIONARIES: Record<Language, Messages> = { pl, en };
/** Last used language, so the first paint (before /me loads) is already in the right language. */
const STORED_LANGUAGE_KEY = 'language';
/** A first visit is in English (owner's decision, 2026-10-15); a picked or settings language wins after that. */
const DEFAULT_LANGUAGE: Language = 'en';

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORED_LANGUAGE_KEY);
    return (LANGUAGES as readonly string[]).includes(value ?? '') ? (value as Language) : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

const I18nContext = createContext<{ language: Language; t: Messages; setLanguage: (language: Language) => void }>({
  language: DEFAULT_LANGUAGE,
  t: pl,
  setLanguage: () => {},
});

/** Provides the user's language (from settings) to the app. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  // A language picked on a sign-in page wins until the user's settings change; otherwise the
  // settings language, or (signed out) the one used last.
  const [picked, setPicked] = useState<Language | null>(null);
  const settingsLanguage = me?.settings.language;
  useEffect(() => setPicked(null), [settingsLanguage]);
  // The demo is one shared user: it reads in the language picked on the public pages (and kept by its settings, locally).
  const language = picked ?? (me?.demo ? storedLanguage() : settingsLanguage) ?? storedLanguage();
  const t = DICTIONARIES[language];
  // Set synchronously so formatting during this render already uses the language.
  setFormatLocale(t.locale);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(STORED_LANGUAGE_KEY, language);
    } catch {
      // Without storage the first paint falls back to Polish.
    }
  }, [language]);

  // Keyed by language: switching remounts the screens, so every formatted value is redone.
  return (
    <I18nContext.Provider value={{ language, t, setLanguage: setPicked }}>
      <Fragment key={language}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

/** UI strings in the current language. */
export const useT = () => useContext(I18nContext).t;
export const useLanguage = () => useContext(I18nContext).language;
/** Changes the language while signed out; signed in, it comes from the settings. */
export const useSetLanguage = () => useContext(I18nContext).setLanguage;
