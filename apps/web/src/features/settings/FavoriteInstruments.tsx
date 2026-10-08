import type { Instrument } from '@trading/api/types';
import { useInstruments, useToggleFavoriteInstrument } from '../../api/hooks.ts';
import { Chip } from '../../components/ui/Field.tsx';
import { InstrumentLogo } from '../../components/ui/InstrumentBadge.tsx';
import { useT } from '../../i18n/index.tsx';

/** Favourite instruments as toggle pills: forex, other CFDs and futures in their own rows. */
export function FavoriteInstrumentsPicker() {
  const all = useT();
  const t = all.instruments;
  const { data: instruments = [] } = useInstruments();
  const toggle = useToggleFavoriteInstrument();
  // Forex pairs get their own row; the other CFDs and the futures follow.
  const groups = [
    { key: 'forex', label: t.groups.forex, match: (i: Instrument) => i.market === 'cfd' && i.assetClass === 'forex' },
    { key: 'cfd', label: t.groups.cfd, match: (i: Instrument) => i.market === 'cfd' && i.assetClass !== 'forex' },
    { key: 'futures', label: t.groups.futures, match: (i: Instrument) => i.market === 'futures' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] text-dim">{t.favoritesHelp}</p>
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-dim">{g.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {instruments
              .filter(g.match)
              .map((i) => (
                <Chip key={i.id} active={i.favorite} label={t.toggle(i.symbol, i.favorite)} onClick={() => toggle.mutate({ id: i.id, favorite: !i.favorite })}>
                  <Star filled={i.favorite} />
                  <InstrumentLogo symbol={i.symbol} size={18} />
                  <span className="font-semibold">{i.symbol}</span>
                </Chip>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Drawn rather than the ★/☆ characters, which come from a fallback font and look rough at this size. */
function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden className={filled ? 'text-accent-ink' : 'text-dim'}>
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
