import { useSyncExternalStore } from 'react';

/**
 * Which account the journal and statistics show: '' = all accounts, 'none' = trades without an
 * account, or an account id. Shared by both screens and remembered in this browser.
 */
const KEY = 'account-filter';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

let current = read();

export function setAccountFilter(value: string) {
  current = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Not remembered after a reload.
  }
  for (const listener of listeners) listener();
}

export function useAccountFilter(): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return [value, setAccountFilter];
}
