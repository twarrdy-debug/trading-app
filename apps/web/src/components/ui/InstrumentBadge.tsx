/**
 * Instrument logos in the circular style TradingView uses: two overlapping flags for a currency pair,
 * the US flag for US indices, a gold disc for gold. Files are in public/logos (see its README).
 */
const CURRENCY_FLAGS: Record<string, string> = { EUR: 'eu', GBP: 'gb', USD: 'us', JPY: 'jp', CHF: 'ch', AUD: 'au', NZD: 'nz', CAD: 'ca', PLN: 'pl' };
const GOLD = /^(XAU|M?GC\d)/;
const US_INDEX = /^(US100|US500|US30|M?NQ\d|M?ES\d|M?YM\d)/;

const flag = (code: string) => `/logos/flags/${code}.svg`;

const isForex = (symbol: string) => /^[A-Z]{6}$/.test(symbol) && CURRENCY_FLAGS[symbol.slice(0, 3)] != null && CURRENCY_FLAGS[symbol.slice(3)] != null;

/** Images for a symbol: one or two (base, quote); empty when there is no logo for it. */
function logoFiles(symbol: string): string[] {
  if (isForex(symbol)) return [flag(CURRENCY_FLAGS[symbol.slice(0, 3)]!), flag(CURRENCY_FLAGS[symbol.slice(3)]!)];
  if (GOLD.test(symbol)) return ['/logos/gold.svg'];
  if (US_INDEX.test(symbol)) return [flag('us')];
  return [];
}

/** The logo alone, `size` px; decorative (the symbol is always written next to it). */
export function InstrumentLogo({ symbol, size = 22 }: { symbol: string; size?: number }) {
  const files = logoFiles(symbol);
  if (files.length === 0) {
    return (
      <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-chip text-[10px] font-bold text-accent-ink" style={{ width: size, height: size }}>
        {symbol.slice(0, 2)}
      </span>
    );
  }
  if (files.length === 1) return <img src={files[0]} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-full" />;
  // A pair: the base flag top-left, the quote flag bottom-right over it. The base flag gets a round
  // notch (a mask, with a soft edge) instead of a ring in the panel colour, so the gap stays clean on
  // any background and small sizes do not turn into jagged crescents.
  const small = Math.round(size * 0.72);
  const centre = size - small / 2;
  const notch = small / 2 + Math.max(1.5, size * 0.07);
  const mask = `radial-gradient(circle at ${centre}px ${centre}px, transparent ${notch - 0.5}px, #000 ${notch + 0.5}px)`;
  return (
    <span aria-hidden className="relative shrink-0" style={{ width: size, height: size }}>
      <img src={files[0]} alt="" width={small} height={small} className="absolute top-0 left-0 rounded-full" style={{ maskImage: mask, WebkitMaskImage: mask }} />
      <img src={files[1]} alt="" width={small} height={small} className="absolute right-0 bottom-0 rounded-full" />
    </span>
  );
}

/** A currency's round flag (two letters when there is none, e.g. CNY); decorative. */
export function CurrencyFlag({ currency, size = 18 }: { currency: string; size?: number }) {
  const code = CURRENCY_FLAGS[currency];
  if (!code) {
    return (
      <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-chip text-[9px] font-bold text-dim" style={{ width: size, height: size }}>
        {currency.slice(0, 2)}
      </span>
    );
  }
  // A hairline ring keeps white flags (Japan) visible on white panels.
  return <img src={flag(code)} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-full ring-1 ring-line" />;
}

/** Pill with the logo and symbol; forex pairs show the quote currency dimmed. */
export function InstrumentBadge({ symbol }: { symbol: string }) {
  const forex = isForex(symbol);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel py-1 pr-3 pl-1 font-sans text-sm font-semibold whitespace-nowrap">
      <InstrumentLogo symbol={symbol} />
      {forex ? (
        <span>
          {symbol.slice(0, 3)}
          <span className="font-medium text-dim">{symbol.slice(3)}</span>
        </span>
      ) : (
        symbol
      )}
    </span>
  );
}
