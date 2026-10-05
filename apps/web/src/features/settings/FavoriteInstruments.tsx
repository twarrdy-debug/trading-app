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
                  <span aria-hidden className={i.favorite ? 'text-accent-ink' : 'opacity-40'}>
                    {i.favorite ? '★' : '☆'}
                  </span>
                  <InstrumentLogo symbol={i.symbol} size={16} />
                  <span className="font-mono">{i.symbol}</span>
                </Chip>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

