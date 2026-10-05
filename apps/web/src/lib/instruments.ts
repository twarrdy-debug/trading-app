import type { Instrument } from '@trading/api/types';
import type { SelectOption } from '../components/ui/Select.tsx';

interface OptionsConfig {
  label: (i: Instrument) => string;
  /** Headings of the favourites and of the rest ("Ulubione" / "Pozostałe"). */
  favorites: string;
  others: string;
  /** Splits the rest into its own groups (CFD / Futures in the trade form). */
  group?: (i: Instrument) => string;
}

/**
 * Select options for instruments with the user's favourites first, under their own heading.
 * Each instrument is listed once; without favourites the list stays as it was.
 */
export function instrumentOptions(instruments: readonly Instrument[], config: OptionsConfig): SelectOption[] {
  const favorites = instruments.filter((i) => i.favorite);
  const rest = instruments.filter((i) => !i.favorite);
  return [
    ...favorites.map((i) => ({ value: i.id, label: config.label(i), group: config.favorites })),
    ...rest.map((i) => ({
      value: i.id,
      label: config.label(i),
      group: config.group?.(i) ?? (favorites.length > 0 ? config.others : undefined),
    })),
  ];
}
