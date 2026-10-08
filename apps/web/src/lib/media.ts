import { useSyncExternalStore } from 'react';

/** True while the media query matches, e.g. `useMedia('(min-width: 48rem)')` (Tailwind's `md`). */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
