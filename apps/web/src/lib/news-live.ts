import type { NewsItem } from '@trading/api/types';
import { matchKeywords } from '@trading/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';

// The news stream is opened once for the whole app (AppShell), so keyword alerts work on every
// screen, not only on /news.

interface LiveState {
  connected: boolean;
  /** Alerting headlines (keywords, red) that arrived while the news screen was not open (dot in the menu). */
  unseen: number;
  /** Headlines that just arrived, for a short highlight in the list. */
  fresh: ReadonlySet<string>;
}

let state: LiveState = { connected: false, unseen: 0, fresh: new Set() };
const listeners = new Set<() => void>();
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useNewsLive = () => useSyncExternalStore(subscribe, () => state);

/** The news screen is open: nothing is unseen, and new keyword headlines don't count. */
let screenOpen = false;
export function useNewsScreen() {
  useEffect(() => {
    screenOpen = true;
    set({ unseen: 0 });
    return () => void (screenOpen = false);
  }, []);
}

// --- Per-browser alert preferences (notification permission is per browser anyway) -----

export interface AlertPrefs {
  sound: boolean;
  notify: boolean;
  /** Also alert on headlines FinancialJuice marks red, keywords or not. */
  red: boolean;
}
const PREFS_KEY = 'news-alerts';

export function loadAlertPrefs(): AlertPrefs {
  try {
    return { sound: true, notify: false, red: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { sound: true, notify: false, red: true };
  }
}

export function saveAlertPrefs(prefs: AlertPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // The defaults come back on the next visit.
  }
}

/** Two short rising tones; no audio file needed. Browsers allow it after the first click on the page. */
export function playAlertSound() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // No audio (blocked autoplay or unsupported): the highlight still shows.
  }
}

const FRESH_MS = 8_000;

/**
 * Keeps the app connected to `GET /news/stream` while signed in. New headlines refresh the news
 * lists (and the calendar, when a release filled in an actual) and raise keyword alerts.
 */
export function useNewsStream(enabled: boolean, keywords: string[], alertTitle: (n: number) => string) {
  const client = useQueryClient();
  // The stream stays open when keywords or the language change.
  const latest = useRef({ keywords, alertTitle });
  latest.current = { keywords, alertTitle };

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/news/stream');
    source.onopen = () => {
      set({ connected: true });
      // Catch up on anything that arrived while disconnected.
      void client.invalidateQueries({ queryKey: ['news'] });
    };
    // EventSource reconnects by itself (the server asks for 5 s).
    source.onerror = () => set({ connected: false });
    source.addEventListener('news', (e) => {
      const items = JSON.parse((e as MessageEvent<string>).data) as NewsItem[];
      void client.invalidateQueries({ queryKey: ['news'] });
      if (items.some((i) => i.event)) void client.invalidateQueries({ queryKey: ['calendar'] });

      const ids = items.map((i) => i.id);
      set({ fresh: new Set([...state.fresh, ...ids]) });
      setTimeout(() => set({ fresh: new Set([...state.fresh].filter((id) => !ids.includes(id))) }), FRESH_MS);

      const prefs = loadAlertPrefs();
      const hits = items.filter((i) => !i.noise && ((prefs.red && i.important) || matchKeywords(i.title, latest.current.keywords).length > 0));
      if (hits.length === 0) return;
      if (!screenOpen) set({ unseen: state.unseen + hits.length });
      if (prefs.sound) playAlertSound();
      if (prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(latest.current.alertTitle(hits.length), { body: hits.map((h) => h.title).join('\n'), tag: hits[0]!.id });
      }
    });
    return () => {
      source.close();
      set({ connected: false });
    };
  }, [enabled, client]);
}
